use crate::{interlude::*, systems::envs::EnvsCtx};

use super::types::{DenoWorkerTaskDefHashed, TaskDefHashed, TasksModuleConfig};

#[derive(Debug, Clone)]
pub struct TaskGraph {
    pub indie: Vec<String>,
    /// edges from dependent to dependency
    pub dep_edges: IndexMap<String, Vec<String>>,
    /// edges from dependency to dependent
    pub rev_dep_edges: IndexMap<String, Vec<String>>,
}

pub fn build_task_graph(tasks: &TasksModuleConfig) -> Res<TaskGraph> {
    let mut graph = TaskGraph {
        indie: vec![],
        dep_edges: default(),
        rev_dep_edges: default(),
    };

    for (hash, task) in &tasks.tasks {
        let depends_on = match task {
            TaskDefHashed::DenoFileV1(def) => def.depends_on.clone().unwrap_or_default(),
        };

        if depends_on.is_empty() {
            graph.indie.push(hash.clone());
        } else {
            // cycle detection via DFS
            for dep_hash in &depends_on {
                // Check if dependency exists
                if !tasks.tasks.contains_key(dep_hash) {
                    eyre::bail!("specified dependency task doesn't exist: '{dep_hash}' (required by '{hash}')");
                }

                fn find_cycle<'a>(
                    tasks: &'a TasksModuleConfig,
                    name: &str,
                    dep: &str,
                ) -> Option<&'a TaskDefHashed> {
                    let dep_task = tasks.tasks.get(dep)?;
                    let dep_deps = match dep_task {
                        TaskDefHashed::DenoFileV1(d) => d.depends_on.as_deref().unwrap_or(&[]),
                    };
                    if dep_deps.iter().any(|x| x == name) {
                        return Some(dep_task);
                    }
                    for next in dep_deps {
                        if let Some(hit) = find_cycle(tasks, name, next) {
                            return Some(hit);
                        }
                    }
                    None
                }

                if let Some(cycle_src) = find_cycle(tasks, hash, dep_hash) {
                    eyre::bail!("cyclic dependency detected building task graph: {hash:?} <-> {dep_hash:?} ({cycle_src:?})");
                }

                graph
                    .rev_dep_edges
                    .entry(dep_hash.clone())
                    .or_default()
                    .push(hash.clone());
            }
            graph.dep_edges.insert(hash.clone(), depends_on);
        }
    }

    Ok(graph)
}

pub async fn exec_task(
    gcx: &GhjkCtx,
    ecx: &EnvsCtx,
    scx: &crate::systems::SystemsCtx,
    tasks_config: &TasksModuleConfig,
    task_graph: &TaskGraph,
    target_key: &str,
    args: Vec<String>,
) -> Res<IndexMap<String, serde_json::Value>> {
    // collect working set: target + all transitive deps
    let mut work_set: ahash::AHashSet<String> = ahash::AHashSet::new();
    {
        let mut stack = vec![target_key.to_string()];
        while let Some(task_hash) = stack.pop() {
            if !work_set.insert(task_hash.clone()) {
                continue;
            }
            let task_def = tasks_config.tasks.get(&task_hash).ok_or_else(|| {
                ferr!("task '{task_hash}' referenced but not found in tasks config")
            })?;
            let deps = match task_def {
                TaskDefHashed::DenoFileV1(d) => d.depends_on.as_deref().unwrap_or(&[]),
            };
            for d in deps {
                stack.push(d.clone());
            }
        }
    }

    // pending dep edges (mutable) and starting queue
    let mut pending_dep_edges: IndexMap<String, Vec<String>> = task_graph.dep_edges.clone();
    let mut pending_tasks: Vec<String> = task_graph
        .indie
        .iter()
        .filter(|k| work_set.contains(&***k))
        .cloned()
        .collect();

    if pending_tasks.is_empty() {
        eyre::bail!("something went wrong, task graph starting set is empty");
    }

    // collection for task outputs
    let mut output: IndexMap<String, serde_json::Value> = IndexMap::new();

    // execute ready tasks until completion
    while let Some(task_key) = pending_tasks.pop() {
        let task_def = tasks_config
            .tasks
            .get(&task_key)
            .ok_or_else(|| ferr!("task '{task_key}' referenced but not found in tasks config"))?;

        // reduce and cook env for this task into a temp dir (no shell loaders)
        let (env_key, deno_task): (&str, &DenoWorkerTaskDefHashed) = match task_def {
            TaskDefHashed::DenoFileV1(def) => (&def.env_key, def),
        };

        // Use tempfile crate as approved to manage a scoped temp dir for env cooking
        let task_env_dir = {
            let tmpdir = ::tempfile::Builder::new()
                .prefix(&format!(
                    "ws_ghjkTaskEnv_{}_",
                    task_key.replace(['/', '\\', ':'], "_")
                ))
                .tempdir()
                .wrap_err("error creating temp dir for task env")?;
            tmpdir
        };

        let env_vars: IndexMap<String, String> = {
            // Cook the environment using the envs system
            crate::systems::envs::reduce_and_cook_to(
                ecx,
                scx,
                env_key,
                None,
                task_env_dir.path(),
                false, // Don't create shell loaders for task execution
            )
            .await
            .wrap_err("error cooking environment for task")?
        };

        // Merge environment with current process env and PATH handling like TS side
        let mut merged_env: IndexMap<String, String> = std::env::vars().collect();
        for (k, mut v) in env_vars {
            if k.contains("PATH") {
                if let Ok(prev) = std::env::var(&k) {
                    let mut parts = vec![v];
                    parts.extend(prev.split(':').map(|s| s.to_string()));
                    // dedup non-empty
                    let mut seen = ahash::AHashSet::new();
                    let mut out = vec![];
                    for p in parts {
                        if !p.is_empty() && seen.insert(p.clone()) {
                            out.push(p);
                        }
                    }
                    v = out.join(":");
                }
            }
            merged_env.insert(k, v);
        }

        // Execute task via Deno worker
        match task_def {
            TaskDefHashed::DenoFileV1(def) => {
                let ghjkfile = gcx
                    .config
                    .ghjkfile
                    .as_ref()
                    .ok_or_else(|| ferr!("denoFile task found but no ghjkfile; running on lockfile alone is unsupported for tasks"))?;
                let working_dir = if let Some(wd) = &def.working_dir {
                    ghjkfile.parent().unwrap_or(Path::new(".")).join(wd)
                } else {
                    ghjkfile.parent().unwrap_or(Path::new(".")).to_path_buf()
                };

                // Prepare payload like TS execTaskDeno expects

                let payload = ExecTaskArgs {
                    key: &def.key,
                    argv: &args,
                    working_dir: working_dir.to_string_lossy().to_string(),
                    env_vars: &merged_env,
                };

                // Execute via our JS bindings module:
                // - module: src/ghjk/systems/tasks/bindings.ts
                // - export: execTaskDeno(ghjkfileUri, payload)
                let ghjkfile_canon_path: std::path::PathBuf =
                    ghjkfile.canonicalize().unwrap_or(ghjkfile.clone());
                let ghjkfile_uri = url::Url::from_file_path(&ghjkfile_canon_path)
                    .map_err(|_| ferr!("invalid ghjkfile path for file URL"))?
                    .to_string();

                // Call exec_task_deno to execute the task
                let task_output = exec_task_deno(gcx, &ghjkfile_uri, &payload)
                    .await
                    .wrap_err("error executing deno task")?;

                // Store the task output
                output.insert(deno_task.key.clone(), task_output);
            }
        }

        // Clean-up tempdir (auto by tempfile)

        // Mark as completed
        work_set.remove(&task_key);

        // Identify dependents and update readiness
        let dependents = task_graph
            .rev_dep_edges
            .get(&task_key)
            .cloned()
            .unwrap_or_default();
        let dependents: Vec<_> = dependents
            .into_iter()
            .filter(|name| work_set.contains(name))
            .collect();

        let mut ready = vec![];
        for parent in dependents {
            if let Some(parent_deps) = pending_dep_edges.get_mut(&parent) {
                // Remove the completed task from parent's dependencies
                if let Some(idx) = parent_deps.iter().position(|k| k == &task_key) {
                    parent_deps.swap_remove(idx);
                }
                // If parent has no more dependencies, it's ready to run
                if parent_deps.is_empty() {
                    ready.push(parent);
                }
            }
        }
        pending_tasks.extend(ready);
    }

    if !work_set.is_empty() {
        eyre::bail!("something went wrong, task graph work set is not empty");
    }

    Ok(output)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ExecTaskArgs<'a> {
    key: &'a str,
    argv: &'a [String],
    working_dir: String,
    env_vars: &'a IndexMap<String, String>,
}

