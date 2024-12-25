use std::process::ExitCode;

use clap::builder::styling::AnsiColor;

use crate::config::Config;
use crate::interlude::*;

use crate::systems::{CliCommandAction, SystemCliCommand};
use crate::{host, systems};

const DENO_UNSTABLE_FLAGS: &[&str] = &["worker-options", "kv"];

pub async fn cli() -> Res<std::process::ExitCode> {
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
            no_lock: config.deno_lockfile.is_none(),
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
            .join("src/deno_systems/mod.ts")
            .wrap_err("repo url error")?,
        &ghjkdir_path,
    )
    .await?;

    let hcx = host::HostCtx::new(
        gcx.clone(),
        host::Config {
            re_resolve: false,
            locked: false,
            re_serialize: false,
            env_vars: std::env::vars().collect(),
            cwd,
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

    let (sys_cmds, sys_actions) = match commands_from_systems(&systems).await {
        Ok(val) => val,
        Err(err) => {
            systems.write_lockfile_or_log().await;
            return Err(err);
        }
    };

    for cmd in sys_cmds {
        // apply styles again here due to propagation
        // breaking for these dynamic subcommands for some reason
        root_cmd = root_cmd.subcommand(cmd.styles(CLAP_STYLE));
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
        Ok(QuickComands::Deno { .. }) => {
            unreachable!("deno quick cli will prevent this")
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

    let (cmd_path, mut action, action_matches) = match action_for_match(sys_actions, &matches).await
    {
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
    /// Print different discovored or built values to stdout.
    Print {
        #[command(subcommand)]
        commands: PrintCommands,
    },
    /// Access the deno cli
    Deno {
        #[arg(raw(true))]
        args: String,
    },
}

#[derive(clap::Subcommand, Debug)]
enum PrintCommands {
    /// Print the path to the data dir used by ghjk.
    DataDirPath,
    /// Print the path to the dir of the currently active ghjk context.
    GhjkdirPath,
    /// Print the path of the ghjkfile used.
    GhjkfilePath,
    /// Print the extracted and serialized config from the ghjkfile.
    Config {
        /// Use json format when printing config.
        #[arg(long)]
        json: bool,
    },
}

impl PrintCommands {
    /// The return value specifies weather or not the CLI is done or
    /// weather it should continue on with serialization if this
    /// action was invoked as part of the quick cli
    fn action(
        self,
        cli_config: &Config,
        serialized_config: Option<&host::SerializedConfig>,
    ) -> Res<bool> {
        Ok(match self {
            PrintCommands::DataDirPath => {
                println!("{}", cli_config.data_dir.display());
                true
            }
            // TODO: rename GHJK_DIR to GHJKDIR
            PrintCommands::GhjkdirPath => {
                if let Some(path) = &cli_config.ghjkdir {
                    // TODO: graceful termination on SIGPIPE
                    println!("{}", path.display());
                    true
                } else {
                    eyre::bail!("no ghjkdir found.");
                }
            }
            PrintCommands::GhjkfilePath => {
                if let Some(path) = &cli_config.ghjkdir {
                    println!("{}", path.display());
                    true
                } else {
                    eyre::bail!("no ghjkfile found.");
                }
            }
            PrintCommands::Config { .. } => match serialized_config {
                Some(config) => {
                    let conf_json = serde_json::to_string_pretty(&config)?;
                    println!("{conf_json}");
                    true
                }
                None => false,
            },
        })
    }
}

type SysCmdActions = IndexMap<CHeapStr, SysCmdAction>;
struct SysCmdAction {
    name: CHeapStr,
    clap: clap::Command,
    action: Option<CliCommandAction>,
    sub_commands: SysCmdActions,
}

async fn commands_from_systems(
    systems: &host::GhjkfileSystems,
) -> Res<(Vec<clap::Command>, SysCmdActions)> {
    fn inner(cmd: SystemCliCommand) -> (SysCmdAction, clap::Command) {
        let mut clap_cmd = cmd.clap;
        let mut sub_commands = IndexMap::new();
        for (id, cmd) in cmd.sub_commands {
            let (sub_sys_cmd, sub_cmd) = inner(cmd);
            clap_cmd = clap_cmd.subcommand(sub_cmd);
            sub_commands.insert(id, sub_sys_cmd);
        }
        (
            SysCmdAction {
                clap: clap_cmd.clone(),
                name: cmd.name,
                action: cmd.action,
                sub_commands,
            },
            clap_cmd,
        )
    }
    let mut commands = vec![];
    let mut conflict_tracker = HashMap::new();
    let mut actions = SysCmdActions::new();
    for (id, sys_inst) in &systems.sys_instances {
        let cmds = sys_inst
            .commands()
            .await
            .wrap_err_with(|| format!("error getting commands for system: {id}"))?;
        for cmd in cmds {
            let (sys_cmd, clap_cmd) = inner(cmd);

            if let Some(conflict) = conflict_tracker.insert(sys_cmd.name.clone(), id) {
                eyre::bail!(
                    "system commannd conflict under name {:?} for modules {conflict:?} and {id:?}",
                    sys_cmd.name.clone(),
                );
            }
            actions.insert(sys_cmd.name.clone(), sys_cmd);
            commands.push(clap_cmd);
        }
    }
    Ok((commands, actions))
}

async fn action_for_match(
    mut actions: SysCmdActions,
    matches: &clap::ArgMatches,
) -> Res<(Vec<String>, SysCmdAction, &clap::ArgMatches)> {
    fn inner<'a>(
        mut current: SysCmdAction,
        matches: &'a clap::ArgMatches,
        cmd_path: &mut Vec<String>,
    ) -> Res<(SysCmdAction, &'a clap::ArgMatches)> {
        match matches.subcommand() {
            Some((cmd_name, matches)) => {
                cmd_path.push(cmd_name.into());
                match current.sub_commands.swap_remove(cmd_name) {
                    Some(action) => inner(action, matches, cmd_path),
                    None => {
                        eyre::bail!("no match found for cmd {cmd_path:?}")
                    }
                }
            }
            None => Ok((current, matches)),
        }
    }
    let mut cmd_path = vec![];
    let Some((cmd_name, matches)) = matches.subcommand() else {
        unreachable!("clap prevents this branch")
    };
    cmd_path.push(cmd_name.into());
    let Some(action) = actions.swap_remove(cmd_name) else {
        eyre::bail!("no match found for cmd {cmd_path:?}");
    };
    let (action, matches) = inner(action, matches, &mut cmd_path)?;
    Ok((cmd_path, action, matches))
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
