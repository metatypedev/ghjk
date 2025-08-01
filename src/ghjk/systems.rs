//! Systems (formerly modules) are units of implementation that bundle together
//! related functionality.

use std::any::Any;

use crate::interlude::*;

pub mod deno;
pub mod envs;

pub enum SystemManifest {
    Deno(deno::DenoSystemManifest),
    Envs(envs::EnvsSystemInstance),
}

impl SystemManifest {
    pub async fn init(&self) -> Res<ErasedSystemInstance> {
        match self {
            SystemManifest::Deno(man) => Ok(ErasedSystemInstance::new(Arc::new(man.ctor().await?))),
            SystemManifest::Envs(instance) => Ok(ErasedSystemInstance::new(Arc::new(instance.clone()))),
        }
    }
}

#[async_trait::async_trait]
pub trait SystemInstance {
    type LockState;

    async fn load_config(
        &self,
        config: serde_json::Value,
        bb: ConfigBlackboard,
        state: Option<Self::LockState>,
    ) -> Res<()>;

    async fn load_lock_entry(&self, raw: serde_json::Value) -> Res<Self::LockState>;

    async fn gen_lock_entry(&self) -> Res<serde_json::Value>;

    async fn commands(&self) -> Res<Vec<SystemCliCommand>>;
}

type BoxAny = Box<dyn Any + Send + Sync>;

#[allow(clippy::type_complexity)]
pub struct ErasedSystemInstance {
    load_lock_entry_fn: Box<dyn Fn(serde_json::Value) -> BoxFuture<'static, Res<BoxAny>>>,
    gen_lock_entry_fn: Box<dyn Fn() -> BoxFuture<'static, Res<serde_json::Value>>>,
    load_config_fn: Box<
        dyn Fn(serde_json::Value, ConfigBlackboard, Option<BoxAny>) -> BoxFuture<'static, Res<()>>,
    >,
    commands_fn: Box<dyn Fn() -> BoxFuture<'static, Res<Vec<SystemCliCommand>>>>,
}

impl ErasedSystemInstance {
    pub fn new<S, L>(instance: Arc<S>) -> Self
    where
        S: SystemInstance<LockState = L> + Send + Sync + 'static,
        L: std::any::Any + Send + Sync,
    {
        Self {
            load_lock_entry_fn: {
                let instance = instance.clone();
                Box::new(move |raw| {
                    let instance = instance.clone();
                    async move {
                        let res: BoxAny = Box::new(instance.load_lock_entry(raw).await?);
                        Ok(res)
                    }
                    .boxed()
                })
            },
            gen_lock_entry_fn: {
                let instance = instance.clone();
                Box::new(move || {
                    let instance = instance.clone();
                    async move { instance.gen_lock_entry().await }.boxed()
                })
            },
            load_config_fn: {
                let instance = instance.clone();
                Box::new(move |config, bb, state| {
                    let instance = instance.clone();
                    async move {
                        let state: Option<Box<L>> =
                            state.map(|st| st.downcast().expect_or_log("downcast error"));
                        instance.load_config(config, bb, state.map(|bx| *bx)).await
                    }
                    .boxed()
                })
            },
            commands_fn: {
                let instance = instance.clone();
                Box::new(move || {
                    let instance = instance.clone();
                    async move { instance.commands().await }.boxed()
                })
            },
        }
    }

    pub async fn load_config(
        &self,
        config: serde_json::Value,
        bb: ConfigBlackboard,
        state: Option<BoxAny>,
    ) -> Res<()> {
        (self.load_config_fn)(config, bb, state).await
    }

    pub async fn load_lock_entry(&self, raw: serde_json::Value) -> Res<BoxAny> {
        (self.load_lock_entry_fn)(raw).await
    }

    pub async fn gen_lock_entry(&self) -> Res<serde_json::Value> {
        (self.gen_lock_entry_fn)().await
    }

    pub async fn commands(&self) -> Res<Vec<SystemCliCommand>> {
        (self.commands_fn)().await
    }
}

pub type SystemId = CHeapStr;

#[derive(Debug, Serialize, Deserialize, PartialEq)]
pub struct SystemConfig {
    pub id: SystemId,
    pub config: serde_json::Value,
}

pub type CliCommandAction =
    Box<dyn Fn(clap::ArgMatches) -> BoxFuture<'static, Res<()>> + Send + Sync>;

pub struct SystemCliCommand {
    pub name: CHeapStr,
    pub clap: clap::Command,
    pub sub_commands: IndexMap<CHeapStr, SystemCliCommand>,
    pub action: Option<CliCommandAction>,
}

impl std::fmt::Debug for SystemCliCommand {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("SystemCliCommand")
            .field("name", &self.name)
            .field("sub_commands", &self.sub_commands)
            .field("actions", &self.action.is_some())
            .finish()
    }
}

pub type ConfigBlackboard = Arc<serde_json::Map<String, serde_json::Value>>;