/// Execute a deno task following the exact pattern from host/deno.rs
async fn exec_task_deno<'a>(
    gcx: &GhjkCtx,
    ghjkfile_uri: &str,
    payload: &ExecTaskArgs<'a>,
) -> Res<serde_json::Value> {
    let main_module = gcx
        .config
        .repo_root
        .join("src/ghjk/systems/tasks/bindings.ts")
        .wrap_err("repo url error")?;

    let mut ext_conf = crate::ext::ExtConfig::new();

    ext_conf.blackboard = [
        // blackboard is used as communication means
        // with the deno side of the code
        (
            "args".into(),
            json!({
                "uri": ghjkfile_uri,
                "payload": payload,
            }),
        ),
    ]
    .into_iter()
    .collect::<crate::utils::DHashMap<_, _>>()
    .into();

    let bb = ext_conf.blackboard.clone();

    let worker = gcx
        .deno
        .prepare_module(
            main_module.clone(),
            deno_runtime::deno_permissions::PermissionsOptions {
                allow_env: Some(vec![]),
                allow_import: Some(vec![]),
                allow_read: Some(vec![]),
                allow_net: Some(vec![]),
                allow_ffi: Some(vec![]),
                allow_run: Some(vec![]),
                allow_sys: Some(vec![]),
                allow_write: Some(vec![]),
                allow_all: true,
                prompt: false,
                ..default()
            },
            deno_runtime::WorkerExecutionMode::Run,
            default(),
            Some(crate::ext::extensions(ext_conf)),
        )
        .await
        .wrap_err("error preparing task deno worker")?;

    let (exit_code, _worker) = worker
        .run()
        .await
        .wrap_err("error on run of task deno worker")?;
    if exit_code != 0 {
        eyre::bail!("non-zero exit code running deno task execution module");
    }

    let (_, resp) = bb.remove("resp").expect_or_log("resp missing");

    #[derive(Deserialize)]
    #[serde(untagged, rename_all = "lowercase")]
    enum TaskResult {
        Ok { data: serde_json::Value },
        Err { error: serde_json::Value },
    }

    let result: TaskResult =
        serde_json::from_value(resp).wrap_err("error deserializing task result")?;

    match result {
        TaskResult::Ok { data } => Ok(data),
        TaskResult::Err { error } => Err(ferr!(
            "task execution failed: {}",
            serde_json::to_string_pretty(&error).unwrap_or_else(|_| format!("{:?}", error))
        )),
    }
}
