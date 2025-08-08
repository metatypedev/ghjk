use crate::interlude::*;

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
pub struct Config {
    pub ghjkfile: Option<PathBuf>,
    pub ghjkdir: Option<PathBuf>,
    pub data_dir: PathBuf,
    pub deno_dir: PathBuf,
    pub deno_json: Option<PathBuf>,
    pub deno_lockfile: Option<PathBuf>,
    pub import_map: Option<PathBuf>,
    pub repo_root: url::Url,
    pub deno_no_lockfile: bool,
    /// How ghjk CLI completions are provided
    /// - activators: embed completions into activation scripts (default)
    /// - off: disable completions generation/embedding
    pub completions: CompletionsMode,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum CompletionsMode {
    #[serde(alias = "on", alias = "activator", alias = "activators")]
    Activators,
    #[serde(alias = "disabled", alias = "no", alias = "false")]
    Off,
}

#[derive(Deserialize)]
struct GlobalConfigFile {
    data_dir: Option<PathBuf>,
    deno_dir: Option<PathBuf>,
    repo_root: Option<String>,
    completions: Option<CompletionsMode>,
}

#[derive(Deserialize)]
struct LocalConfigFile {
    #[serde(flatten)]
    global: GlobalConfigFile,
    deno_json: Option<PathBuf>,
    deno_lockfile: Option<String>,
    import_map: Option<PathBuf>,
}

impl Config {
    pub async fn source() -> Res<Self> {
        let cwd = std::env::current_dir()?;
        let xdg_dirs = directories::ProjectDirs::from("", "", "ghjk")
            .expect_or_log("unable to resolve home dir");

        let ghjkdir_path = match path_from_env(&cwd, "GHJKDIR")? {
            Some(val) => Some(val),
            None => crate::utils::find_entry_recursive(&cwd, ".ghjk")
                .await
                .wrap_err("error trying to locate a .ghjk dir")?,
        };

        let ghjkfile_path = match path_from_env(&cwd, "GHJKFILE")? {
            Some(val) => Some(val),
            None => {
                // NOTE: look for typescript ghjkfile
                let ghjkfile_name = "ghjk.ts";
                match &ghjkdir_path {
                    Some(ghjkfile_path) => {
                        crate::utils::find_entry_recursive(
                            ghjkfile_path.parent().expect_or_log("invalid GHJKDIR path"),
                            ghjkfile_name,
                        )
                        .await?
                    }
                    None => crate::utils::find_entry_recursive(&cwd, ghjkfile_name)
                        .await
                        .wrap_err_with(|| {
                            format!("error trying to locate a ghjkfile of kind \"{ghjkfile_name}\"")
                        })?,
                }
            }
        };

        // if ghjkfile var is set, set the GHJKDIR overriding
        // any set by the user
        let (ghjkfile_path, ghjkdir_path) = if let Some(path) = ghjkfile_path {
            let file_path = tokio::fs::canonicalize(&path)
                .await
                .wrap_err_with(|| format!("error canonicalizing ghjkfile path at {path:?}"))?;
            let dir_path = file_path.parent().unwrap().join(".ghjk");
            (Some(file_path), Some(dir_path))
        } else {
            (None, ghjkdir_path)
        };

        if ghjkdir_path.is_none() && ghjkfile_path.is_none() {
            warn!(
                "ghjk could not find any ghjkfiles or ghjkdirs, try creating a `ghjk.ts` script.",
            );
        }

        let mut config = Config {
            ghjkfile: ghjkfile_path,
            ghjkdir: ghjkdir_path.clone(),
            data_dir: xdg_dirs.data_dir().to_owned(),
            deno_dir: xdg_dirs.data_dir().join("deno"),
            deno_json: ghjkdir_path.as_ref().map(|path| path.join("deno.jsonc")),
            // these are set by setup_deno_json below
            import_map: None,
            deno_lockfile: None,
            deno_no_lockfile: false,
            completions: CompletionsMode::Activators,
            repo_root: {
                if cfg!(debug_assertions) {
                    url::Url::from_file_path(&cwd)
                        .expect_or_log("cwd error")
                        .join(&format!("{}/", cwd.file_name().unwrap().to_string_lossy()))
                        .wrap_err("repo url error")?
                } else {
                    const BASE_URL: &str = "https://raw.githubusercontent.com/metatypedev/ghjk/";
                    // repo root url must end in slash due to
                    // how Url::join works
                    let url = BASE_URL.to_owned() + crate::shadow::COMMIT_HASH + "/";
                    url::Url::parse(&url).expect("repo url error")
                }
            },
        };

        let global_config_path = match path_from_env(&cwd, "GHJK_CONFIG_DIR")? {
            Some(val) => val,
            None => xdg_dirs.config_dir().join("config"),
        };

        // we use builtin config-rs File implementation
        // which relies on sync std
        let mut config = tokio::task::spawn_blocking(move || {
            {
                config
                    .source_global_config(&global_config_path)
                    .wrap_err_with(|| {
                        format!("error sourcing global config from {global_config_path:?}")
                    })?;
            }

            if let Some(ghjkdir_path) = &ghjkdir_path {
                let file_path = ghjkdir_path.join("config");
                config
                    .source_local_config(&file_path)
                    .wrap_err_with(|| format!("error sourcing local config from {file_path:?}"))?;
            };

            config
                .source_env_config(&cwd)
                .wrap_err("error sourcing config from environment variables")?;

            if !config.repo_root.path().ends_with("/") {
                config
                    .repo_root
                    .set_path(&format!("{}/", config.repo_root.path()));
            }

            eyre::Ok(config)
        })
        .await
        .expect_or_log("tokio error")?;

        // create .gitignore
        if let Some(path) = &config.ghjkdir {
            let ignore_path = path.join(".gitignore");
            if !crate::utils::file_exists(&ignore_path).await? {
                tokio::fs::create_dir_all(path)
                    .await
                    .wrap_err_with(|| format!("error creating ghjkdir at {path:?}"))?;
                tokio::fs::write(
                    &ignore_path,
                    "envs
hash.json",
                )
                .await
                .wrap_err_with(|| format!("error writing ignore file at {ignore_path:?}"))?;
            }
        }
        // create deno.json
        config
            .setup_deno_json()
            .await
            .wrap_err("error setting up deno.json")?;
        Ok(config)
    }

