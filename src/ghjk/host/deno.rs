use crate::interlude::*;

use denort::deno::deno_runtime;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct InternalSerializationResult {
    config: super::SerializedConfig,
    accessed_env_keys: Vec<String>,
    read_file_paths: Vec<PathBuf>,
    listed_file_paths: Vec<PathBuf>,
}

pub async fn serialize_deno_ghjkfile(
    hcx: &super::HostCtx,
    path: &Path,
) -> Res<super::SerializationResult> {
    let main_module = deno_runtime::deno_core::resolve_path(
        hcx.gcx.repo_root.join("./files/deno/mod2.ts"),
        &hcx.config.cwd,
    )
    .wrap_err("error resolving main module")?;

    let blackboard = [
        // blackboard is used as communication means
        // with the deno side of the code
        (
            "args".into(),
            serde_json::json!({
                "uri": url::Url::from_file_path(path).unwrap_or_log(),
            }),
        ),
    ]
    .into_iter()
    .collect::<DHashMap<CHeapStr, _>>();

    let blackboard = Arc::new(blackboard);

    let mut worker = hcx
        .gcx
        .deno
        .prepare_module(
            main_module.clone(),
            deno_runtime::deno_permissions::PermissionsOptions {
                allow_env: Some(vec![]),
                allow_import: Some(vec![]),
                allow_read: Some(vec![]),
                allow_net: Some(vec![]),
                ..default()
            },
            deno_runtime::WorkerExecutionMode::Run,
            default(),
            Some(crate::deno::extensions(crate::deno::ExtConfig {
                blackboard: blackboard.clone(),
            })),
        )
        .await?;

    let exit_code = worker.run().await?;
    if exit_code != 0 {
        eyre::bail!("non-zero exit code running deno module");
    }
    let loaded_modules = worker.get_loaded_modules().await;

    let (_, resp) = blackboard.remove("resp").expect_or_log("resp missing");
    let resp: InternalSerializationResult =
        serde_json::from_value(resp).expect_or_log("error deserializing resp");

    Ok(super::SerializationResult {
        config: resp.config,
        accessed_env_keys: resp.accessed_env_keys,
        listed_file_paths: resp.listed_file_paths,
        read_file_paths: resp.read_file_paths,
        loaded_modules,
    })
}
