use crate::interlude::*;

// Ensure that the `tracing` stack is only initialised once using `once_cell`
// isn't required in cargo-nextest since each test runs in a new process
pub fn setup_tracing_once() {
    use once_cell::sync::Lazy;
    static TRACING: Lazy<()> = Lazy::new(|| {
        setup_tracing().expect("failed to init tracing");
    });
    Lazy::force(&TRACING);
}

pub fn setup_tracing() -> eyre::Result<()> {
    color_eyre::install()?;
    if std::env::var("RUST_LOG").is_err() {
        std::env::set_var("RUST_LOG", "info");
    }

    // tracing_log::LogTracer::init()?;
    tracing_subscriber::fmt()
        .compact()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .with_timer(tracing_subscriber::fmt::time::uptime())
        .try_init()
        .map_err(|err| eyre::eyre!(err))?;

    Ok(())
}

#[inline]
pub fn default<T: Default>() -> T {
    std::default::Default::default()
}

pub type DHashMap<K, V> = dashmap::DashMap<K, V, ahash::random_state::RandomState>;
pub use cheapstr::CHeapStr;

mod cheapstr {
    use crate::interlude::*;

    use std::{
        borrow::Cow,
        hash::{Hash, Hasher},
    };
    // lifted from github.com/bevyengine/bevy 's bevy_core/Name struct
    // MIT/APACHE2 licence
    #[derive(Debug, Clone, Serialize, Deserialize)]
    #[serde(crate = "serde", from = "String", into = "String")]
    pub struct CHeapStr {
        hash: u64,
        string: Cow<'static, str>,
    }

    impl CHeapStr {
        /// Creates a new [`IdUnique`] from any string-like type.
        pub fn new(string: impl Into<Cow<'static, str>>) -> Self {
            let string = string.into();
            let mut id = Self { string, hash: 0 };
            id.update_hash();
            id
        }

        /// Gets the name of the entity as a `&str`.
        #[inline]
        pub fn as_str(&self) -> &str {
            &self.string
        }

        fn update_hash(&mut self) {
            let mut hasher = ahash::AHasher::default();
            self.string.hash(&mut hasher);
            self.hash = hasher.finish();
        }
    }

    impl From<&str> for CHeapStr {
        #[inline(always)]
        fn from(string: &str) -> Self {
            Self::new(string.to_owned())
        }
    }

    impl Hash for CHeapStr {
        fn hash<H: Hasher>(&self, state: &mut H) {
            self.string.hash(state);
        }
    }

    impl PartialEq for CHeapStr {
        fn eq(&self, other: &Self) -> bool {
            if self.hash != other.hash {
                // Makes the common case of two strings not been equal very fast
                return false;
            }

            self.string.eq(&other.string)
        }
    }

    impl Eq for CHeapStr {}

    impl PartialOrd for CHeapStr {
        fn partial_cmp(&self, other: &Self) -> Option<std::cmp::Ordering> {
            self.string.partial_cmp(&other.string)
        }
    }

    impl Ord for CHeapStr {
        fn cmp(&self, other: &Self) -> std::cmp::Ordering {
            self.string.cmp(&other.string)
        }
    }

    impl std::ops::Deref for CHeapStr {
        type Target = Cow<'static, str>;

        fn deref(&self) -> &Self::Target {
            &self.string
        }
    }

    impl From<String> for CHeapStr {
        fn from(string: String) -> Self {
            /* let byte_arc: Arc<[u8]> = string.into_bytes().into();
            let str_arc = unsafe { Arc::from_raw(Arc::into_raw(byte_arc) as *const str) }; */
            Self::new(string)
        }
    }

    impl Into<String> for CHeapStr {
        fn into(self) -> String {
            // FIXME: optmize this
            /* let string = if let Some(s) = Arc::get_mut(&mut self.0) {
                unsafe {
                    String::from_raw_parts(
                        s as *mut str as *mut u8,
                        s.len(),
                        s.len()
                    )
                }
            } else {
                (&self.0[..]).to_string()
            };
            std::mem::forget(self.0);
            string */
            self.string.into_owned()
        }
    }

    impl std::fmt::Display for CHeapStr {
        fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
            self.string.fmt(f)
        }
    }
}
