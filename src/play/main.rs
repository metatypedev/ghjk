#![allow(unused)]

use futures_concurrency::prelude::*;
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
};

type BoxErr = Box<dyn std::error::Error + Send + Sync + 'static>;
type Res<T> = Result<T, BoxErr>;

fn main() {
    tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap()
        .block_on(async {
            // playground
        });
}
