use crate::interlude::*;

use crate::systems::{CliCommandAction, SystemCliCommand};

type SysCmdActions = IndexMap<CHeapStr, SysCmdAction>;

pub struct SysCmdAction {
    pub name: CHeapStr,
    pub clap: clap::Command,
    pub action: Option<CliCommandAction>,
    pub sub_commands: SysCmdActions,
}

pub async fn commands_from_systems(
    systems: &crate::host::GhjkfileSystems,
) -> Res<(Vec<clap::Command>, SysCmdActions)> {
    fn inner(cmd: SystemCliCommand) -> (SysCmdAction, clap::Command) {
        // apply styles here due to propagation
        // breaking for these dynamic subcommands for some reason
        let mut clap_cmd = cmd.clap.styles(super::CLAP_STYLE);
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
                    "system command conflict under name {:?} for modules {conflict:?} and {id:?}",
                    sys_cmd.name.clone(),
                );
            }
            actions.insert(sys_cmd.name.clone(), sys_cmd);
            commands.push(clap_cmd);
        }
    }
    Ok((commands, actions))
}

pub async fn action_for_match(
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
