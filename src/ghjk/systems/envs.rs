use crate::interlude::*;

use clap::{CommandFactory, FromArgMatches};
use futures::FutureExt;
use std::collections::HashMap;

use crate::systems::{ConfigBlackboard, SystemCliCommand, SystemInstance};

pub mod posix;
pub mod types;
use types::{EnvsModuleConfig, ProvisionReducerStore};

/// Context object for managing envs state - similar to TypeScript EnvsCtx
#[derive(Clone, educe::Educe)]
#[educe(Debug)]
pub struct EnvsCtx {
    gcx: Arc<GhjkCtx>,
    ghjkdir_path: PathBuf,
    // FIXME: this hack has two allocations
    #[educe(Debug(ignore))]
    reduce_callback: Arc<tokio::sync::OnceCell<Box<ReduceCallback>>>,
    /// Store for provision reducers
    #[educe(Debug(ignore))]
    reducer_store: Arc<ProvisionReducerStore>,
}

type ReduceCallback =
    dyn Fn(types::EnvRecipe) -> BoxFuture<'static, Res<types::EnvRecipe>> + Send + Sync + 'static;
impl EnvsCtx {
    pub async fn set_reduce_callback(&self, cb: Box<ReduceCallback>) {
        if self.reduce_callback.set(cb).is_err() {
            panic!("reduce_callback already set");
        }
    }

    /// Register a provision reducer for a specific provision type
    pub fn register_reducer(&self, ty: String, reducer: types::ProvisionReducer) {
        self.reducer_store.insert(ty, reducer);
    }
}

pub async fn system(
    gcx: Arc<GhjkCtx>,
    ghjkdir_path: &Path,
) -> Res<(EnvsSystemManifest, Arc<EnvsCtx>)> {
    let ecx = Arc::new(EnvsCtx {
        gcx: gcx.clone(),
        ghjkdir_path: ghjkdir_path.to_path_buf(),
        reduce_callback: default(),
        reducer_store: default(),
    });

    // Register default reducers
    register_default_reducers(&ecx);

    Ok((EnvsSystemManifest { ecx: ecx.clone() }, ecx))
}

pub struct EnvsSystemManifest {
    ecx: Arc<EnvsCtx>,
}

