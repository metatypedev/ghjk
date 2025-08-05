use crate::interlude::*;

use std::process::ExitCode;

use clap::builder::styling::AnsiColor;

use crate::config::Config;
use crate::systems::SystemManifest;
use crate::{host, systems};

mod init;
mod print;
mod reducers;
mod sys;

const DENO_UNSTABLE_FLAGS: &[&str] = &["worker-options", "kv"];

pub async fn cli() -> Res<std::process::ExitCode> {
    /* tokio::spawn({
        async {
            loop {
                println!("{:?}: thread is not blocked", std::thread::current().id());
                tokio::time::sleep(std::time::Duration::from_secs(2)).await;
            }
        }
    }); */

    let cwd = std::env::current_dir()?;

    let config = Config::source().await?;

    debug!("config sourced: {config:?}");

    let quick_res = match try_quick_cli(&config).await? {
        QuickCliResult::Exit(code) => {
            return Ok(code);
        }
        val => val,
    };

    let Some(ghjkdir_path) = config.ghjkdir.clone() else {
        return Ok(quick_res.exit(None));
    };

    let deno_cx = {
        // TODO: DENO_FLAGS param simlar to V8_FLAGS
        let flags = denort::deno::args::Flags {
            unstable_config: denort::deno::deno_lib::args::UnstableConfig {
                features: DENO_UNSTABLE_FLAGS
                    .iter()
                    .copied()
                    .map(String::from)
                    .collect(),
                ..default()
            },
            no_lock: config.deno_no_lockfile,
            config_flag: match config.deno_json.as_ref() {
                Some(path) => deno::args::ConfigFlag::Path(path.to_string_lossy().into()),
                None => deno::args::ConfigFlag::Disabled,
            },
            import_map_path: config
                .import_map
                .as_ref()
                .map(|path| path.to_string_lossy().into()),
            lock: config
                .deno_lockfile
                .as_ref()
                .map(|path| path.to_string_lossy().into()),
            internal: deno::args::InternalFlags {
                cache_path: Some(config.deno_dir.clone()),
                ..default()
            },
            ..default()
        };
        denort::worker::worker(flags, Some(Arc::new(Vec::new))).await?
    };

    let gcx = GhjkCtx {
        config,
        deno: deno_cx.clone(),
        exec_path: std::env::current_exe()
            .wrap_err("error trying to resolve path of current exec")?,
    };
    let gcx = Arc::new(gcx);

    // ready system contexts
    let (system_manifests, envs_ctx, deno_sys_cx) = {
        let (sys_envs, envs_ctx) = systems::envs::system(gcx.clone(), &ghjkdir_path).await?;
        let (sys_tasks, _tasks_ctx) = systems::tasks::system(gcx.clone(), envs_ctx.clone()).await?;
        let (systems_deno, deno_sys_cx) = systems::deno::systems_from_deno(
            &gcx,
            envs_ctx.clone(),
            &gcx.config
                .repo_root
                .join("src/sys_deno/std.ts")
                .wrap_err("repo url error")?,
            &ghjkdir_path,
        )
        .await?;

        let mut manifests = systems_deno;
        manifests.insert("envs".into(), SystemManifest::Envs(sys_envs));
        manifests.insert("tasks".into(), SystemManifest::Tasks(sys_tasks));
        (manifests, envs_ctx, deno_sys_cx)
    };

    let hcx = host::HostCtx::new(
        gcx.clone(),
        host::Config {
            env_vars: std::env::vars().collect(),
            cwd,
            // TODO: env vars, flags and tests for the following
            re_resolve: false,
            locked: false,
            re_serialize: false,
        },
        system_manifests,
    );

    let hcx = Arc::new(hcx);

    // initialize the systems according to the config
    let mut systems = {
        let is_completions = matches!(quick_res, QuickCliResult::Completions(_));
        match host::systems_from_ghjkfile(hcx, &ghjkdir_path, is_completions).await {
            Ok(Some(val)) => val,
            Ok(None) => {
                if !is_completions {
                    warn!("no ghjkfile found");
                }
                return Ok(quick_res.exit(None));
            }
            Err(err) => {
                if is_completions {
                    return Ok(quick_res.exit(None));
                }
                return Err(err);
            }
        }
    };

    // let conf_json = serde_json::to_string_pretty(&systems.config)?;
    // info!(%conf_json);

    use clap::*;

    let mut root_cmd = Cli::command();

    // TODO: support environment-activated completions for performance
    // Optional: support environment-activated completions for performance
    // Only enable when completions are not disabled
    // if matches!(gcx.config.completions, crate::config::CompletionsMode::Activators) {
    //     let _ = clap_complete::env::CompleteEnv::with_factory(|| Cli::command())
    //         .bin("ghjk")
    //         .complete();
    // }

    debug!("collecting system commands");

    let (sys_cmds, sys_actions) = match sys::commands_from_systems(&systems).await {
        Ok(val) => val,
        Err(err) => {
            systems.write_lockfile_or_log().await;
            return Err(err);
        }
    };

    for cmd in &sys_cmds {
        root_cmd = root_cmd.subcommand(cmd);
    }

    // Register CLI completion reducer on envs with the fully-built root_cmd
    // FIXME: this means completions are always generated even if we're not
    // writing activator scripts
    {
        envs_ctx.register_reducer(
            "ghjk.cli.Completions".to_string(),
            match gcx.config.completions {
                crate::config::CompletionsMode::Activators => {
                    crate::cli::reducers::ghjk_cli_completions_reducer(
                        &root_cmd,
                        &sys_cmds,
                        &sys_actions,
                        // TODO: optional_aliases
                        true,
                    )
                }
                crate::config::CompletionsMode::Off => {
                    crate::cli::reducers::ghjk_cli_completions_noop_reducer()
                }
            },
        );
    }

    // if it's already known to be a completions request,
    // no need to prase the argv again
    if let QuickCliResult::Completions(shell) = quick_res {
        return Ok(QuickCliResult::Completions(shell).exit(Some(&mut root_cmd)));
    }

    debug!("checking argv matches");

    let matches = match root_cmd.try_get_matches() {
        Ok(val) => val,
        Err(err) => {
            systems.write_lockfile_or_log().await;
            err.exit();
        }
    };

    match QuickCommands::from_arg_matches(&matches) {
        Ok(QuickCommands::Print { commands }) => {
            _ = commands.action(&gcx.config, Some(&systems.config))?;
            return Ok(ExitCode::SUCCESS);
        }
        Ok(QuickCommands::Completions { .. }) => {
            unreachable!("do_completions will prevent this")
        }
        Ok(QuickCommands::Init { .. }) => {
            unreachable!("quick_cli will prevent this")
        }
        Ok(QuickCommands::Deno { .. }) => {
            unreachable!("deno_quick_cli will prevent this")
        }
        Err(err) => {
            let kind = err.kind();
            use clap::error::ErrorKind;
            if !(kind == ErrorKind::InvalidSubcommand
                || kind == ErrorKind::InvalidValue
                || kind == ErrorKind::DisplayHelp
                || kind == ErrorKind::DisplayHelpOnMissingArgumentOrSubcommand)
            {
                systems.write_lockfile_or_log().await;
                err.exit();
            }
        }
    }

    let (cmd_path, mut action, action_matches) =
        match sys::action_for_match(sys_actions, &matches).await {
            Ok(val) => val,
            Err(err) => {
                systems.write_lockfile_or_log().await;
                return Err(err);
            }
        };

    debug!(?cmd_path, "system command found");
    let Some(action) = action.action else {
        systems.write_lockfile_or_log().await;
        action.clap.print_long_help()?;
        return Ok(std::process::ExitCode::FAILURE);
    };

    let res = action(action_matches.clone())
        .await
        .wrap_err_with(|| format!("error on system command at path {cmd_path:?}"));

    systems.write_lockfile_or_log().await;

    deno_sys_cx.terminate().await?;
    deno_cx.terminate().await?;

    res.map(|()| ExitCode::SUCCESS)
}

