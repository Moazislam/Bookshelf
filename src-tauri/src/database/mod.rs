pub mod migrations;

use crate::error::AppResult;
use rusqlite::Connection;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard};

/// Shared database handle. A single connection guarded by a mutex keeps writes
/// serialised; SQLite in WAL mode makes this fast enough for a desktop library.
pub struct Db {
    conn: Mutex<Connection>,
    pub path: PathBuf,
}

impl Db {
    pub fn open(path: &Path) -> AppResult<Self> {
        let mut conn = Connection::open(path)?;
        configure(&conn)?;
        migrations::run(&mut conn)?;
        Ok(Self { conn: Mutex::new(conn), path: path.to_path_buf() })
    }

    #[cfg(test)]
    pub fn open_in_memory() -> AppResult<Self> {
        let mut conn = Connection::open_in_memory()?;
        configure(&conn)?;
        migrations::run(&mut conn)?;
        Ok(Self { conn: Mutex::new(conn), path: PathBuf::new() })
    }

    pub fn conn(&self) -> MutexGuard<'_, Connection> {
        // A poisoned mutex only means another thread panicked mid-operation;
        // SQLite transactions guarantee the data itself is still consistent.
        self.conn.lock().unwrap_or_else(|e| e.into_inner())
    }
}

fn configure(conn: &Connection) -> AppResult<()> {
    conn.execute_batch(
        "PRAGMA journal_mode = WAL;
         PRAGMA synchronous = NORMAL;
         PRAGMA foreign_keys = ON;
         PRAGMA busy_timeout = 5000;",
    )?;
    Ok(())
}
