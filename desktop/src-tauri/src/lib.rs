//! zAgentKit: a thin Tauri shell over the `zak` CLI and the installed `z-delegate settings` commands.

pub mod cli_install;
pub mod installs;
pub mod kit;
pub mod settings;
pub mod templates;
pub mod tools;

use serde_json::Value;
use settings::Runner;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

async fn blocking<T: Send + 'static>(f: impl FnOnce() -> Result<T, String> + Send + 'static) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(f).await.map_err(|e| format!("task failed: {e}"))?
}

#[tauri::command]
async fn tool_status() -> Result<tools::ToolStatus, String> {
    blocking(|| Ok(tools::status())).await
}

/// Installs the zak CLI with the official `install.sh` of the latest stable or beta release.
#[tauri::command]
async fn cli_install(channel: cli_install::Channel) -> Result<cli_install::InstallResult, String> {
    blocking(move || cli_install::install(channel)).await
}

#[tauri::command]
async fn kit_run(request: kit::KitRequest) -> Result<kit::RunResult, String> {
    blocking(move || kit::run(&request)).await
}

#[tauri::command]
async fn kit_source_get() -> Result<String, String> {
    blocking(kit::source_get).await
}

#[tauri::command]
async fn kit_source_set(choice: String) -> Result<String, String> {
    blocking(move || kit::source_set(&choice)).await
}

/// `<app_data_dir>/projects.json`, creating the directory.
fn projects_file(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| format!("cannot resolve the app data dir: {e}"))?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("cannot create {}: {e}", dir.display()))?;
    Ok(dir.join("projects.json"))
}

#[tauri::command]
async fn installs(app: AppHandle) -> Result<installs::Installs, String> {
    let file = projects_file(&app);
    blocking(move || {
        let home = tools::home_dir().ok_or("cannot resolve the home directory")?;
        Ok(installs::collect_with_store(&home, file.as_deref().map_err(Clone::clone)))
    })
    .await
}

#[tauri::command]
async fn project_add(app: AppHandle, path: String) -> Result<installs::Added, String> {
    let file = projects_file(&app)?;
    blocking(move || installs::add_project(&file, &path)).await
}

#[tauri::command]
async fn project_remove(app: AppHandle, path: String) -> Result<Vec<String>, String> {
    let file = projects_file(&app)?;
    blocking(move || installs::remove_project(&file, &path)).await
}

/// `z-delegate settings state` output as is.
#[tauri::command]
async fn models_state() -> Result<Value, String> {
    blocking(|| Runner::discover()?.state()).await
}

#[tauri::command]
async fn models_preview(rows: Value) -> Result<Value, String> {
    blocking(move || Runner::discover()?.preview(&rows)).await
}

/// Passes 200, 409, 422 and any other status through as `{ status, body }`.
#[tauri::command]
async fn models_save(edits: Value, base_hash: Option<String>) -> Result<settings::ApiReply, String> {
    blocking(move || Runner::discover()?.save(&edits, base_hash.as_deref())).await
}

/// `templates list` output as is: `{dir, templates}`.
#[tauri::command]
async fn templates_list() -> Result<Value, String> {
    blocking(|| templates::Runner::discover()?.list()).await
}

#[tauri::command]
async fn templates_get(name: String) -> Result<Value, String> {
    blocking(move || templates::Runner::discover()?.get(&name)).await
}

/// Passes 200, 409 and 422 through as `{ status, body }`.
#[tauri::command]
async fn templates_save(name: String, content: String, base_hash: Option<String>) -> Result<settings::ApiReply, String> {
    blocking(move || templates::Runner::discover()?.save(&name, &content, base_hash.as_deref())).await
}

#[tauri::command]
async fn templates_reset(name: String, base_hash: Option<String>) -> Result<settings::ApiReply, String> {
    blocking(move || templates::Runner::discover()?.reset(&name, base_hash.as_deref())).await
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            kit_run,
            kit_source_get,
            kit_source_set,
            tool_status,
            cli_install,
            installs,
            project_add,
            project_remove,
            models_state,
            models_preview,
            models_save,
            templates_list,
            templates_get,
            templates_save,
            templates_reset
        ])
        .run(tauri::generate_context!())
        .expect("error while running the zAgentKit app");
}
