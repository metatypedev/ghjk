use crate::interlude::*;

#[rustfmt::skip]
use deno_core as deno_core; // necessary for re-exported macros to work

pub fn extensions(config: ExtConfig) -> Arc<denort::deno::worker::CustomExtensionsCb> {
    // let atom = std::sync::atomic::AtomicBool::new(false);
    Arc::new(move || {
        // if atom.load(std::sync::atomic::Ordering::SeqCst) {
        //     return vec![];
        // }
        // atom.store(true, std::sync::atomic::Ordering::SeqCst);
        vec![ghjk_deno_ext::init_ops_and_esm(config.clone())]
    })
}

// This is used to populate the deno_core::OpState with dependencies
// used by the different ops
#[derive(Clone)]
pub struct ExtConfig {
    pub blackboard: Arc<DHashMap<CHeapStr, serde_json::Value>>,
}

impl ExtConfig {
    pub fn new(blackboard: Arc<DHashMap<CHeapStr, serde_json::Value>>) -> Self {
        Self { blackboard }
    }

    fn inject(self, state: &mut deno_core::OpState) {
        state.put(ExtContext {
            blackboard: self.blackboard.clone(),
        });
    }
}

deno_core::extension!(
    ghjk_deno_ext,
    ops = [op_get_blackboard, op_set_blackboard],
    options = { config: ExtConfig },
    state = |state, opt| {
        opt.config.inject(state);
    },
    customizer = |ext: &mut deno_core::Extension| {
        customizer(ext);
    },
    docs = "Kitchen sink extension for all ghjk needs.",
);

fn customizer(ext: &mut deno_core::Extension) {
    ext.esm_files
        .to_mut()
        .push(deno_core::ExtensionFileSource::new(
            "ext:ghjk_deno_ext/00_runtime.js",
            deno_core::ascii_str_include!("deno/00_runtime.js"),
        ));
    ext.esm_entry_point = Some("ext:ghjk_deno_ext/00_runtime.js");
}

struct ExtContext {
    blackboard: Arc<DHashMap<CHeapStr, serde_json::Value>>,
}

#[deno_core::op2]
#[serde]
pub fn op_get_blackboard(
    #[state] ctx: &ExtContext,
    #[string] key: &str,
) -> Option<serde_json::Value> {
    ctx.blackboard.get(key).map(|val| val.clone())
}

#[deno_core::op2]
#[serde]
pub fn op_set_blackboard(
    #[state] ctx: &ExtContext,
    #[string] key: String,
    #[serde] val: serde_json::Value,
) -> Option<serde_json::Value> {
    ctx.blackboard
        .insert(key.into(), val)
        .map(|val| val.clone())
}
