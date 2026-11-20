//! Android-only helpers backed by Kotlin code in the generated Android project
//! (`gen/android/app/src/main/java/app/bookshelf/desktop/DisplayNamePlugin.kt`).

use serde::{Deserialize, Serialize};
use tauri::plugin::{Builder, PluginHandle, TauriPlugin};
use tauri::{AppHandle, Manager, Runtime};

struct DisplayNames<R: Runtime>(PluginHandle<R>);

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("bookshelf-android")
        .setup(|app, api| {
            let handle = api.register_android_plugin("app.bookshelf.desktop", "DisplayNamePlugin")?;
            app.manage(DisplayNames(handle));
            Ok(())
        })
        .build()
}

#[derive(Serialize)]
struct Args<'a> {
    uri: &'a str,
}

#[derive(Deserialize)]
struct Reply {
    name: Option<String>,
}

/// The real file name behind a `content://` URI, if the provider knows it.
pub fn display_name<R: Runtime>(app: &AppHandle<R>, uri: &str) -> Option<String> {
    let names = app.try_state::<DisplayNames<R>>()?;
    let reply: Reply = names.0.run_mobile_plugin("getDisplayName", Args { uri }).ok()?;
    reply.name.filter(|n| !n.trim().is_empty())
}
