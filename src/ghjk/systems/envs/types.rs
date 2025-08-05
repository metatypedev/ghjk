use crate::interlude::*;

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

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct EnvsModuleConfig {
    pub default_env: String,
    pub envs: IndexMap<String, EnvRecipe>,
    pub envs_named: IndexMap<String, String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(untagged)]
pub enum Provision {
    WellKnown(WellKnownProvision),
    /// It must have a ty field that's a string
    Strange(serde_json::Value),
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct EnvRecipe {
    pub desc: Option<String>,
    pub provides: Vec<Provision>,
}