impl EnvsSystemManifest {
    pub async fn ctor(&self, scx: Arc<crate::systems::SystemsCtx>) -> Res<EnvsSystemInstance> {
        Ok(EnvsSystemInstance {
            ecx: self.ecx.clone(),
            scx,
        })
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct EnvsLockState {
    pub version: String,
}

#[derive(Debug)]
pub struct EnvsSystemInstance {
    ecx: Arc<EnvsCtx>,
    scx: Arc<crate::systems::SystemsCtx>,
}

impl EnvsSystemInstance {
    pub const BB_STATE_KEY: &'static str = "envs.state";
}

#[async_trait::async_trait]
impl SystemInstance for EnvsSystemInstance {
    type LockState = EnvsLockState;

    async fn load_config(
        &self,
        config: serde_json::Value,
        _bb: ConfigBlackboard,
        _state: Option<Self::LockState>,
    ) -> Res<()> {
        let config: EnvsModuleConfig =
            serde_json::from_value(config).wrap_err("error parsing envs module config")?;

        // Determine the active environment
        let set_env = std::env::var("GHJK_ENV").ok();
        let active_env = if let Some(env) = set_env {
            if !env.is_empty() {
                env
            } else {
                config.default_env.clone()
            }
        } else {
            config.default_env.clone()
        };

        // Create key_to_name mapping (similar to TypeScript implementation)
        let mut key_to_name = HashMap::new();
        for (name, key) in &config.envs_named {
            key_to_name
                .entry(key.clone())
                .or_insert_with(Vec::new)
                .push(name.clone());
        }

        // Create the context object
        let state = LoadedState {
            active_env,
            key_to_name,
            config,
        };

        // Store state in global systems blackboard
        self.scx.insert_bb(Self::BB_STATE_KEY, Arc::new(state));

        Ok(())
    }

    async fn load_lock_entry(&self, raw: serde_json::Value) -> Res<Self::LockState> {
        let entry: EnvsLockState = serde_json::from_value(raw)?;
        if entry.version != "0" {
            eyre::bail!("unexpected version tag deserializing lockEntry");
        }
        Ok(entry)
    }

    async fn gen_lock_entry(&self) -> Res<serde_json::Value> {
        Ok(serde_json::json!({ "version": "0" }))
    }

    async fn commands(&self) -> Res<Vec<SystemCliCommand>> {
        fn env_key_args(
            state: &LoadedState,
            scx: &crate::systems::SystemsCtx,
            task_key: Option<String>,
            env_key: Option<String>,
        ) -> Res<(String, Option<String>)> {
            if let Some(task_name) = task_key {
                // Resolve the task by its declared key and fetch its env key
                let tasks_state: Arc<crate::systems::tasks::LoadedState> =
                    scx.get_bb(crate::systems::tasks::TasksSystemInstance::BB_STATE_KEY);
                let env_key = tasks_state
                    .config
                    .tasks
                    .get(&task_name)
                    .map(|task| match task {
                        crate::systems::tasks::types::TaskDefHashed::DenoFileV1(def) => {
                            def.env_key.clone()
                        }
                    })
                    .ok_or_else(|| ferr!("task with key '{task_name}' not found"))?;

                // If this env key has a friendly name, pass it along
                let env_name = state
                    .key_to_name
                    .get(&env_key)
                    .and_then(|v| v.first().cloned());
                return Ok((env_key, env_name));
            }

            let actual_key = state
                .config
                .envs_named
                .get(env_key.as_deref().unwrap_or(&state.active_env));
            if let Some(actual_key) = actual_key {
                Ok((
                    actual_key.clone(),
                    Some(env_key.unwrap_or_else(|| state.active_env.clone())),
                ))
            } else {
                Ok((env_key.unwrap_or_else(|| state.active_env.clone()), None))
            }
        }

        #[derive(clap::Parser)]
        #[clap(name = "envs")]
        #[clap(visible_alias = "e")]
        #[clap(about = "Envs module, reproducible posix shell environments")]
        struct EnvsCommand {
            #[command(subcommand)]
            commands: EnvsCommands,
        }
        let scx = self.scx.clone();
        let envs_cmd = SystemCliCommand {
            name: "envs".into(),
            clap: EnvsCommand::command(),
            action: {
                let ecx = self.ecx.clone();
                Some(Box::new(move |matches| {
                    let ecx = ecx.clone();
                    let scx = scx.clone();
                    async move {
                        let state: Arc<LoadedState> = scx.get_bb(EnvsSystemInstance::BB_STATE_KEY);
                        match EnvsCommands::from_arg_matches(&matches) {
                            Ok(EnvsCommands::Ls) => {
                                list_envs(&state).await;
                                Ok(())
                            }
                            Ok(EnvsCommands::Show { env_key, task_env }) => {
                                let (env_key, env_name) =
                                    env_key_args(&state, &scx, task_env, env_key)?;
                                show_env(&state, env_key.as_str(), env_name.as_deref())
                            }
                            Ok(EnvsCommands::Activate { env_key, task_env }) => {
                                let (env_key, _) = env_key_args(&state, &scx, task_env, env_key)?;
                                activate_env(env_key).await
                            }
                            Ok(EnvsCommands::Cook { env_key, task_env }) => {
                                let (env_key, env_name) =
                                    env_key_args(&state, &scx, task_env, env_key)?;
                                reduce_and_cook(
                                    &ecx,
                                    &scx,
                                    &state,
                                    env_key.as_str(),
                                    env_name.as_deref(),
                                )
                                .await
                            }
                            Err(err) => {
                                err.exit();
                            }
                        }
                    }
                    .boxed()
                }))
            },
            sub_commands: default(),
        };

        #[derive(clap::Parser)]
        #[clap(name = "sync")]
        #[clap(about = "Synchronize your shell to what's in your config")]
        struct SyncCommand {
            #[arg(value_name = "ENV KEY")]
            /// The environment to sync
            ///
            /// If not provided, this will sync the currently active env.
            env_key: Option<String>,
            /// Sync to the environment used by the named task
            #[arg(short, long, value_name = "TASK NAME", conflicts_with = "env_key")]
            task_env: Option<String>,
        }
        let scx = self.scx.clone();
        let sync_cmd = SystemCliCommand {
            name: "sync".into(),
            clap: SyncCommand::command(),
            sub_commands: IndexMap::new(),
            action: {
                let ecx = self.ecx.clone();
                Some(Box::new(move |matches| {
                    let ecx = ecx.clone();
                    let scx = scx.clone();
                    async move {
                        let state: Arc<LoadedState> = scx.get_bb(EnvsSystemInstance::BB_STATE_KEY);
                        let env_key = matches.get_one::<String>("env_key").cloned();
                        let task_env = matches.get_one::<String>("task_env").cloned();
                        let (env_key, env_name) = env_key_args(&state, &scx, task_env, env_key)?;
                        reduce_and_cook(&ecx, &scx, &state, env_key.as_str(), env_name.as_deref())
                            .await?;
                        activate_env(env_key).await?;
                        eyre::Ok(())
                    }
                    .boxed()
                }))
            },
        };

        Ok(vec![envs_cmd, sync_cmd])
    }
}

#[derive(Debug)]
struct LoadedState {
    active_env: String,
    key_to_name: HashMap<String, Vec<String>>,
    config: EnvsModuleConfig,
}

#[derive(clap::Subcommand, Debug)]
enum EnvsCommands {
    /// List environments defined in the ghjkfile
    Ls,
    /// Cook the environment to a posix shell
    Cook {
        /// The environment to cook
        ///
        /// If not provided, this will cook the currently active env.
        #[arg(value_name = "ENV KEY")]
        env_key: Option<String>,
        /// Activate the environment used by the named task
        #[arg(short, long, value_name = "TASK NAME", conflicts_with = "env_key")]
        task_env: Option<String>,
    },
    /// Activate an environment
    Activate {
        /// The environment to activate
        ///
        /// If not provided, this will activate the config's default env.
        #[arg(value_name = "ENV KEY")]
        env_key: Option<String>,
        /// Activate the environment used by the named task
        #[arg(short, long, value_name = "TASK NAME", conflicts_with = "env_key")]
        task_env: Option<String>,
    },
    /// Show details about an environment
    Show {
        /// The environment to show
        ///
        /// If not provided, this will show details of the active env.
        /// If no env is active, this will show details of the default env.
        #[arg(value_name = "ENV KEY")]
        env_key: Option<String>,
        /// Show the environment used by the named task
        #[arg(short, long, value_name = "TASK NAME", conflicts_with = "env_key")]
        task_env: Option<String>,
    },
}

async fn reduce_strange_provisions(
    ecx: &EnvsCtx,
    recipe: &types::EnvRecipe,
) -> Res<types::WellKnownEnvRecipe> {
    use types::{Provision, WellKnownProvision};

    // First, try to get TypeScript reduced provisions if callback is available
    let ts_reduced_provisions = if let Some(cb) = ecx.reduce_callback.get() {
        let ts_recipe = cb(recipe.clone())
            .await
            .wrap_err("error reducing ts provisions")?;
        ts_recipe.provides
    } else {
        recipe.provides.clone()
    };

    // Group provisions by type for Rust reduction (similar to TypeScript implementation)
    let mut bins: HashMap<String, Vec<Provision>> = HashMap::new();
    for provision in &ts_reduced_provisions {
        let ty = match provision {
            Provision::WellKnown(well_known) => well_known.provision_type().to_string(),
            Provision::Strange(strange) => {
                // Extract the "ty" field from the JSON value
                strange
                    .get("ty")
                    .and_then(|v| v.as_str())
                    .unwrap_or("unknown")
                    .to_string()
            }
        };
        bins.entry(ty).or_default().push(provision.clone());
    }

    let mut reduced_set = Vec::new();

    for (ty, items) in bins {
        // Check if this is a well-known provision type
        if is_well_known_type(&ty) {
            // Add well-known provisions directly
            for item in items {
                match item {
                    Provision::WellKnown(well_known) => {
                        reduced_set.push(well_known);
                    }
                    Provision::Strange(strange) => {
                        // Try to parse as well-known provision
                        let well_known: WellKnownProvision = serde_json::from_value(strange)
                            .wrap_err_with(|| {
                                format!("error parsing well-known provision of type {ty}")
                            })?;
                        reduced_set.push(well_known);
                    }
                }
            }
            continue;
        }

        // Look for a Rust reducer for this type
        if let Some(reducer) = ecx.reducer_store.get(&ty) {
            // Apply the Rust reducer
            let reduced = reducer(items).await?;
            reduced_set.extend(reduced);
        } else {
            eyre::bail!("No reducer found for type: {ty}");
        }
    }

    Ok(types::WellKnownEnvRecipe {
        desc: recipe.desc.clone(),
        provides: reduced_set,
    })
}

pub async fn reduce_and_cook_to(
    ecx: &EnvsCtx,
    scx: &crate::systems::SystemsCtx,
    env_key: &str,
    env_name: Option<&str>,
    env_dir: &Path,
    create_shell_loaders: bool,
) -> Res<IndexMap<String, String>> {
    let state: Arc<LoadedState> = scx.get_bb("envs.state");

    let recipe = state.config.envs.get(env_key).ok_or_else(|| {
        if let Some(env_name) = env_name {
            ferr!("no env found under name '{env_name}'")
        } else {
            ferr!("no env found under key '{env_key}'")
        }
    })?;

    let reduced_recipe = reduce_strange_provisions(ecx, recipe).await?;

    // Cook the environment
    let env_vars = posix::cook(
        ecx,
        &reduced_recipe,
        env_name.unwrap_or(env_key),
        env_dir,
        create_shell_loaders,
    )
    .await?;
    Ok(env_vars)
}

async fn reduce_and_cook(
    ecx: &EnvsCtx,
    scx: &crate::systems::SystemsCtx,
    state: &LoadedState,
    env_key: &str,
    env_name: Option<&str>,
) -> Res<()> {
    let envs_dir = ecx.ghjkdir_path.join("envs");
    let env_dir = envs_dir.join(env_key);

    reduce_and_cook_to(ecx, scx, env_key, env_name, &env_dir, true).await?;

    // Create symlink for default environment if this is the default
    if env_key == state.config.default_env {
        let default_env_dir = envs_dir.join("default");
        if default_env_dir.exists() {
            tokio::fs::remove_file(&default_env_dir).await.ok(); // Ignore errors
        }
        tokio::fs::symlink(&env_dir, &default_env_dir).await?;
    }

    // Create symlinks for named environments
    for (name, key) in &state.config.envs_named {
        if key == env_key {
            let named_dir = envs_dir.join(name);
            if named_dir.exists() {
                tokio::fs::remove_file(&named_dir).await.ok(); // Ignore errors
            }
            tokio::fs::symlink(&env_dir, &named_dir).await?;

            // Also handle case where the name itself is the default env
            if name == &state.config.default_env || key == &state.config.default_env {
                let default_env_dir = envs_dir.join("default");
                if default_env_dir.exists() {
                    tokio::fs::remove_file(&default_env_dir).await.ok(); // Ignore errors
                }
                tokio::fs::symlink(&env_dir, &default_env_dir).await?;
            }
            break;
        }
    }

    Ok(())
}

async fn list_envs(state: &LoadedState) {
    for (name, hash) in &state.config.envs_named {
        // Don't show envs that start with underscore (like TypeScript version)
        if !name.starts_with('_') {
            if let Some(env) = state.config.envs.get(hash) {
                if let Some(desc) = &env.desc {
                    println!("{}: {}", name, desc);
                } else {
                    println!("{}", name);
                }
            } else {
                println!("{}", name);
            }
        }
    }
}

async fn activate_env(env_key: String) -> Res<()> {
    let nextfile = std::env::var("GHJK_NEXTFILE").ok();
    if let Some(nextfile) = nextfile {
        tokio::fs::write(nextfile, env_key).await?;
    } else {
        let shell = detect_shell_path().await.wrap_err(
            "unable to detct shell in use. Use `$SHELL env var to explicitly pass shell command.",
        )?;
        use std::os::unix::process::CommandExt;
        tokio::task::spawn_blocking(move || {
            let shell_cmds = shell.split_whitespace().collect::<Vec<_>>();
            std::process::Command::new(shell_cmds[0])
                .args(&shell_cmds[1..])
                .env("GHJK_ENV", env_key)
                .exec()
        })
        .await
        .wrap_err("failed to exec shell")?;
    }
    Ok(())
}

fn show_env(state: &LoadedState, env_key: &str, env_name: Option<&str>) -> Res<()> {
    // Get the recipe from the config
    let recipe = state.config.envs.get(env_key).ok_or_else(|| {
        if let Some(env_name) = env_name {
            ferr!("no env found under name '{env_name}'")
        } else {
            ferr!("no env found under key '{env_key}'")
        }
    })?;

    let env_names = state.key_to_name.get(env_key);
    let showable = json!({
        "provides": recipe.provides,
        "desc": recipe.desc,
        "envKey": env_key,
        "envNames": env_names,
    });
    println!(
        "{}",
        serde_json::to_string_pretty(&showable).expect_or_log("json error")
    );
    Ok(())
}

async fn detect_shell_path() -> Res<String> {
    if let Ok(path) = std::env::var("SHELL") {
        return Ok(path);
    }
    let output = tokio::process::Command::new("ps")
        .args(["-p", std::process::id().to_string().as_str(), "-o", "comm="])
        .output()
        .await
        .wrap_err("error on ps command")?;
    let path = String::from_utf8(output.stdout).wrap_err("utf8 error on path")?;
    Ok(path)
}

// Helper functions for provision type handling

fn is_well_known_type(ty: &str) -> bool {
    matches!(
        ty,
        "posix.envVar"
            | "hook.onEnter.posixExec"
            | "hook.onExit.posixExec"
            | "posix.exec"
            | "posix.sharedLib"
            | "posix.headerFile"
            | "ghjk.ports.Install"
            | "ghjk.shell.Alias"
            | "posix.shell.Completion.bash"
            | "posix.shell.Completion.zsh"
            | "posix.shell.Completion.fish"
    )
}

/// Register default provision reducers
fn register_default_reducers(_ecx: &Arc<EnvsCtx>) {
    // Note: Task-specific reducers like posix.envVarDyn and ghjk.tasks.Alias
    // are now registered by the tasks system itself during initialization
}