    fn source_global_config(&mut self, file_path: &Path) -> Res<()> {
        let GlobalConfigFile {
            deno_dir,
            data_dir,
            repo_root,
            completions,
        } = config::Config::builder()
            .add_source(config::File::with_name(&file_path.to_string_lossy()[..]).required(false))
            .build()
            .wrap_err("error reading config file")?
            .try_deserialize()
            .wrap_err("error deserializing config file")?;
        let parent = file_path
            .parent()
            .ok_or_else(|| ferr!("error getting path to config parent dir"))?;
        if let Some(path) = data_dir {
            self.data_dir =
                resolve_config_path(&path, parent).wrap_err("error resolving data_dir")?;
        }
        if let Some(path) = deno_dir {
            self.deno_dir =
                resolve_config_path(&path, parent).wrap_err("error resolving deno_dir")?;
        }
        if let Some(path) = repo_root {
            self.repo_root = deno_core::resolve_url_or_path(&path, file_path)
                .map_err(|err| ferr!(Box::new(err)))
                .wrap_err("error resolving repo_root")?;
        }
        if let Some(mode) = completions {
            self.completions = mode;
        }
        Ok(())
    }

    fn source_local_config(&mut self, file_path: &Path) -> Res<()> {
        let LocalConfigFile {
            global:
                GlobalConfigFile {
                    data_dir,
                    deno_dir,
                    repo_root,
                    completions,
                },
            deno_lockfile,
            import_map,
            deno_json,
        } = config::Config::builder()
            .add_source(config::File::with_name(&file_path.to_string_lossy()).required(false))
            .build()
            .wrap_err("error reading config file")?
            .try_deserialize()
            .wrap_err("error deserializing config file")?;

        let parent = file_path
            .parent()
            .ok_or_else(|| ferr!("error getting path to config parent dir"))?;
        if let Some(path) = data_dir {
            self.data_dir =
                resolve_config_path(&path, parent).wrap_err("error resolving data_dir")?;
        }
        if let Some(path) = deno_dir {
            self.deno_dir =
                resolve_config_path(&path, parent).wrap_err("error resolving deno_dir")?;
        }
        if let Some(path) = import_map {
            // we want to disable the default deno.jsonc if import_map
            // is set
            if deno_json.is_none() {
                self.deno_json = None
            }
            self.import_map =
                Some(resolve_config_path(&path, parent).wrap_err("error resolving import_map")?);
        }
        if let Some(path) = deno_json {
            self.deno_json =
                Some(resolve_config_path(&path, parent).wrap_err("error resolving deno_json")?);
        }
        if let Some(path) = deno_lockfile {
            self.deno_lockfile = if path != "off" {
                Some(resolve_config_path(&path, parent).wrap_err("error resolving deno_lockfile")?)
            } else {
                self.deno_no_lockfile = true;
                None
            };
        }
        if let Some(path) = repo_root {
            self.repo_root = deno_core::resolve_url_or_path(&path, parent)
                .map_err(|err| ferr!(Box::new(err)))
                .wrap_err("error resolving repo_root")?;
        }
        if let Some(mode) = completions {
            self.completions = mode;
        }
        Ok(())
    }

