use crate::interlude::*;

use futures::FutureExt;

use crate::systems::envs::types::{Provision, WellKnownProvision, ProvisionReducer};
use super::types::TaskAliasProvision;
use super::{TasksCtx, exec_task};


/// This reducer converts task alias provisions to shell alias provisions,
/// allowing tasks to be available as shell aliases when environments are activated.
pub fn task_alias_reducer() -> ProvisionReducer {
    Box::new(move |provisions: Vec<Provision>| {
        async move {
            let mut output = vec![
                // Always add the base "x" alias that maps to "ghjk x"
                WellKnownProvision::GhjkShellAlias {
                    alias_name: "x".to_string(),
                    command: vec!["ghjk".to_string(), "x".to_string()],
                }
            ];

            for provision in provisions {
                // Extract task alias provision data
                let task_alias = match &provision {
                    Provision::Strange(strange) => {
                        // Parse the task alias provision
                        let task_alias: TaskAliasProvision = serde_json::from_value(strange.clone())
                            .wrap_err("error parsing task alias provision")?;
                        task_alias
                    }
                    _ => {
                        return Err(eyre::eyre!("expected task alias provision, got: {:?}", provision));
                    }
                };

                // Convert task alias provision to shell alias provision
                // This will be handled by the environment system to generate shell functions
                output.push(WellKnownProvision::GhjkShellAlias {
                    alias_name: task_alias.alias_name,
                    command: vec![
                        "ghjk".to_string(),
                        "x".to_string(),
                        task_alias.task_name,
                    ],
                });
            }

            Ok(output)
        }
        .boxed()
    })
}

/// This reducer executes tasks and uses their output as environment variable values.
/// It handles `posix.envVarDyn` provisions that specify a task to run.
pub fn dyn_env_reducer(tcx: Arc<TasksCtx>, scx: Arc<crate::systems::SystemsCtx>) -> ProvisionReducer {
    Box::new(move |provisions: Vec<Provision>| {
        let tcx = tcx.clone();
        let scx = scx.clone();
        async move {
            use crate::systems::envs::types::{Provision, WellKnownProvision};
            
            let mut output = Vec::new();
            let mut bad_provisions = Vec::new();

            for provision in provisions {
                // Extract provision data - expecting format like:
                // { "ty": "posix.envVarDyn", "key": "ENV_VAR_NAME", "taskKey": "task_name" }
                let (key, task_key) = match &provision {
                    Provision::Strange(strange) => {
                        let key = strange.get("key")
                            .and_then(|v| v.as_str())
                            .map(|s| s.to_string());
                        let task_key = strange.get("taskKey")
                            .and_then(|v| v.as_str())
                            .map(|s| s.to_string());
                        
                        match (key, task_key) {
                            (Some(key), Some(task_key)) => (key, task_key),
                            _ => {
                                bad_provisions.push(provision);
                                continue;
                            }
                        }
                    }
                    _ => {
                        bad_provisions.push(provision);
                        continue;
                    }
                };

                // Execute the task to get the environment variable value
                let val = execute_task_for_env_var(&tcx, &scx, &task_key).await.unwrap_or_default();

                output.push(WellKnownProvision::PosixEnvVar { key, val });
            }

            if !bad_provisions.is_empty() {
                return Err(ferr!("cannot deduce task from keys: {bad_provisions:?}"));
            }

            Ok(output)
        }
        .boxed()
    })
}

/// Execute a task to get environment variable value using the tasks system
async fn execute_task_for_env_var(tcx: &TasksCtx, scx: &crate::systems::SystemsCtx, task_key: &str) -> Res<String> {
    debug!("executing task for env var: {task_key}");
    
    // Get the loaded state from tasks context
    let state: Arc<super::LoadedState> = scx.get_bb(super::TasksSystemInstance::BB_STATE_KEY);

    // Find the task in the configuration
    let target_key = state
        .config
        .tasks
        .iter()
        .find(|(_, task)| {
            // Extract the key from the task definition
            match task {
                crate::systems::tasks::types::TaskDefHashed::DenoFileV1(deno_task) => {
                    deno_task.key == task_key
                }
            }
        })
        .map(|(k, _)| k.clone())
        .ok_or_else(|| {
            ferr!("task with key '{task_key}' not found")
        })?;

    // Execute the task and get its output
    let task_output = exec_task(
        &tcx.gcx,
        &tcx.ecx,
        scx,
        &state.config,
        &state.graph,
        &target_key,
        vec![],
    ).await?;

    // Extract the value from the task output for this specific task key
    if let Some(output_value) = task_output.get(task_key) {
        // Convert the JSON value to a string
        match output_value {
            serde_json::Value::String(s) => Ok(s.clone()),
            serde_json::Value::Number(n) => Ok(n.to_string()),
            serde_json::Value::Bool(b) => Ok(b.to_string()),
            other => Ok(serde_json::to_string(other)?),
        }
    } else {
        // If no specific output, return empty string
        Ok(String::new())
    }
}