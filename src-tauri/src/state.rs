use crate::database::Db;
use std::path::PathBuf;
use std::sync::Arc;

pub struct AppState {
    pub db: Arc<Db>,
    pub data_dir: PathBuf,
    pub covers_dir: PathBuf,
}
