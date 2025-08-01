
use crate::interlude::*;

mod posix;

use super::{SystemCliCommand, SystemInstance, ConfigBlackboard};
use glob::glob;
use std::collections::HashMap;
use std::fmt::Write;
use futures::FutureExt;
use std::sync::{Arc, RwLock};
use std::sync::OnceLock;

pub async fn system(gcx: &GhjkCtx) -> Res<(EnvsSystemInstance, EnvsCtx)> {

}

// Common cook logic function
async fn cook_env_common(
    ctx_arc: Arc<RwLock<Option<EnvsCtx>>>,
    env_name: &str,
    create_shell_loaders: bool,
) -> Res<()> {
    let ctx = ctx_arc.read()
        .map_err(|e| ferr!("Failed to acquire read lock: {}", e))?
        .as_ref()
        .ok_or_else(|| ferr!("Envs context not initialized"))?
        .clone();

    // Resolve environment key
    let actual_key = if let Some(names) = ctx.key_to_name.get(env_name) {
        if let Some(first_name) = names.first() {
            first_name.clone()
        } else {
            env_name.to_string()
        }
    } else {
        env_name.to_string()
    };

    // Get recipe
    let recipe = ctx.config.envs.get(&actual_key)
        .ok_or_else(|| ferr!("No env found under key '{}'", actual_key))?;

    let current_dir = std::env::current_dir()
        .wrap_err("Failed to get current directory")?;
    let ghjk_dir = current_dir.join(".ghjk");
    let data_dir = ghjk_dir.clone();
    let env_dir = ghjk_dir.join("envs").join(&actual_key);

    tracing::info!(
        "Cook command: env_name={}, actual_key={}, current_dir={}, env_dir={}",
        env_name, actual_key, current_dir.display(), env_dir.display()
    );

    // Convert EnvRecipe to WellKnownEnvRecipe by processing provisions
    let mut provides = Vec::new();
    
    // Process each provision
    for provision in recipe.provides.iter() {
        if let Some(provision_obj) = provision.as_object() {
            if let Some(ty) = provision_obj.get("ty").and_then(|v| v.as_str()) {
                match ty {
                    "posix.envVar" => {
                        if let (Some(key), Some(val)) = (
                            provision_obj.get("key").and_then(|v| v.as_str()),
                            provision_obj.get("val").and_then(|v| v.as_str())
                        ) {
                            provides.push(WellKnownProvision::PosixEnvVar {
                                key: key.to_string(),
                                val: val.to_string(),
                            });
                        }
                    },
                    "posix.exec" => {
                        if let Some(path) = provision_obj.get("absolutePath").and_then(|v| v.as_str()) {
                            provides.push(WellKnownProvision::PosixExec {
                                absolute_path: PathBuf::from(path),
                            });
                        }
                    },
                    "posix.sharedLib" => {
                        if let Some(path) = provision_obj.get("absolutePath").and_then(|v| v.as_str()) {
                            provides.push(WellKnownProvision::PosixSharedLib {
                                absolute_path: PathBuf::from(path),
                            });
                        }
                    },
                    "posix.headerFile" => {
                        if let Some(path) = provision_obj.get("absolutePath").and_then(|v| v.as_str()) {
                            provides.push(WellKnownProvision::PosixHeaderFile {
                                absolute_path: PathBuf::from(path),
                            });
                        }
                    },
                    "hook.onEnter.posixExec" => {
                        if let (Some(program), Some(args)) = (
                            provision_obj.get("program").and_then(|v| v.as_str()),
                            provision_obj.get("arguments").and_then(|v| v.as_array())
                        ) {
                            let arguments: Vec<String> = args.iter()
                                .filter_map(|v| v.as_str())
                                .map(|s| s.to_string())
                                .collect();
                            provides.push(WellKnownProvision::HookOnEnterPosixExec {
                                program: program.to_string(),
                                arguments,
                            });
                        }
                    },
                    "hook.onExit.posixExec" => {
                        if let (Some(program), Some(args)) = (
                            provision_obj.get("program").and_then(|v| v.as_str()),
                            provision_obj.get("arguments").and_then(|v| v.as_array())
                        ) {
                            let arguments: Vec<String> = args.iter()
                                .filter_map(|v| v.as_str())
                                .map(|s| s.to_string())
                                .collect();
                            provides.push(WellKnownProvision::HookOnExitPosixExec {
                                program: program.to_string(),
                                arguments,
                            });
                        }
                    },
                    "ghjk.shell.Alias" => {
                        if let (Some(alias_name), Some(command)) = (
                            provision_obj.get("aliasName").and_then(|v| v.as_str()),
                            provision_obj.get("command").and_then(|v| v.as_array())
                        ) {
                            let command: Vec<String> = command.iter()
                                .filter_map(|v| v.as_str())
                                .map(|s| s.to_string())
                                .collect();
                            provides.push(WellKnownProvision::GhjkShellAlias {
                                alias_name: alias_name.to_string(),
                                command,
                            });
                        }
                    },
                    _ => {
                        tracing::warn!("Unhandled provision type: {}", ty);
                    }
                }
            }
        }
    }
    
    let well_known_recipe = WellKnownEnvRecipe { 
        desc: None,
        provides 
    };

    // Cook the environment
    cook_posix_env(
        &well_known_recipe,
        &actual_key,
        &env_dir,
        create_shell_loaders,
        &ghjk_dir,
        &data_dir,
    ).await?;

    // Create symlinks
    create_env_symlinks(&ctx, &actual_key, &ghjk_dir).await?;

    Ok(())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CookPosixEnvArgs {
    pub recipe: WellKnownEnvRecipe,
    pub env_key: String,
    pub env_dir: PathBuf,
    pub create_shell_loaders: bool,
    pub ghjk_dir: PathBuf,
    pub data_dir: PathBuf,
}


// Remove the Deno op - we'll use callbacks instead

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(tag = "ty")]
#[serde(rename_all = "camelCase")]
pub enum WellKnownProvision {
    #[serde(rename = "posix.envVar")]
    PosixEnvVar { key: String, val: String },
    #[serde(rename = "hook.onEnter.posixExec")]
    HookOnEnterPosixExec {
        program: String,
        arguments: Vec<String>,
    },
    #[serde(rename = "hook.onExit.posixExec")]
    HookOnExitPosixExec {
        program: String,
        arguments: Vec<String>,
    },
    #[serde(rename = "posix.exec")]
    PosixExec {
        #[serde(rename = "absolutePath")]
        absolute_path: PathBuf,
    },
    #[serde(rename = "posix.sharedLib")]
    PosixSharedLib {
        #[serde(rename = "absolutePath")]
        absolute_path: PathBuf,
    },
    #[serde(rename = "posix.headerFile")]
    PosixHeaderFile {
        #[serde(rename = "absolutePath")]
        absolute_path: PathBuf,
    },
    #[serde(rename = "ghjk.ports.Install")]
    GhjkPortsInstall {
        #[serde(rename = "instId")]
        inst_id: String,
    },
    #[serde(rename = "ghjk.shell.Alias")]
    GhjkShellAlias {
        #[serde(rename = "aliasName")]
        alias_name: String,
        command: Vec<String>,
    },
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct WellKnownEnvRecipe {
    pub desc: Option<String>,
    pub provides: Vec<WellKnownProvision>,
}

#[derive(Debug, Clone)]
pub struct EnvsSystemInstance {
    ctx: Arc<EnvsCtx>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct EnvsModuleConfig {
    pub default_env: String,
    pub envs: IndexMap<String, EnvRecipe>,
    pub envs_named: IndexMap<String, String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct EnvRecipe {
    pub desc: Option<String>,
    pub provides: Vec<serde_json::Value>, // Keep as JSON for now, will be processed later
}

/// Context object for managing envs state - similar to TypeScript EnvsCtx
#[derive(Debug, Clone, Serialize)]
pub struct EnvsCtx {
    active_env: String,
    key_to_name: DHashMap<String, Vec<String>>,
    pub config: Arc<EnvsModuleConfig>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct EnvsLockState {
    pub version: String,
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
        let config: EnvsModuleConfig = serde_json::from_value(config)
            .wrap_err("error parsing envs module config")?;
        
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
            key_to_name.entry(key.clone())
                .or_insert_with(Vec::new)
                .push(name.clone());
        }
        
        // Create the context object
        let envs_ctx = EnvsCtx {
            active_env,
            key_to_name,
            config,
        };
        
        // Set the instance context
        {
            let mut ctx_guard = self.ctx.write()
                .map_err(|e| ferr!("Failed to acquire write lock: {}", e))?;
            *ctx_guard = Some(envs_ctx.clone());
        }
        
        // Also set the global context for compatibility with hostcalls
        // Set global context for hostcall compatibility
        set_global_envs_ctx(envs_ctx)?;
        
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
        use clap::{Arg, Command};
        
        // Capture the context arc for use in closures
        let ctx_arc = self.ctx.clone();

        let envs_cmd = SystemCliCommand {
            name: "envs".into(),
            clap: Command::new("envs")
                .visible_alias("e")
                .about("Envs module, reproducible posix shell environments"),
            sub_commands: [
                ("ls".into(), SystemCliCommand {
                    name: "ls".into(),
                    clap: Command::new("ls")
                        .about("List environments defined in the ghjkfile"),
                    sub_commands: IndexMap::new(),
                    action: Some(Box::new({
                        let ctx_arc = ctx_arc.clone();
                        move |_matches| {
                            let ctx_arc = ctx_arc.clone();
                            async move {
                                let ctx = ctx_arc.read()
                                    .map_err(|e| ferr!("Failed to acquire read lock: {}", e))?
                                    .clone()
                                    .ok_or_else(|| ferr!("Envs context not initialized"))?;
                            
                            for (name, hash) in &ctx.config.envs_named {
                                // Don't show envs that start with underscore (like TypeScript version)
                                if !name.starts_with('_') {
                                    if let Some(env) = ctx.config.envs.get(hash) {
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
                            Ok(())
                            }.boxed()
                        }
                    })),
                }),
                ("cook".into(), SystemCliCommand {
                    name: "cook".into(),
                    clap: Command::new("cook")
                        .about("Cooks the environment to a posix shell")
                        .arg(Arg::new("env_key")
                            .value_name("ENV KEY")
                            .help("Environment to cook"))
                        .arg(Arg::new("task-env")
                            .short('t')
                            .long("task-env")
                            .value_name("TASK NAME")
                            .help("Activate the environment used by the named task")),
                    sub_commands: IndexMap::new(),
                    action: Some(Box::new({
                        let ctx_arc = ctx_arc.clone();
                        move |matches| {
                            let ctx_arc = ctx_arc.clone();
                            async move {
                                let ctx = ctx_arc.read()
                                    .map_err(|e| ferr!("Failed to acquire read lock: {}", e))?
                                    .clone()
                                    .ok_or_else(|| ferr!("Envs context not initialized"))?;
                            
                            let env_name = matches.get_one::<String>("env_key")
                                .map(|s| s.as_str())
                                .unwrap_or(&ctx.config.default_env);
                            
                            // First check if this is a named env, then use the actual key
                            let actual_key = ctx.config.envs_named.get(env_name)
                                .cloned()
                                .unwrap_or_else(|| env_name.to_string());
                            
                            // Get the recipe from the config using the actual key
                            let recipe = ctx.config.envs.get(&actual_key)
                                .ok_or_else(|| ferr!("No env found under key '{}' (resolved from '{}')", actual_key, env_name))?;
                            
                            // Convert EnvRecipe to WellKnownEnvRecipe by processing provisions
                            let mut provides = Vec::new();
                            
                            // Log the raw recipe
                            tracing::info!("Raw recipe provides {} items", recipe.provides.len());
                            
                            // Process each provision
                            for (i, provision) in recipe.provides.iter().enumerate() {
                                if let Some(provision_obj) = provision.as_object() {
                                    if let Some(ty) = provision_obj.get("ty").and_then(|v| v.as_str()) {
                                        tracing::info!("Processing provision {}: {}", i, ty);
                                        match ty {
                                            "posix.envVar" => {
                                                if let (Some(key), Some(val)) = (
                                                    provision_obj.get("key").and_then(|v| v.as_str()),
                                                    provision_obj.get("val").and_then(|v| v.as_str())
                                                ) {
                                                    tracing::info!("Adding env var: {} = {}", key, val);
                                                    provides.push(WellKnownProvision::PosixEnvVar {
                                                        key: key.to_string(),
                                                        val: val.to_string(),
                                                    });
                                                } else {
                                                    tracing::warn!("Failed to extract key/val from posix.envVar provision: {:?}", provision_obj);
                                                }
                                            }
                                            "posix.exec" => {
                                                if let Some(absolute_path) = provision_obj.get("absolutePath").and_then(|v| v.as_str()) {
                                                    provides.push(WellKnownProvision::PosixExec {
                                                        absolute_path: PathBuf::from(absolute_path),
                                                    });
                                                }
                                            }
                                            "posix.sharedLib" => {
                                                if let Some(absolute_path) = provision_obj.get("absolutePath").and_then(|v| v.as_str()) {
                                                    provides.push(WellKnownProvision::PosixSharedLib {
                                                        absolute_path: PathBuf::from(absolute_path),
                                                    });
                                                }
                                            }
                                            "posix.headerFile" => {
                                                if let Some(absolute_path) = provision_obj.get("absolutePath").and_then(|v| v.as_str()) {
                                                    provides.push(WellKnownProvision::PosixHeaderFile {
                                                        absolute_path: PathBuf::from(absolute_path),
                                                    });
                                                }
                                            }
                                            "hook.onEnter.posixExec" => {
                                                if let (Some(program), Some(arguments)) = (
                                                    provision_obj.get("program").and_then(|v| v.as_str()),
                                                    provision_obj.get("arguments").and_then(|v| v.as_array())
                                                ) {
                                                    let args: Vec<String> = arguments.iter()
                                                        .filter_map(|v| v.as_str().map(|s| s.to_string()))
                                                        .collect();
                                                    provides.push(WellKnownProvision::HookOnEnterPosixExec {
                                                        program: program.to_string(),
                                                        arguments: args,
                                                    });
                                                }
                                            }
                                            "hook.onExit.posixExec" => {
                                                if let (Some(program), Some(arguments)) = (
                                                    provision_obj.get("program").and_then(|v| v.as_str()),
                                                    provision_obj.get("arguments").and_then(|v| v.as_array())
                                                ) {
                                                    let args: Vec<String> = arguments.iter()
                                                        .filter_map(|v| v.as_str().map(|s| s.to_string()))
                                                        .collect();
                                                    provides.push(WellKnownProvision::HookOnExitPosixExec {
                                                        program: program.to_string(),
                                                        arguments: args,
                                                    });
                                                }
                                            }
                                            "ghjk.shell.Alias" => {
                                                if let (Some(alias_name), Some(command)) = (
                                                    provision_obj.get("aliasName").and_then(|v| v.as_str()),
                                                    provision_obj.get("command").and_then(|v| v.as_array())
                                                ) {
                                                    let cmd: Vec<String> = command.iter()
                                                        .filter_map(|v| v.as_str().map(|s| s.to_string()))
                                                        .collect();
                                                    provides.push(WellKnownProvision::GhjkShellAlias {
                                                        alias_name: alias_name.to_string(),
                                                        command: cmd,
                                                    });
                                                }
                                            }
                                            _ => {
                                                // TODO: Handle other provision types via callbacks
                                                tracing::warn!("Unhandled provision type: {}", ty);
                                            }
                                        }
                                    }
                                }
                            }
                            
                            let reduced_recipe = WellKnownEnvRecipe {
                                desc: recipe.desc.clone(),
                                provides,
                            };
                            
                            // Use proper paths based on current working directory
                            let current_dir = std::env::current_dir()
                                .wrap_err("Failed to get current working directory")?;
                            let ghjk_dir = current_dir.join(".ghjk");
                            let env_dir = ghjk_dir.join("envs").join(&actual_key);
                            let data_dir = ghjk_dir.clone();
                            
                            tracing::info!("Cook command: env_name={}, actual_key={}, current_dir={}, env_dir={}", 
                                env_name, actual_key, current_dir.display(), env_dir.display());
                            
                            cook_posix_env(
                                &reduced_recipe,
                                env_name,
                                &env_dir,
                                true,
                                &ghjk_dir,
                                &data_dir,
                            ).await?;
                            
                            // Create symlinks for named environments (like TypeScript reduceAndCookEnv)
                            create_env_symlinks(&ctx, &actual_key, &ghjk_dir).await?;
                            
                            println!("Environment {} cooked successfully", env_name);
                            Ok(())
                            }.boxed()
                        }
                    })),
                }),
                ("activate".into(), SystemCliCommand {
                    name: "activate".into(),
                    clap: Command::new("activate")
                        .about("Activate an environment")
                        .arg(Arg::new("env_key")
                            .value_name("ENV KEY")
                            .help("Environment to activate"))
                        .arg(Arg::new("task-env")
                            .short('t')
                            .long("task-env")
                            .value_name("TASK NAME")
                            .help("Activate the environment used by the named task")),
                    sub_commands: IndexMap::new(),
                    action: Some(Box::new({
                        let ctx_arc = ctx_arc.clone();
                        move |matches| {
                            impl Default for EnvsSystemInstance {
                                fn default() -> Self {
                                    Self {
                                        ctx: Arc::new(RwLock::new(None)),
                                    }
                                }
                            }
                            let ctx_arc = ctx_arc.clone();
                            async move {
                                let ctx = ctx_arc.read()
                                    .map_err(|e| ferr!("Failed to acquire read lock: {}", e))?
                                    .clone()
                                    .ok_or_else(|| ferr!("Envs context not initialized"))?;
                            
                            let env_name = matches.get_one::<String>("env_key")
                                .map(|s| s.as_str())
                                .unwrap_or(&ctx.config.default_env);
                            
                            // Check if this is a named env, then use the actual key
                            let actual_key = ctx.config.envs_named.get(env_name)
                                .cloned()
                                .unwrap_or_else(|| env_name.to_string());
                            
                            // Verify the environment exists
                            if !ctx.config.envs.contains_key(&actual_key) {
                                return Err(ferr!("No env found under key '{}' (resolved from '{}')", actual_key, env_name));
                            }
                            
                            // Set the environment variable to activate it
                            std::env::set_var("GHJK_ENV", env_name);
                            println!("Environment '{}' activated", env_name);
                            Ok(())
                            }.boxed()
                        }
                    })),
                }),
                ("show".into(), SystemCliCommand {
                    name: "show".into(),
                    clap: Command::new("show")
                        .about("Show details about an environment")
                        .arg(Arg::new("env_key")
                            .value_name("ENV KEY")
                            .help("Environment to show"))
                        .arg(Arg::new("task-env")
                            .short('t')
                            .long("task-env")
                            .value_name("TASK NAME")
                            .help("Show the environment used by the named task")),
                    sub_commands: IndexMap::new(),
                    action: Some(Box::new({
                        let ctx_arc = ctx_arc.clone();
                        move |matches| {
                            let ctx_arc = ctx_arc.clone();
                            async move {
                                let ctx = ctx_arc.read()
                                    .map_err(|e| ferr!("Failed to acquire read lock: {}", e))?
                                    .clone()
                                    .ok_or_else(|| ferr!("Envs context not initialized"))?;
                            
                            let env_name = matches.get_one::<String>("env_key")
                                .map(|s| s.as_str())
                                .unwrap_or(&ctx.config.default_env);
                            
                            // Check if this is a named env, then use the actual key
                            let actual_key = ctx.config.envs_named.get(env_name)
                                .cloned()
                                .unwrap_or_else(|| env_name.to_string());
                            
                            // Get the recipe from the config
                            let recipe = ctx.config.envs.get(&actual_key)
                                .ok_or_else(|| ferr!("No env found under key '{}' (resolved from '{}')", actual_key, env_name))?;
                            
                            // Show environment details
                            println!("Environment: {}", env_name);
                            if let Some(desc) = &recipe.desc {
                                println!("Description: {}", desc);
                            }
                            println!("Provides: {} items", recipe.provides.len());
                            
                            // Show the raw provides for debugging
                            for (i, provision) in recipe.provides.iter().enumerate() {
                                println!("  {}. {:?}", i + 1, provision);
                            }
                            
                            Ok(())
                            }.boxed()
                        }
                    })),
                }),
            ].into_iter().collect(),
            action: None,
        };

        let sync_cmd = SystemCliCommand {
            name: "sync".into(),
            clap: Command::new("sync")
                .about("Synchronize your shell to what's in your config")
                .arg(Arg::new("env_key")
                    .value_name("ENV KEY")
                    .help("Environment to sync"))
                .arg(Arg::new("task-env")
                    .short('t')
                    .long("task-env")
                    .value_name("TASK NAME")
                    .help("Sync to the environment used by the named task")),
            sub_commands: IndexMap::new(),
            action: Some(Box::new({
                let ctx_arc = ctx_arc.clone();
                move |matches| {
                    let ctx_arc = ctx_arc.clone();
                    async move {
                        let ctx = ctx_arc.read()
                            .map_err(|e| ferr!("Failed to acquire read lock: {}", e))?
                            .clone()
                            .ok_or_else(|| ferr!("Envs context not initialized"))?;
                    
                    let env_name = matches.get_one::<String>("env_key")
                        .map(|s| s.as_str())
                        .unwrap_or(&ctx.config.default_env);
                    
                    // Check if this is a named env, then use the actual key
                    let actual_key = ctx.config.envs_named.get(env_name)
                        .cloned()
                        .unwrap_or_else(|| env_name.to_string());
                    
                    // Get the recipe from the config
                    let recipe = ctx.config.envs.get(&actual_key)
                        .ok_or_else(|| ferr!("No env found under key '{}' (resolved from '{}')", actual_key, env_name))?;
                    
                    // Convert EnvRecipe to WellKnownEnvRecipe by processing provisions
                    let mut provides = Vec::new();
                    
                    // Log the raw recipe
                    tracing::info!("Raw recipe provides {} items", recipe.provides.len());
                    
                    // Process each provision
                    for (i, provision) in recipe.provides.iter().enumerate() {
                        if let Some(provision_obj) = provision.as_object() {
                            if let Some(ty) = provision_obj.get("ty").and_then(|v| v.as_str()) {
                                tracing::info!("Processing provision {}: {}", i, ty);
                                match ty {
                                    "posix.envVar" => {
                                        if let (Some(key), Some(val)) = (
                                            provision_obj.get("key").and_then(|v| v.as_str()),
                                            provision_obj.get("val").and_then(|v| v.as_str())
                                        ) {
                                            tracing::info!("Adding env var: {} = {}", key, val);
                                            provides.push(WellKnownProvision::PosixEnvVar {
                                                key: key.to_string(),
                                                val: val.to_string(),
                                            });
                                        } else {
                                            tracing::warn!("Failed to extract key/val from posix.envVar provision: {:?}", provision_obj);
                                        }
                                    }
                                    _ => {
                                        tracing::warn!("Unhandled provision type: {}", ty);
                                    }
                                }
                            }
                        }
                    }
                    
                    let reduced_recipe = WellKnownEnvRecipe {
                        desc: recipe.desc.clone(),
                        provides,
                    };
                    
                    // Use proper paths based on current working directory
                    let current_dir = std::env::current_dir()
                        .wrap_err("Failed to get current working directory")?;
                    let ghjk_dir = current_dir.join(".ghjk");
                    let env_dir = ghjk_dir.join("envs").join(&actual_key);
                    let data_dir = ghjk_dir.clone();
                    
                    // Cook the environment
                    cook_posix_env(
                        &reduced_recipe,
                        env_name,
                        &env_dir,
                        true,
                        &ghjk_dir,
                        &data_dir,
                    ).await?;
                    
                    // Create symlinks for named environments (like TypeScript reduceAndCookEnv)
                    create_env_symlinks(&ctx, &actual_key, &ghjk_dir).await?;
                    
                    // Activate the environment
                    std::env::set_var("GHJK_ENV", env_name);
                    
                        println!("Environment '{}' synced (cooked and activated)", env_name);
                        Ok(())
                    }.boxed()
                }
            })),
        };

        Ok(vec![envs_cmd, sync_cmd])
    }
}


// /**
//  * Returns a simple posix function to invoke the ghjk CLI.
//  * This shim assumes it's running inside the ghjk embedded deno runtime.
//  */
// fn ghjk_sh(
//   gcx: GhjkCtx,
//   functionName = "__ghjk_shim",
// ) -> String {
//     format!(r#"function {functionName} () {{
//         GHJKDIR=\"{gcx.ghjkDir}\" \\
//         {Deno.execPath()} \"$@\"
//     }}"#)
//   return `${functionName} () {
//     GHJKDIR="${gcx.ghjkDir}" \\
//     ${Deno.execPath()} "$@"
// }`;
// }

// /**
//  * Returns a simple fish function to invoke the ghjk CLI.
//  * This shim assumes it's running inside the ghjk embedded deno runtime.
//  */
// export function ghjk_fish(
//   gcx: GhjkCtx,
//   functionName = "__ghjk_shim",
// ) {
//   return `function ${functionName}
//     GHJKDIR="${gcx.ghjkDir}" \\
//     ${Deno.execPath()}  $argv
// end`;
// }

// /// Create symlinks for named environments and default environment
// /// Based on the TypeScript reduceAndCookEnv function in mod.ts
// async fn create_env_symlinks(ctx: &EnvsCtx, env_key: &str, ghjk_dir: &Path) -> Res<()> {
//     let envs_dir = ghjk_dir.join("envs");
//     let env_dir = envs_dir.join(env_key);
    
//     // Create symlink for default environment if this is the default
//     if env_key == ctx.config.default_env {
//         let default_env_dir = envs_dir.join("default");
//         if default_env_dir.exists() {
//             tokio::fs::remove_file(&default_env_dir).await.ok(); // Ignore errors
//         }
//         tokio::fs::symlink(&env_dir, &default_env_dir).await?;
//     }
    
//     // Create symlinks for named environments
//     for (name, key) in &ctx.config.envs_named {
//         if key == env_key {
//             let named_dir = envs_dir.join(name);
//             if named_dir.exists() {
//                 tokio::fs::remove_file(&named_dir).await.ok(); // Ignore errors  
//             }
//             tokio::fs::symlink(&env_dir, &named_dir).await?;
//         }
        
//         // Also handle case where the name itself is the default env
//         if name == &ctx.config.default_env || key == &ctx.config.default_env {
//             let default_env_dir = envs_dir.join("default");
//             if default_env_dir.exists() {
//                 tokio::fs::remove_file(&default_env_dir).await.ok(); // Ignore errors
//             }
//             tokio::fs::symlink(&env_dir, &default_env_dir).await?;
//         }
//     }
    
//     Ok(())
// }