enum QuickCliResult {
    ClapErr(clap::Error),
    Completions(CompletionShell),
    Exit(ExitCode),
}
impl QuickCliResult {
    fn exit(self, cmd: Option<&mut clap::Command>) -> ExitCode {
        use clap::CommandFactory;
        use clap_complete::aot::{generate, Shell};
        match self {
            QuickCliResult::ClapErr(err) => err.exit(),
            QuickCliResult::Completions(shell) => {
                let mut stdout = std::io::stdout();
                let generator = match shell {
                    CompletionShell::Bash => Shell::Bash,
                    CompletionShell::Elvish => Shell::Elvish,
                    CompletionShell::Fish => Shell::Fish,
                    CompletionShell::PowerShell => Shell::PowerShell,
                    CompletionShell::Zsh => Shell::Zsh,
                };
                generate(
                    generator,
                    cmd.unwrap_or(&mut Cli::command()),
                    "ghjk".to_string(),
                    &mut stdout,
                );
                ExitCode::SUCCESS
            }
            QuickCliResult::Exit(_) => unreachable!("can't happen"),
        }
    }
}

/// Sections of the CLI do not require loading a ghjkfile.
async fn try_quick_cli(config: &Config) -> Res<QuickCliResult> {
    use clap::*;

    let cli = match Cli::try_parse() {
        Ok(val) => val,
        Err(err) => {
            let kind = err.kind();
            use clap::error::ErrorKind;
            if kind == ErrorKind::InvalidSubcommand
                || kind == ErrorKind::InvalidValue
                || kind == ErrorKind::DisplayHelp
                || kind == ErrorKind::DisplayHelpOnMissingArgumentOrSubcommand
            {
                return Ok(QuickCliResult::ClapErr(err));
            }
            err.exit();
        }
    };

    match cli.quick_commands {
        QuickCommands::Print { commands } => {
            if !commands.action(config, None)? {
                return Ok(QuickCliResult::ClapErr(clap::error::Error::new(
                    clap::error::ErrorKind::DisplayHelp,
                )));
            }
        }
        QuickCommands::Completions { shell } => {
            // this won't be part of the quick cli
            // since we want completions for the full
            // dynamic cli
            return Ok(QuickCliResult::Completions(shell));
        }
        QuickCommands::Init { commands } => commands.action(config).await?,
        QuickCommands::Deno { .. } => unreachable!("deno quick cli will have prevented this"),
    }

    Ok(QuickCliResult::Exit(ExitCode::SUCCESS))
}

