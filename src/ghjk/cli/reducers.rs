use crate::interlude::*;

use crate::systems::envs::types::{Provision, ProvisionReducer, WellKnownProvision};

use clap_complete::aot::{generate, Shell};
use futures::FutureExt;

/// Create a reducer that expands `ghjk.cli.Completions` into pre-generated completion scripts
pub fn ghjk_cli_completions_reducer(
    root_cmd: &clap::Command,
    sys_cmds: &[clap::Command],
    sys_actions: &IndexMap<CHeapStr, crate::cli::sys::SysCmdAction>,
    include_aliases: bool,
) -> ProvisionReducer {
    // Pre-generate scripts AOT and capture them
    let mut cmd = root_cmd.clone();

    let mut bash_completions = vec![];
    let mut zsh_completions = vec![];
    let mut fish_completions = vec![];

    bash_completions.push({
        let mut root_bash: Vec<u8> = Vec::new();
        generate(
            Shell::Bash,
            &mut cmd.clone(),
            "ghjk".to_string(),
            &mut root_bash,
        );
        String::from_utf8(root_bash).unwrap_or_default()
    });
    zsh_completions.push({
        let mut root_zsh: Vec<u8> = Vec::new();
        generate(
            Shell::Zsh,
            &mut cmd.clone(),
            "ghjk".to_string(),
            &mut root_zsh,
        );
        String::from_utf8(root_zsh).unwrap_or_default()
    });
    fish_completions.push({
        let mut root_fish: Vec<u8> = Vec::new();
        generate(Shell::Fish, &mut cmd, "ghjk".to_string(), &mut root_fish);
        String::from_utf8(root_fish).unwrap_or_default()
    });

    if include_aliases {
        if let Some(x_cmd) = sys_cmds.iter().find(|c| c.get_name() == "tasks") {
            bash_completions.push({
                let mut x_cmd_bash: Vec<u8> = Vec::new();
                generate(
                    Shell::Bash,
                    &mut x_cmd.clone(),
                    "x".to_string(),
                    &mut x_cmd_bash,
                );
                String::from_utf8(x_cmd_bash).unwrap_or_default()
            });
            zsh_completions.push({
                let mut x_cmd_zsh: Vec<u8> = Vec::new();
                generate(
                    Shell::Zsh,
                    &mut x_cmd.clone(),
                    "x".to_string(),
                    &mut x_cmd_zsh,
                );
                String::from_utf8(x_cmd_zsh).unwrap_or_default()
            });
            fish_completions.push({
                let mut x_cmd_fish: Vec<u8> = Vec::new();
                generate(
                    Shell::Fish,
                    &mut x_cmd.clone(),
                    "x".to_string(),
                    &mut x_cmd_fish,
                );
                String::from_utf8(x_cmd_fish).unwrap_or_default()
            });
        }
        let task_cmds = sys_actions
            .get("tasks")
            .map(|c| c.sub_commands.values().map(|c| &c.clap).collect::<Vec<_>>())
            .unwrap_or_default();
        for task_cmd in task_cmds {
            bash_completions.push({
                let mut task_cmd_bash: Vec<u8> = Vec::new();
                generate(
                    Shell::Bash,
                    &mut task_cmd.clone(),
                    task_cmd.get_name(),
                    &mut task_cmd_bash,
                );
                String::from_utf8(task_cmd_bash).unwrap_or_default()
            });
            zsh_completions.push({
                let mut task_cmd_zsh: Vec<u8> = Vec::new();
                generate(
                    Shell::Zsh,
                    &mut task_cmd.clone(),
                    task_cmd.get_name(),
                    &mut task_cmd_zsh,
                );
                String::from_utf8(task_cmd_zsh).unwrap_or_default()
            });
            fish_completions.push({
                let mut task_cmd_fish: Vec<u8> = Vec::new();
                generate(
                    Shell::Fish,
                    &mut task_cmd.clone(),
                    task_cmd.get_name(),
                    &mut task_cmd_fish,
                );
                String::from_utf8(task_cmd_fish).unwrap_or_default()
            });
        }
    }
    let bash_completions = Arc::new(bash_completions);
    let zsh_completions = Arc::new(zsh_completions);
    let fish_completions = Arc::new(fish_completions);

    Box::new(move |provisions: Vec<Provision>| {
        let has_trigger = provisions.iter().any(|p| match p {
            Provision::Strange(v) => {
                v.get("ty").and_then(|s| s.as_str()) == Some("ghjk.cli.Completions")
            }
            _ => false,
        });
        let bash_completions = bash_completions.clone();
        let zsh_completions = zsh_completions.clone();
        let fish_completions = fish_completions.clone();
        async move {
            let mut out = Vec::new();
            if has_trigger {
                out.extend(
                    bash_completions
                        .iter()
                        .map(|s| WellKnownProvision::GhjkCliCompletionBash { script: s.clone() }),
                );
                out.extend(
                    zsh_completions
                        .iter()
                        .map(|s| WellKnownProvision::GhjkCliCompletionZsh { script: s.clone() }),
                );
                out.extend(
                    fish_completions
                        .iter()
                        .map(|s| WellKnownProvision::GhjkCliCompletionFish { script: s.clone() }),
                );
            }
            Ok(out)
        }
        .boxed()
    })
}

/// Reducer that ignores CLI completion provisions (used when completions are disabled)
pub fn ghjk_cli_completions_noop_reducer() -> ProvisionReducer {
    use crate::systems::envs::types::Provision;
    use futures::FutureExt;
    Box::new(move |_provisions: Vec<Provision>| async move { Ok(Vec::new()) }.boxed())
}
