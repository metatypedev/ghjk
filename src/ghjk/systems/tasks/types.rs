use crate::interlude::*;

pub const TASK_ALIAS_PROVISION_TY: &str = "ghjk.tasks.Alias";

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TaskAliasProvision {
    pub ty: String,
    pub task_name: String,
    pub alias_name: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TasksModuleConfig {
    pub tasks: IndexMap<String, TaskDefHashed>,
    pub tasks_named: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(tag = "ty")]
pub enum TaskDefHashed {
    #[serde(rename = "denoFile@v1")]
    DenoFileV1(DenoWorkerTaskDefHashed),
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DenoWorkerTaskDefHashed {
    pub desc: Option<String>,
    pub working_dir: Option<String>,
    pub depends_on: Option<Vec<String>>,
    pub env_key: String,
    pub key: String,
}
