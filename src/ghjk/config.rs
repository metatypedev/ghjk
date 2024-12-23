use crate::interlude::*;

#[derive(Debug)]
pub struct Config {
    pub ghjkfile: Option<PathBuf>,
    pub ghjkdir: Option<PathBuf>,
    pub data_dir: PathBuf,
    pub deno_dir: PathBuf,
    pub deno_lockfile: Option<PathBuf>,
    pub repo_root: url::Url,
}

#[derive(Deserialize)]
struct GlobalConfigFile {
    data_dir: Option<PathBuf>,
    deno_dir: Option<PathBuf>,
    repo_root: Option<String>,
}

#[derive(Deserialize)]
struct LocalConfigFile {
    #[serde(flatten)]
    global: GlobalConfigFile,
    deno_lockfile: Option<String>,
}

impl Config {
    pub async fn source() -> Res<Self> {
        let cwd = std::env::current_dir()?;
        let xdg_dirs = directories::ProjectDirs::from("", "", "ghjk")
            .expect_or_log("unable to resolve home dir");

        let ghjkdir_path = match path_from_env(&cwd, "GHJK_DIR").await? {
            Some(val) => Some(val),
            None => crate::utils::find_entry_recursive(&cwd, ".ghjk")
                .await
                .wrap_err("error trying to locate a .ghjk dir")?,
        };

        let ghjkfile_path = match path_from_env(&cwd, "GHJKFILE").await? {
            Some(val) => Some(val),
            None => {
                // NOTE: look for typescript ghjkfile
                let ghjkfile_name = "ghjk.ts";
                match &ghjkdir_path {
                    Some(ghjkfile_path) => {
                        crate::utils::find_entry_recursive(
                            ghjkfile_path
                                .parent()
                                .expect_or_log("invalid GHJK_DIR path"),
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

        // if ghjkfile var is set, set the GHJK_DIR overriding
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
            deno_lockfile: ghjkdir_path.as_ref().map(|path| path.join("deno.lock")),
            repo_root: {
                if cfg!(debug_assertions) {
                    url::Url::from_file_path(&cwd)
                        .expect_or_log("cwd error")
                        // repo root url must end in slash due to
                        // how Url::join works
                        .join(&format!("{}/", cwd.file_name().unwrap().to_string_lossy()))
                        .wrap_err("repo url error")?
                } else {
                    const BASE_URL: &str =
                        "https://raw.githubusercontent.com/metatypedev/metatype/";
                    // repo root url must end in slash due to
                    // how Url::join works
                    let url = BASE_URL.to_owned() + crate::shadow::COMMIT_HASH + "/";
                    url::Url::parse(&url).expect("repo url error")
                }
            },
        };

        let global_config_path = match path_from_env(&cwd, "GHJK_CONFIG_DIR").await? {
            Some(val) => val,
            None => xdg_dirs.config_dir().join("config"),
        };

        // we use builtin config-rs File implementation
        // which relies on sync std
        let config = tokio::task::spawn_blocking(move || {
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

            eyre::Ok(config)
        })
        .await
        .expect_or_log("tokio error")?;

        if let Some(path) = &config.ghjkdir {
            let ignore_path = path.join(".gitignore");
            if !matches!(tokio::fs::try_exists(&ignore_path).await, Ok(true)) {
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
        Ok(config)
    }

    fn source_global_config(&mut self, file_path: &Path) -> Res<()> {
        let GlobalConfigFile {
            deno_dir,
            data_dir,
            repo_root,
        } = config::Config::builder()
            .add_source(config::File::with_name(&file_path.to_string_lossy()[..]).required(false))
            .build()
            .wrap_err("error reading config file")?
            .try_deserialize()
            .wrap_err("error deserializing config file")?;
        if let Some(path) = data_dir {
            self.data_dir =
                resolve_config_path(&path, file_path).wrap_err("error resolving data_dir")?;
        }
        if let Some(path) = deno_dir {
            self.deno_dir =
                resolve_config_path(&path, file_path).wrap_err("error resolving deno_dir")?;
        }
        if let Some(path) = repo_root {
            self.repo_root = deno_core::resolve_url_or_path(&path, file_path)
                .map_err(|err| ferr!(Box::new(err)))
                .wrap_err("error resolving repo_root")?;
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
                },
            deno_lockfile,
        } = config::Config::builder()
            .add_source(config::File::with_name(&file_path.to_string_lossy()).required(false))
            .build()
            .wrap_err("error reading config file")?
            .try_deserialize()
            .wrap_err("error deserializing config file")?;

        if let Some(path) = data_dir {
            self.data_dir =
                resolve_config_path(&path, file_path).wrap_err("error resolving data_dir")?;
        }
        if let Some(path) = deno_dir {
            self.deno_dir =
                resolve_config_path(&path, file_path).wrap_err("error resolving deno_dir")?;
        }
        if let Some(path) = deno_lockfile {
            self.deno_lockfile = Some(
                resolve_config_path(&path, file_path).wrap_err("error resolving deno_lockfile")?,
            );
        }
        if let Some(path) = repo_root {
            self.repo_root = deno_core::resolve_url_or_path(&path, file_path)
                .map_err(|err| ferr!(Box::new(err)))
                .wrap_err("error resolving repo_root")?;
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
                },
            deno_lockfile,
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
        if let Some(path) = deno_lockfile {
            self.deno_lockfile = if path != "off" {
                Some(resolve_config_path(&path, cwd).wrap_err("error resolving deno_lockfile")?)
            } else {
                None
            };
        }
        if let Some(path) = repo_root {
            self.repo_root = dbg!(
                deno_core::resolve_url_or_path(&path, cwd)
                    .map_err(|err| ferr!(Box::new(err)))
                    .wrap_err("error resolving repo_root")?,
                &path,
                cwd
            )
            .0;
        }
        Ok(())
    }
}

fn resolve_config_path(path: impl AsRef<Path>, config_path: &Path) -> Res<PathBuf> {
    let path = config_path.join(&path);
    let path = std::fs::canonicalize(&path)
        .wrap_err_with(|| format!("error canonicalizing path at {path:?}"))?;
    Ok(path)
}

async fn path_from_env(cwd: &Path, env_name: &str) -> Res<Option<PathBuf>> {
    let path = match std::env::var(env_name) {
        Ok(path) => Some(PathBuf::from(path)),
        Err(std::env::VarError::NotUnicode(os_str)) => Some(PathBuf::from(os_str)),
        Err(std::env::VarError::NotPresent) => None,
    };

    if let Some(path) = path {
        let path = cwd.join(&path);
        Ok(Some(tokio::fs::canonicalize(&path).await.wrap_err_with(
            || format!("error canonicalizing path {path:?} from env ${env_name}"),
        )?))
    } else {
        Ok(None)
    }
}
