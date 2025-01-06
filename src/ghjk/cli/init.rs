use crate::interlude::*;

use crate::config::Config;

use std::io::IsTerminal;

#[derive(clap::Subcommand, Debug)]
pub enum InitCommands {
    /// Create a starter typescript ghjkfile (ghjk.ts) in the current directory.    
    Ts {
        /// Auto confirm every choice.
        #[clap(long)]
        yes: bool,
    },
    /// Interactively configure working directory for best LSP
    /// support of ghjk.ts.
    TsLsp {
        /// Auto confirm every choice.
        #[clap(long)]
        yes: bool,
    },
}

impl InitCommands {
    pub async fn action(self, cli_config: &Config) -> Res<()> {
        match self {
            InitCommands::Ts { yes } => self.init(cli_config, yes).await,
            InitCommands::TsLsp { yes } => self.init_ts_lsp(cli_config, yes).await,
        }
    }

    async fn init(self, cli_config: &Config, yes: bool) -> Res<()> {
        if let Some(path) = &cli_config.ghjkdir {
            eyre::bail!(
                "conflict, already in ghjkdir context located at {}",
                path.display()
            );
        }
        /* if let Some(path) = cli_config.ghjkfile {
            eyre::bail!("conflict, another ghjkfile located at {}", path.display());
        } */
        let cwd = std::env::current_dir().expect_or_log("cwd error");
        let path = cli_config
            .ghjkfile
            .clone()
            .unwrap_or_else(|| cwd.join("ghjk.ts"));
        if !crate::utils::file_exists(&path).await? {
            const TEMPLATE_TS: &str = include_str!("../../../examples/template.ts");
            let re = regex::Regex::new("from \"../(.*)\"; // template-import")
                .expect_or_log("regex error");

            let contents =
                re.replace_all(TEMPLATE_TS, format!("from \"{}$1\";", cli_config.repo_root));

            tokio::fs::write(&path, &contents[..])
                .await
                .wrap_err_with(|| format!("error writing out ghjk.ts at {}", path.display()))?;

            info!(path = %path.display(),"written out ghjk.ts");
        }
        self.init_ts_lsp(cli_config, yes).await
    }

    async fn init_ts_lsp(self, cli_config: &Config, yes: bool) -> Res<()> {
        let cwd = cli_config
            .ghjkdir
            .as_ref()
            .map(|path| path.parent().unwrap().to_owned())
            .unwrap_or_else(|| std::env::current_dir().expect_or_log("cwd error"));
        let ghjkfile_path = cli_config
            .ghjkfile
            .clone()
            .unwrap_or_else(|| cwd.join("ghjk.ts"));

        let change_vscode_settings = yes
            || std::io::stderr().is_terminal()
            && tokio::task::spawn_blocking({
                let path = ghjkfile_path.clone();
                move || {
                    dialoguer::Confirm::new()
                        .with_prompt(format!(
                        "Configure deno lsp to selectively enable on {} through .vscode/settings.json (no support for json5)?",
                        path.clone().display()
                    ))
                        .default(true)
                        .interact()
                }
            })
            .await
            .expect_or_log("tokio error")
            .wrap_err("prompt error")?;

        if change_vscode_settings {
            let default = ".vscode/settings.json".to_owned();
            let vscode_path_raw = if std::io::stderr().is_terminal() {
                tokio::task::spawn_blocking(move || {
                    dialoguer::Input::new()
                        .with_prompt("Path to .vscode/settings.json ghjk working dir")
                        .default(default)
                        .interact_text()
                })
                .await
                .expect_or_log("tokio error")
                .wrap_err("prompt error")?
            } else {
                default
            };
            handle_vscode_settings(
                ghjkfile_path.clone(),
                cwd.join(vscode_path_raw),
                cwd.clone(),
            )
            .await
            .wrap_err("error modifying vscode settings")?;
        }

        if crate::utils::file_exists(&ghjkfile_path).await? {
            let content = tokio::fs::read_to_string(&ghjkfile_path)
                .await
                .wrap_err_with(|| {
                    format!("error reading ghjkfile at {}", ghjkfile_path.display())
                })?;
            let re = regex::Regex::new("@ts-nocheck").expect_or_log("regex error");
            if !re.is_match(&content) {
                let change_ghjkts = yes
                    || std::io::stderr().is_terminal()
                        && tokio::task::spawn_blocking({
                            let path = ghjkfile_path.clone();
                            move || {
                                dialoguer::Confirm::new()
                                    .with_prompt(format!(
                                        "Mark {} with @ts-nocheck?",
                                        path.clone().display()
                                    ))
                                    .default(true)
                                    .interact()
                            }
                        })
                        .await
                        .expect_or_log("tokio error")
                        .wrap_err("prompt error")?;

                if change_ghjkts {
                    let content = format!(
                        r#"
// @ts-nocheck: Ghjkfile based on Deno

{content}"#
                    );
                    tokio::fs::write(&ghjkfile_path, content).await?;
                    info!("Added @ts-nocheck mark to {}", ghjkfile_path.display());
                }
            } else {
                info!(
                    "@ts-nocheck detected in {}, skipping",
                    ghjkfile_path.display()
                );
            }
        }
        Ok(())
    }
}

