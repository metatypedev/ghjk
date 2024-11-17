mod interlude {
    pub use crate::utils::{default, CHeapStr, DHashMap};

    pub use std::future::Future;
    pub use std::path::{Path, PathBuf};
    pub use std::sync::Arc;

    pub use color_eyre::eyre;
    pub use eyre::{format_err as ferr, Context, Result as Res, WrapErr};
    pub use futures_lite::{future::Boxed as BoxedFut, FutureExt};
    pub use serde::{Deserialize, Serialize};
    pub use serde_json::json;
    pub use smallvec::smallvec as svec;
    pub use smallvec::SmallVec as Svec;
    pub use tracing::{debug, error, info, trace, warn};
    pub use tracing_unwrap::*;
}
mod utils;

use crate::interlude::*;

fn main() -> Res<()> {
    utils::setup_tracing()?;

    denort::run(
        "main.ts".parse()?,
        None,
        deno::deno_runtime::permissions::PermissionsOptions {
            allow_all: true,
            ..default()
        },
        Arc::new(|| None),
    );

    Ok(())
}

mod play {}

fn play() {
    struct GraphQlTransport;
    impl GraphQlTransport {
        fn new() -> Self {
            Self
        }
    }

    struct SelctFieldParamUnselected<Args, Select> {
        args: Args,
        _phantom: std::marker::PhantomData<Select>,
    }
    impl<Args, Select> SelctFieldParamUnselected<Args, Select> {
        fn select(self, select: Select) -> SelectFieldParam<Args, Select> {
            SelectFieldParam {
                args: self.args,
                select,
            }
        }
    }

    struct SelectFieldParam<Args, Select> {
        args: Args,
        select: Select,
    }

    struct QueryGraph;
    impl QueryGraph {
        fn new() -> Self {
            Self
        }
        fn graphql(&self) -> GraphQlTransport {
            GraphQlTransport::new()
        }

        fn args<Args, Select>(&self, args: Args) -> SelectFieldParam<Args, Select> {
            SelctFieldParamUnselected {
                args,
                _phantom: std::marker::PhantomData,
            }
        }

        fn get_user(&self, args: GetUserArgs) -> GetUserUnselected {
            return GetUserUnselected { args };
        }
    }

    trait QueryNode {
        type Out;
    }

    #[derive(Default)]
    struct UserPartial {
        id: Option<String>,
        email: Option<String>,
        posts: Option<Vec<PostPartial>>,
    }
    struct GetUserArgs {
        id: String,
    }
    struct GetUserUnselected {
        args: GetUserArgs,
    }
    impl GetUserUnselected {
        fn select(self, args: GetUserSelect) -> GetUserNode {
            GetUserNode {
                args: self.args,
                select,
            }
        }
    }

    struct GetUserNode {
        args: GetUserArgs,
        select: GetUserSelect,
    }
    impl QueryNode for GetUserNode {
        type Out = UserPartial;
    }

    #[derive(Default)]
    struct GetUserSelect {
        email: bool,
        posts: Option<SelectFieldParam<PostArgs, PostSelectParams>>,
    }
    #[derive(Default)]
    struct PostPartial {
        slug: Option<String>,
        title: Option<String>,
    }
    #[derive(Default)]
    struct PostArgs {
        filter: String,
    }
    #[derive(Default)]
    struct PostSelectParams {
        slug: bool,
        title: bool,
    }

    let api1 = QueryGraph::new();
    let gql_client = api1.graphql();

    let (user, posts) = gql_client.query((
        api1.get_user(GetUserArgs { id: "1234".into() })
            .select(GetUserSelect {
                email: true,
                posts: Some(api1.args("hey")),
            }),
        api1.get_post(PostArgs {
            filter: "today".into(),
        }),
    ));
}
