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

#[tracing::instrument(skip(hcx))]
pub async fn serialize_deno_ghjkfile(
    hcx: &super::HostCtx,
    path: &Path,
) -> Res<super::SerializationResult> {
    let main_module = hcx
        .gcx
        .repo_root
        .join("files/deno/bindings.ts")
        .wrap_err("repo url error")?;

    let mut ext_conf = crate::ext::ExtConfig::new();

    ext_conf.blackboard = [
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
    .collect::<DHashMap<_, _>>()
    .into();

    let bb = ext_conf.blackboard.clone();

    let worker = hcx
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
            Some(crate::ext::extensions(ext_conf)),
        )
        .await?;

    let (exit_code, mut worker) = worker.run().await?;
    if exit_code != 0 {
        eyre::bail!("non-zero exit code running deno module");
    }
    let loaded_modules = worker.get_loaded_modules().await;

    let (_, resp) = bb.remove("resp").expect_or_log("resp missing");
    let resp: InternalSerializationResult =
        serde_json::from_value(resp).expect_or_log("error deserializing resp");

    let mut loaded_modules = loaded_modules
        .into_iter()
        .filter(|url| url.scheme() == "file")
        .map(|url| {
            url.to_file_path()
                .map_err(|()| ferr!("url to path error: {url}"))
        })
        .collect::<Res<Vec<PathBuf>>>()?;

    let mut read_file_paths = resp.read_file_paths;
    read_file_paths.append(&mut loaded_modules);

    debug!("ghjk.ts serialized");

    Ok(super::SerializationResult {
        config: resp.config,
        accessed_env_keys: resp.accessed_env_keys,
        listed_file_paths: resp.listed_file_paths,
        read_file_paths,
    })
}
