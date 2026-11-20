package app.bookshelf.desktop

import android.app.Activity
import android.net.Uri
import android.provider.OpenableColumns
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin

@InvokeArg
class DisplayNameArgs {
    lateinit var uri: String
}

/**
 * The Android file picker hands BookShelf content:// URIs whose last segment is
 * often just a numeric id (e.g. ".../document/msf:1000459611"). This asks the
 * content provider for the file's real name ("Atomic Habits.pdf") so imports
 * get a sensible file name and title. Called from Rust (src-tauri/src/android.rs).
 */
@TauriPlugin
class DisplayNamePlugin(private val activity: Activity) : Plugin(activity) {
    @Command
    fun getDisplayName(invoke: Invoke) {
        val args = invoke.parseArgs(DisplayNameArgs::class.java)
        var name: String? = null
        try {
            activity.contentResolver
                .query(Uri.parse(args.uri), arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)
                ?.use { cursor ->
                    val column = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                    if (column >= 0 && cursor.moveToFirst()) name = cursor.getString(column)
                }
        } catch (e: Exception) {
            // No name available (permission expired, provider without names, ...): fall back in Rust.
        }
        val result = JSObject()
        result.put("name", name)
        invoke.resolve(result)
    }
}
