use clap_complete::aot::{generate, Shell};
use futures::FutureExt;

/// Create a reducer that expands `ghjk.cli.Completions` into pre-generated completion scripts
pub fn ghjk_cli_completions_reducer(
    root_cmd: &clap::Command,
) -> crate::systems::envs::types::ProvisionReducer {
    use crate::systems::envs::types::{Provision, WellKnownProvision};

    // Pre-generate scripts AOT and capture them
    let mut cmd = root_cmd.clone();

    let mut bash: Vec<u8> = Vec::new();
    generate(Shell::Bash, &mut cmd.clone(), "ghjk".to_string(), &mut bash);
    let bash_script: std::sync::Arc<String> =
        std::sync::Arc::new(String::from_utf8(bash).unwrap_or_default());

    let mut zsh: Vec<u8> = Vec::new();
    generate(Shell::Zsh, &mut cmd.clone(), "ghjk".to_string(), &mut zsh);
    let zsh_script: std::sync::Arc<String> =
        std::sync::Arc::new(String::from_utf8(zsh).unwrap_or_default());

    let mut fish: Vec<u8> = Vec::new();
    generate(Shell::Fish, &mut cmd, "ghjk".to_string(), &mut fish);
    let fish_script: std::sync::Arc<String> =
        std::sync::Arc::new(String::from_utf8(fish).unwrap_or_default());

    Box::new(move |provisions: Vec<Provision>| {
        let has_trigger = provisions.iter().any(|p| match p {
            Provision::Strange(v) => {
                v.get("ty").and_then(|s| s.as_str()) == Some("ghjk.cli.Completions")
            }
            _ => false,
        });
        let bash_script_cloned = bash_script.clone();
        let zsh_script_cloned = zsh_script.clone();
        let fish_script_cloned = fish_script.clone();
        async move {
            let mut out = Vec::new();
            if has_trigger {
                out.push(WellKnownProvision::GhjkCliCompletionBash {
                    script: (*bash_script_cloned).clone(),
                });
                out.push(WellKnownProvision::GhjkCliCompletionZsh {
                    script: (*zsh_script_cloned).clone(),
                });
                out.push(WellKnownProvision::GhjkCliCompletionFish {
                    script: (*fish_script_cloned).clone(),
                });
            }
            Ok(out)
        }
        .boxed()
    })
}

/// Reducer that ignores CLI completion provisions (used when completions are disabled)
pub fn ghjk_cli_completions_noop_reducer() -> crate::systems::envs::types::ProvisionReducer {
    use crate::systems::envs::types::Provision;
    use futures::FutureExt;
    Box::new(move |_provisions: Vec<Provision>| async move { Ok(Vec::new()) }.boxed())
}
