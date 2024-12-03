use crate::interlude::*;

use crate::systems::{CliCommandAction, SystemCliCommand};
use crate::{host, systems, utils, Config};

const DENO_UNSTABLE_FLAGS: &[&str] = &["worker-options", "kv"];

pub async fn cli() -> Res<()> {
    let cwd = std::env::current_dir()?;

    let config = {
        let ghjk_dir_path = match std::env::var("GHJK_DIR") {
            Ok(path) => Some(PathBuf::from(path)),
            Err(std::env::VarError::NotUnicode(os_str)) => Some(PathBuf::from(os_str)),
            Err(std::env::VarError::NotPresent) => {
                utils::find_entry_recursive(&cwd, ".ghjk").await?
            }
        };

        let ghjk_dir_path = if let Some(path) = ghjk_dir_path {
            Some(tokio::fs::canonicalize(path).await?)
        } else {
            None
        };

        let ghjkfile_path = match &ghjk_dir_path {
            Some(ghjkfile_path) => {
                utils::find_entry_recursive(
                    ghjkfile_path
                        .parent()
                        .expect_or_log("invalid GHJK_DIR path"),
                    "ghjk.ts",
                )
                .await?
            }
            None => utils::find_entry_recursive(&cwd, "ghjk.ts").await?,
        };

        let ghjkfile_path = if let Some(path) = ghjkfile_path {
            Some(tokio::fs::canonicalize(path).await?)
        } else {
            None
        };

        if ghjk_dir_path.is_none() && ghjkfile_path.is_none() {
            warn!(
                "ghjk could not find any ghjkfiles or ghjkdirs, try creating a `ghjk.ts` script.",
            );
        }

        let share_dir_path = match std::env::var("GHJK_SHARE_DIR") {
            Ok(path) => PathBuf::from(path),
            Err(std::env::VarError::NotUnicode(os_str)) => PathBuf::from(os_str),
            Err(std::env::VarError::NotPresent) => directories::BaseDirs::new()
                .expect_or_log("unable to resolve home dir")
                .data_local_dir()
                .join("ghjk"),
        };
        Config {
            ghjkfile_path,
            ghjkdir_path: ghjk_dir_path,
            share_dir_path,
        }
    };

    let Some(quick_err) = try_quick_cli(&config).await? else {
        return Ok(());
    };

    let Some(ghjk_dir_path) = config.ghjkdir_path.clone() else {
        quick_err.exit();
    };

    let deno_cx = denort::worker(
        denort::deno::args::Flags {
            unstable_config: denort::deno::args::UnstableConfig {
                features: DENO_UNSTABLE_FLAGS
                    .iter()
                    .copied()
                    .map(String::from)
                    .collect(),
                ..default()
            },
            ..default()
        },
        Some(Arc::new(Vec::new)),
    )
    .await?;

    let gcx = GhjkCtx {
        ghjk_dir_path,
        ghjkfile_path: config.ghjkfile_path.clone(),
        share_dir_path: config.share_dir_path.clone(),
        repo_root: url::Url::from_file_path(&cwd)
            .expect_or_log("cwd error")
            // repo root url must end in slash due to
            // how Url::join works
            .join(&format!("{}/", cwd.file_name().unwrap().to_string_lossy()))
            .wrap_err("repo url error")?,
        deno: deno_cx.clone(),
    };
    let gcx = Arc::new(gcx);

    let systems_deno = systems::deno::systems_from_deno(
        &gcx,
        &gcx.repo_root
            .join("src/deno_systems/mod.ts")
            .wrap_err("repo url error")?,
    )
    .await?;

    let hcx = host::HostCtx::new(
        gcx,
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

    let Some(mut systems) = host::systems_from_ghjkfile(hcx).await? else {
        warn!("no ghjkfile found");
        quick_err.exit()
    };

    // let conf_json = serde_json::to_string_pretty(&systems.config)?;
    // info!(%conf_json);

    use clap::*;

    let mut root_cmd = Cli::command();

    debug!("colleting system commands");

    let (sys_cmds, sys_actions) = match commands_from_systems(&systems).await {
        Ok(val) => val,
        Err(err) => {
            systems.write_lockfile_or_log().await;
            return Err(err);
        }
    };

    for cmd in sys_cmds {
        root_cmd = root_cmd.subcommand(cmd);
    }

    let matches = match root_cmd.try_get_matches() {
        Ok(val) => val,
        Err(err) => {
            systems.write_lockfile_or_log().await;
            err.exit();
        }
    };

    match QuickComands::from_arg_matches(&matches) {
        Ok(QuickComands::Print { commands }) => {
            _ = commands.action(&config, Some(&systems.config))?;
            return Ok(());
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

    let Some(action) = action.action else {
        action.clap.print_long_help()?;
        systems.write_lockfile_or_log().await;
        return Ok(());
    };

    let res = action(action_matches.clone())
        .await
        .wrap_err_with(|| format!("errror on system command at path {cmd_path:?}"));

    systems.write_lockfile_or_log().await;

    deno_cx.terminate().await?;

    res
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
    }

    Ok(None)
}

#[derive(clap::Parser, Debug)]
#[command(version, about)]
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
}

#[derive(clap::Subcommand, Debug)]
enum PrintCommands {
    /// Print the path where ghjk is installed in.
    ShareDirPath,
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
            PrintCommands::ShareDirPath => {
                println!("{}", cli_config.share_dir_path.display());
                true
            }
            // TODO: rename GHJK_DIR to GHJKDIR
            PrintCommands::GhjkdirPath => {
                if let Some(path) = &cli_config.ghjkdir_path {
                    // TODO: graceful termination on SIGPIPE
                    println!("{}", path.display());
                    true
                } else {
                    eyre::bail!("no ghjkdir found.");
                }
            }
            PrintCommands::GhjkfilePath => {
                if let Some(path) = &cli_config.ghjkdir_path {
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
    let mut actions = SysCmdActions::new();
    for (id, sys_inst) in &systems.sys_instances {
        let cmds = sys_inst
            .commands()
            .await
            .wrap_err_with(|| format!("error getting commands for system: {id}"))?;
        for cmd in cmds {
            let (sys_cmd, clap_cmd) = inner(cmd);
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
