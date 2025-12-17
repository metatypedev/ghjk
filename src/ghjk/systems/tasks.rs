use crate::interlude::*;

pub mod exec;
mod reducers;
pub mod types;

use crate::systems::envs::EnvsCtx;
use crate::systems::{ConfigBlackboard, SystemCliCommand, SystemInstance};
use exec::{build_task_graph, exec_task, TaskGraph};
use types::{TaskDefHashed, TasksModuleConfig, TASK_ALIAS_PROVISION_TY};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TasksLockState {
    pub version: String,
}

#[derive(Clone, educe::Educe)]
#[educe(Debug)]
pub struct TasksCtx {
    gcx: Arc<GhjkCtx>,
    ecx: Arc<EnvsCtx>,
}

#[derive(Debug)]
pub struct LoadedState {
    pub config: TasksModuleConfig,
    pub graph: TaskGraph,
}

pub async fn system(
    gcx: Arc<GhjkCtx>,
    ecx: Arc<EnvsCtx>,
) -> Res<(TasksSystemManifest, Arc<TasksCtx>)> {
    let tcx = Arc::new(TasksCtx {
        gcx,
        ecx: ecx.clone(),
    });

    Ok((TasksSystemManifest { tcx: tcx.clone() }, tcx))
}

pub struct TasksSystemManifest {
    tcx: Arc<TasksCtx>,
}

impl TasksSystemManifest {
    pub async fn ctor(&self, scx: Arc<crate::systems::SystemsCtx>) -> Res<TasksSystemInstance> {
        // Register reducers here with access to scx
        self.tcx.ecx.register_reducer(
            TASK_ALIAS_PROVISION_TY.to_string(),
            reducers::task_alias_reducer(scx.clone()),
        );

        self.tcx.ecx.register_reducer(
            "posix.envVarDyn".to_string(),
            reducers::dyn_env_reducer(self.tcx.clone(), scx.clone()),
        );

        Ok(TasksSystemInstance {
            tcx: self.tcx.clone(),
            scx,
        })
    }
}

pub struct TasksSystemInstance {
    tcx: Arc<TasksCtx>,
    scx: Arc<crate::systems::SystemsCtx>,
}

impl TasksSystemInstance {
    pub const BB_STATE_KEY: &'static str = "tasks.state";
}

#[async_trait::async_trait]
impl SystemInstance for TasksSystemInstance {
    type LockState = TasksLockState;

    async fn load_config(
        &self,
        config: serde_json::Value,
        _bb: ConfigBlackboard,
        _state: Option<Self::LockState>,
    ) -> Res<()> {
        let config: TasksModuleConfig =
            serde_json::from_value(config).wrap_err("error parsing tasks module config")?;

        let graph = build_task_graph(&config).wrap_err("error building task graph")?;

        let loaded = LoadedState { config, graph };
        self.scx.insert_bb(Self::BB_STATE_KEY, Arc::new(loaded));
        Ok(())
    }

    async fn load_lock_entry(&self, raw: serde_json::Value) -> Res<Self::LockState> {
        let entry: TasksLockState = serde_json::from_value(raw)?;
        if entry.version != "0" {
            eyre::bail!("unexpected version tag deserializing lockEntry");
        }
        Ok(entry)
    }

    async fn gen_lock_entry(&self) -> Res<serde_json::Value> {
        Ok(serde_json::json!({ "version": "0" }))
    }

    async fn commands(&self) -> Res<Vec<SystemCliCommand>> {
        let state: Arc<LoadedState> = self.scx.get_bb(Self::BB_STATE_KEY);

        // Get named tasks set for visibility control
        let named_set: std::collections::HashSet<_> =
            state.config.tasks_named.iter().cloned().collect();

        // Create task subcommands sorted by key
        let mut task_commands = IndexMap::new();
        for (task_key, task_def) in state.config.tasks.iter() {
            let is_named = named_set.contains(task_key);

            // Get basic description from task definition
            let mut long_desc = match task_def {
                TaskDefHashed::DenoFileV1(d) => d.desc.clone().unwrap_or_default(),
            };
            let desc = long_desc.clone();

            // Add dependency information to description
            let deps = match task_def {
                TaskDefHashed::DenoFileV1(d) => d.depends_on.as_deref().unwrap_or(&[]),
            };
            if !deps.is_empty() {
                let deps_str = deps.join(", ");
                if long_desc.is_empty() {
                    long_desc = format!("Depends on: {}", deps_str);
                } else {
                    long_desc = format!("{}\nDepends on: {}", long_desc, deps_str);
                }
            }

            // Create command for this task
            let mut task_cmd = clap::Command::new(task_key.clone())
                .disable_help_subcommand(true)
                .arg(
                    clap::Arg::new("args")
                        .value_name("TASK ARGS")
                        .num_args(0..)
                        .trailing_var_arg(true)
                        .allow_hyphen_values(true)
                        .action(clap::ArgAction::Append),
                );

            // Set description if available
            if !long_desc.is_empty() {
                task_cmd = task_cmd.about(desc);
            }
            if !long_desc.is_empty() {
                task_cmd = task_cmd.long_about(long_desc);
            }

            // Hide task if not named
            if !is_named {
                task_cmd = task_cmd.hide(true);
            }

            // Create action for task execution
            let tcx = self.tcx.clone();
            let task_key_clone = task_key.clone();
            let scx = self.scx.clone();
            let action: crate::systems::CliCommandAction = Box::new(move |matches| {
                let tcx = tcx.clone();
                let scx = scx.clone();
                let task_key = task_key_clone.clone();
                async move {
                    // Extract arguments
                    let args: Vec<String> = matches
                        .get_many::<String>("args")
                        .map(|v| v.cloned().collect())
                        .unwrap_or_default();

                    // Execute task
                    let state: Arc<LoadedState> = scx.get_bb(TasksSystemInstance::BB_STATE_KEY);
                    let _output = exec_task(
                        &tcx.gcx,
                        &tcx.ecx,
                        &scx,
                        &state.config,
                        &state.graph,
                        &task_key,
                        args,
                    )
                    .await
                    .wrap_err_with(|| format!("error executing task {task_key}"))?;

                    Ok(())
                }
                .boxed()
            });

            task_commands.insert(
                task_key.clone().into(),
                SystemCliCommand {
                    name: task_key.clone().into(),
                    clap: task_cmd,
                    sub_commands: IndexMap::new(),
                    action: Some(action),
                },
            );
        }
        task_commands.sort_unstable_keys();

        // Create main tasks command with task subcommands
        let tasks_cmd = SystemCliCommand {
            name: "tasks".into(),
            clap: clap::Command::new("tasks")
                .visible_alias("x")
                .about("Tasks module, execute your task programs.")
                .before_long_help("The named tasks in your ghjkfile will be listed here.")
                .disable_help_subcommand(true),
            sub_commands: task_commands,
            action: None,
        };

        Ok(vec![tasks_cmd])
    }
}
