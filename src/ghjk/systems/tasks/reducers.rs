use crate::interlude::*;

use futures::FutureExt;

use super::{exec_task, TasksCtx};
use crate::systems::envs::types::{Provision, ProvisionReducer, WellKnownProvision};

/// This reducer expands a single ghjk.tasks.Alias trigger into shell aliases for all tasks,
/// allowing tasks to be available as shell aliases when environments are activated.
pub fn task_alias_reducer(scx: Arc<crate::systems::SystemsCtx>) -> ProvisionReducer {
    Box::new(move |provisions: Vec<Provision>| {
        let scx = scx.clone();
        async move {
            let mut output = vec![];
            let mut x_task_exists = false;
            // If there is at least one trigger, expand aliases for all tasks
            if !provisions.is_empty() {
                let state: Arc<super::LoadedState> =
                    scx.get_bb(super::TasksSystemInstance::BB_STATE_KEY);
                // map local key to final visible key
                for (task_key, task_def) in state.config.tasks.iter() {
                    let (alias_name, desc) = match task_def {
                        crate::systems::tasks::types::TaskDefHashed::DenoFileV1(def) => {
                            let mut description = def.desc.clone().unwrap_or_default();
                            if let Some(deps) = def.depends_on.as_ref() {
                                if !deps.is_empty() {
                                    let deps_str = deps.join(", ");
                                    if description.is_empty() {
                                        description = format!("Depends on: {}", deps_str);
                                    } else {
                                        description =
                                            format!("{}\nDepends on: {}", description, deps_str);
                                    }
                                }
                            }
                            (task_key.clone(), description)
                        }
                    };
                    x_task_exists = x_task_exists || alias_name == "x";
                    output.push(WellKnownProvision::GhjkShellAlias {
                        alias_name,
                        command: vec!["ghjk".to_string(), "x".to_string(), task_key.clone()],
                        description: if desc.is_empty() { None } else { Some(desc) },
                        wraps: None,
                    });
                }

                // alias completions are added via task_alias_reducer_with_cmd registered in cli
            }
            if !x_task_exists {
                output.push(WellKnownProvision::GhjkShellAlias {
                    alias_name: "x".to_string(),
                    command: vec!["ghjk".to_string(), "x".to_string()],
                    description: Some("Run ghjk tasks by name".to_string()),
                    wraps: None,
                });
            }

            Ok(output)
        }
        .boxed()
    })
}

/// This reducer executes tasks and uses their output as environment variable values.
/// It handles `posix.envVarDyn` provisions that specify a task to run.
pub fn dyn_env_reducer(
    tcx: Arc<TasksCtx>,
    scx: Arc<crate::systems::SystemsCtx>,
) -> ProvisionReducer {
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
                        let key = strange
                            .get("key")
                            .and_then(|v| v.as_str())
                            .map(|s| s.to_string());
                        let task_key = strange
                            .get("taskKey")
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
                let val = execute_task_for_env_var(&tcx, &scx, &task_key)
                    .await
                    .wrap_err_with(|| ferr!("error executing task for env var: {key}"))?;

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
async fn execute_task_for_env_var(
    tcx: &TasksCtx,
    scx: &crate::systems::SystemsCtx,
    task_key: &str,
) -> Res<String> {
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
        .ok_or_else(|| ferr!("task with key '{task_key}' not found"))?;

    // Execute the task and get its output
    let task_output = exec_task(
        &tcx.gcx,
        &tcx.ecx,
        scx,
        &state.config,
        &state.graph,
        &target_key,
        vec![],
    )
    .await?;

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