    fn source_env_config(&mut self, cwd: &Path) -> Res<()> {
        let LocalConfigFile {
            global:
                GlobalConfigFile {
                    data_dir,
                    deno_dir,
                    repo_root,
                    completions,
                },
            deno_lockfile,
            import_map,
            deno_json,
        } = config::Config::builder()
            .add_source(config::Environment::with_prefix("GHJK"))
            .build()
            .wrap_err("error reading config file")?
            .try_deserialize()
            .wrap_err("error deserializing config file")?;

        if let Some(path) = data_dir {
            self.data_dir = resolve_config_path(&path, cwd).wrap_err("error resolving data_dir")?;
        }
        if let Some(path) = deno_dir {
            self.deno_dir = resolve_config_path(&path, cwd).wrap_err("error resolving deno_dir")?;
        }
        if let Some(path) = import_map {
            // we want to disable the default deno.jsonc if import_map
            // is set
            if deno_json.is_none() {
                self.deno_json = None
            }
            self.import_map =
                Some(resolve_config_path(&path, cwd).wrap_err("error resolving import_map")?);
        }
        if let Some(path) = deno_json {
            self.deno_json =
                Some(resolve_config_path(&path, cwd).wrap_err("error resolving deno_json")?);
        }
        if let Some(path) = deno_lockfile {
            self.deno_lockfile = if path != "off" {
                Some(resolve_config_path(&path, cwd).wrap_err("error resolving deno_lockfile")?)
            } else {
                self.deno_no_lockfile = true;
                None
            };
        }
        if let Some(path) = repo_root {
            self.repo_root = deno_core::resolve_url_or_path(&path, cwd)
                .map_err(|err| ferr!(Box::new(err)))
                .wrap_err("error resolving repo_root")?;
        }
        if let Some(mode) = completions {
            self.completions = mode;
        }
        Ok(())
    }