const CLAP_STYLE: clap::builder::Styles = clap::builder::Styles::styled()
    .header(AnsiColor::Yellow.on_default())
    .usage(AnsiColor::BrightBlue.on_default())
    .literal(AnsiColor::BrightBlue.on_default())
    .placeholder(AnsiColor::BrightBlue.on_default());

#[derive(Debug, clap::Parser)]
#[clap(
    version,
    about,
    styles = CLAP_STYLE
)]
struct Cli {
    #[command(subcommand)]
    quick_commands: QuickCommands,
}

#[derive(clap::ValueEnum, Clone, Debug)]
enum CompletionShell {
    Bash,
    Elvish,
    Fish,
    #[value(name = "powershell")]
    PowerShell,
    Zsh,
}

impl std::fmt::Display for CompletionShell {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            CompletionShell::Bash => write!(f, "bash"),
            CompletionShell::Elvish => write!(f, "elvish"),
            CompletionShell::Fish => write!(f, "fish"),
            CompletionShell::PowerShell => write!(f, "powershell"),
            CompletionShell::Zsh => write!(f, "zsh"),
        }
    }
}

#[derive(clap::Subcommand, Debug)]
enum QuickCommands {
    /// Print different discovered or built values to stdout
    Print {
        #[command(subcommand)]
        commands: print::PrintCommands,
    },
    /// Generate shell completions for ghjk
    Completions {
        /// Target shell
        #[arg(value_enum)]
        shell: CompletionShell,
    },
    /// Setup your working directory for ghjk usage
    Init {
        #[command(subcommand)]
        commands: init::InitCommands,
    },
    /// Access the deno cli
    Deno {
        #[arg(raw(true))]
        args: String,
    },
}

/// TODO: keep more of this in deno next time it's updated
pub fn deno_quick_cli() -> Option<()> {
    let argv = std::env::args_os().skip(1).collect::<Vec<_>>();
    let first = argv.first()?;
    if first != "deno" {
        return None;
    }
    deno::util::unix::raise_fd_limit();
    deno::util::windows::ensure_stdio_open();
    deno_runtime::deno_permissions::set_prompt_callbacks(
        Box::new(deno::util::draw_thread::DrawThread::hide),
        Box::new(deno::util::draw_thread::DrawThread::show),
    );

    let future = async move {
        // NOTE(lucacasonato): due to new PKU feature introduced in V8 11.6 we need to
        // initialize the V8 platform on a parent thread of all threads that will spawn
        // V8 isolates.
        let flags = deno::resolve_flags_and_init(argv)?;
        deno::run_subcommand(Arc::new(flags)).await
    };

    let result = deno_runtime::tokio_util::create_and_run_current_thread_with_maybe_metrics(future);

    match result {
        Ok(exit_code) => deno_runtime::exit(exit_code),
        Err(err) => exit_for_error(err),
    }
}

fn exit_with_message(message: &str, code: i32) -> ! {
    tracing::error!("error: {}", message.trim_start_matches("error: "));
    deno_runtime::exit(code);
}

fn exit_for_error(error: anyhow::Error) -> ! {
    let mut error_string = format!("{error:?}");
    let error_code = 1;

    if let Some(e) = error.downcast_ref::<deno_core::error::JsError>() {
        error_string = deno_runtime::fmt_errors::format_js_error(e);
    } /* else if let Some(SnapshotFromLockfileError::IntegrityCheckFailed(e)) =
          error.downcast_ref::<SnapshotFromLockfileError>()
      {
          error_string = e.to_string();
          error_code = 10;
      } */

    exit_with_message(&error_string, error_code);
}