async fn handle_vscode_settings(
    ghjkfile_path: PathBuf,
    vscode_path: PathBuf,
    cwd: PathBuf,
) -> Res<()> {
    if !crate::utils::file_exists(&vscode_path).await? {
        warn!(
            "No file found at {}, creating a new one.",
            vscode_path.display()
        );

        let config = json!({
            "deno.enablePaths": [
                ghjkfile_path,
            ],
        });

        if let Some(parent) = vscode_path.parent() {
            tokio::fs::create_dir_all(parent).await?;
        }

        tokio::fs::write(
            &vscode_path,
            serde_json::to_vec(&config).expect_or_log("json error"),
        )
        .await?;

        info!("Wrote config to {}", vscode_path.display());

        return Ok(());
    }

    let found_conf_raw = tokio::fs::read(&vscode_path).await?;
    let found_conf_raw: serde_json::Value = serde_json::from_slice(&found_conf_raw)
        .wrap_err_with(|| format!("error parsing json at {}", vscode_path.display()))?;

    #[derive(Deserialize, Serialize)]
    struct DenoSection {
        #[serde(rename = "enablePaths")]
        enable_paths: Option<Vec<PathBuf>>,
        #[serde(rename = "disablePaths")]
        disable_paths: Option<Vec<PathBuf>>,
    }
    #[derive(Deserialize, Serialize)]
    struct RelevantSettings {
        #[serde(rename = "deno.enablePaths")]
        enable_paths_base: Option<Vec<PathBuf>>,
        #[serde(rename = "deno.disablePaths")]
        disable_paths_base: Option<Vec<PathBuf>>,
        deno: Option<DenoSection>,
    }

    let mut relevant_conf: RelevantSettings = serde_json::from_value(found_conf_raw.clone())
        .wrap_err("expecting root to be a JSON object")
        .wrap_err("error parsing vscode settings json")?;

    let mut write_out = false;

    // Do some basic sanity checks
    if let Some(paths) = relevant_conf.disable_paths_base.as_mut() {
        if paths.iter().any(|path| cwd.join(path) == ghjkfile_path) {
            eyre::bail!(
                "{} detected in \"deno.disablePaths\". Confused :/",
                ghjkfile_path.display()
            );
        }
    }
    if let Some(Some(paths)) = relevant_conf.deno.as_mut().map(|deno| &deno.disable_paths) {
        if paths.iter().any(|path| cwd.join(path) == ghjkfile_path) {
            eyre::bail!(
                "{} detected in \"deno.disablePaths\". Confused :/",
                ghjkfile_path.display()
            );
        }
    }

    if let Some(paths) = relevant_conf.enable_paths_base.as_mut() {
        if !paths.iter().any(|path| cwd.join(path) == ghjkfile_path) {
            info!("Adding {} to \"deno.enablePaths\"", ghjkfile_path.display());
            paths.push(ghjkfile_path.clone());
            write_out = true;
        } else {
            info!(
                "Detected {} in deno.enablePaths, skipping",
                ghjkfile_path.display()
            );
        }
    } else if let Some(Some(paths)) = relevant_conf
        .deno
        .as_mut()
        .map(|deno| &mut deno.enable_paths)
    {
        if !paths.iter().any(|path| cwd.join(path) == ghjkfile_path) {
            info!("Adding {} to deno.enablePaths", ghjkfile_path.display());
            paths.push(ghjkfile_path.clone());
            write_out = true;
        } else {
            info!(
                "Detected {} in deno.enablePaths, skipping",
                ghjkfile_path.display()
            );
        }
    } else {
        relevant_conf.enable_paths_base = Some(vec![ghjkfile_path.clone()]);
        info!("Adding {} to \"deno.enablePaths\"", ghjkfile_path.display());
        write_out = true;
    }
    if write_out {
        let out_json = found_conf_raw.destructure_into_self(json!(relevant_conf));
        let out_json = serde_json::to_vec_pretty(&out_json).expect_or_log("json error");

        tokio::fs::write(&vscode_path, out_json).await?;

        info!("Wrote .vscode settings to {}", vscode_path.display());
    }

    Ok(())
}
