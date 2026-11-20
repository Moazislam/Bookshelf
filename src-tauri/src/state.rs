use crate::database::Db;
use std::path::PathBuf;
use std::sync::Arc;

pub struct AppState {
    pub db: Arc<Db>,
    pub data_dir: PathBuf,
    pub covers_dir: PathBuf,
}

impl AppState {
    /// Where imported files are kept when they are copied into app storage
    /// (always on mobile, where picked files are only reachable through URIs).
    pub fn library_dir(&self) -> PathBuf {
        self.data_dir.join("library")
    }

    /// Scratch space for files on their way in or out of app storage.
    pub fn temp_dir(&self) -> PathBuf {
        self.data_dir.join("tmp")
    }
}
