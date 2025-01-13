use crate::interlude::*;

use std::process::ExitCode;

use clap::builder::styling::AnsiColor;

use crate::config::Config;
use crate::{host, systems};

mod init;
mod print;
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

    let Some(quick_err) = try_quick_cli(&config).await? else {
        return Ok(ExitCode::SUCCESS);
    };

    let Some(ghjkdir_path) = config.ghjkdir.clone() else {
        quick_err.exit();
    };

    let deno_cx = {
        // TODO: DENO_FLAGS param simlar to V8_FLAGS
        let flags = denort::deno::args::Flags {
            unstable_config: denort::deno::args::UnstableConfig {
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
    };
    let gcx = Arc::new(gcx);

    let (systems_deno, deno_sys_cx) = systems::deno::systems_from_deno(
        &gcx,
        &gcx.config
            .repo_root
            .join("src/sys_deno/std.ts")
            .wrap_err("repo url error")?,
        &ghjkdir_path,
    )
    .await?;

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
        systems_deno,
    );

    let hcx = Arc::new(hcx);

    let Some(mut systems) = host::systems_from_ghjkfile(hcx, &ghjkdir_path).await? else {
        warn!("no ghjkfile found");
        quick_err.exit()
    };

    // let conf_json = serde_json::to_string_pretty(&systems.config)?;
    // info!(%conf_json);

    use clap::*;

    let mut root_cmd = Cli::command();

    debug!("collecting system commands");

    let (sys_cmds, sys_actions) = match sys::commands_from_systems(&systems).await {
        Ok(val) => val,
        Err(err) => {
            systems.write_lockfile_or_log().await;
            return Err(err);
        }
    };

    for cmd in sys_cmds {
        root_cmd = root_cmd.subcommand(cmd);
    }

    debug!("checking argv matches");

    let matches = match root_cmd.try_get_matches() {
        Ok(val) => val,
        Err(err) => {
            systems.write_lockfile_or_log().await;
            err.exit();
        }
    };

    match QuickComands::from_arg_matches(&matches) {
        Ok(QuickComands::Print { commands }) => {
            _ = commands.action(&gcx.config, Some(&systems.config))?;
            return Ok(ExitCode::SUCCESS);
        }
        Ok(QuickComands::Init { .. }) => {
            unreachable!("quick_cli will prevent this")
        }
        Ok(QuickComands::Deno { .. }) => {
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

/// Sections of the CLI do not require loading a ghjkfile.
pub async fn try_quick_cli(config: &Config) -> Res<Option<clap::Error>> {
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
                return Ok(Some(err));
            }
            err.exit();
        }
    };

    match cli.quick_commands {
        QuickComands::Print { commands } => {
            if !commands.action(config, None)? {
                return Ok(Some(clap::error::Error::new(
                    clap::error::ErrorKind::DisplayHelp,
                )));
            }
        }
        QuickComands::Init { commands } => commands.action(config).await?,
        QuickComands::Deno { .. } => unreachable!("deno quick cli will have prevented this"),
    }

    Ok(None)
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
    quick_commands: QuickComands,
}

#[derive(clap::Subcommand, Debug)]
enum QuickComands {
    /// Print different discovered or built values to stdout
    Print {
        #[command(subcommand)]
        commands: print::PrintCommands,
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