    async fn setup_deno_json(&mut self) -> Res<()> {
        let Some(deno_json_path) = &self.deno_json else {
            return Ok(());
        };
        match tokio::fs::read_to_string(deno_json_path).await {
            Ok(raw) => {
                use deno::deno_config::deno_json::{ConfigFile, LockConfig};
                let config = ConfigFile::new(&raw, "file:///INLINE".parse().unwrap())
                    .wrap_err("error parsing deno.json")?;

                let parent = deno_json_path.parent().unwrap();

                // we always give preference to env vars
                if std::env::var("GHJK_DENO_LOCKFILE").is_err() {
                    // make sure the lockfile path from deno.json is preferred
                    match config
                        .to_lock_config()
                        .map_err(denort::anyhow_to_eyre!())
                        .wrap_err("error parsing deno.json lock section")?
                    {
                        Some(LockConfig::Object {
                            path: Some(path), ..
                        })
                        | Some(LockConfig::PathBuf(path)) => {
                            self.deno_lockfile = if path.starts_with("/./") {
                                // remove the weird prefix
                                Some(parent.join(path.strip_prefix("/./").unwrap()))
                            } else {
                                Some(parent.join(path))
                            };
                        }
                        _ => {
                            if self.deno_lockfile.is_none() {
                                self.deno_lockfile = Some(parent.join("deno.lock"))
                            }
                        }
                    }
                }

                Ok(())
            }
            // create the deno.json file if it doesn't exist
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
                let parent = deno_json_path
                    .parent()
                    .expect_or_log("deno_json path error");
                tokio::fs::create_dir_all(&parent)
                    .await
                    .wrap_err_with(|| format!("error creating ghjkdir at {deno_json_path:?}"))?;
                let mut deno_json = json!({});
                if let Some(import_map_path) = &self.import_map {
                    deno_json = deno_json.destructure_into_self(json!({
                        "importMap": pathdiff::diff_paths(import_map_path, parent)
                            .unwrap_or_else(|| import_map_path.clone())
                    }))
                } else {
                    deno_json = deno_json.destructure_into_self(json!({
                        "imports": {
                            "@ghjk/ts/": self.repo_root.join("./src/ghjk_ts/").expect_or_log("repo root error").to_string(),
                            "@ghjk/ts": self.repo_root.join("./src/ghjk_ts/mod.ts").expect_or_log("repo root error").to_string(),
                            "@ghjk/ports_wip": self.repo_root.join("./ports/mod.ts").expect_or_log("repo root error").to_string(),
                            "@ghjk/ports_wip/": self.repo_root.join("./ports/").expect_or_log("repo root error").to_string(),
                        },
                    }));
                }
                if self.deno_no_lockfile {
                    deno_json = deno_json.destructure_into_self(json!({
                        "lock": false
                    }))
                } else if let Some(deno_lockfile_path) = &self.deno_lockfile {
                    deno_json = deno_json.destructure_into_self(json!({
                        "lock": pathdiff::diff_paths(deno_lockfile_path, parent)
                            .unwrap_or_else(|| deno_lockfile_path.clone())
                    }))
                } else {
                    deno_json = deno_json.destructure_into_self(json!({
                        "lock": "./deno.lock",
                    }))
                }
                tokio::fs::write(
                    &deno_json_path,
                    serde_json::to_vec_pretty(&deno_json).expect_or_log("json error"),
                )
                .await
                .wrap_err_with(|| format!("error writing deno_json file at {deno_json_path:?}"))?;

                Ok(())
            }
            Err(err) => Err(err.into()),
        }
    }
}

fn resolve_config_path(path: impl AsRef<Path>, config_path: &Path) -> Res<PathBuf> {
    let path = config_path.join(&path);
    let path = std::path::absolute(&path)
        .wrap_err_with(|| format!("error absolutizing path at {path:?}"))?;
    Ok(path)
}

fn path_from_env(cwd: &Path, env_name: &str) -> Res<Option<PathBuf>> {
    let path = match std::env::var(env_name) {
        Ok(path) => Some(PathBuf::from(path)),
        Err(std::env::VarError::NotUnicode(os_str)) => Some(PathBuf::from(os_str)),
        Err(std::env::VarError::NotPresent) => None,
    };

    if let Some(path) = path {
        let path = cwd.join(&path);

        Ok(Some(std::path::absolute(&path).wrap_err_with(|| {
            format!("error absolutizing path {path:?} from env ${env_name}")
        })?))
    } else {
        Ok(None)
    }
}
