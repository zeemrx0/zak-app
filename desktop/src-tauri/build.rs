const COMMANDS: &[&str] = &[
    "kit_run",
    "kit_source_get",
    "kit_source_set",
    "tool_status",
    "cli_install",
    "installs",
    "project_add",
    "project_remove",
    "models_state",
    "models_preview",
    "models_save",
];

fn main() {
    tauri_build::try_build(
        tauri_build::Attributes::new()
            .app_manifest(tauri_build::AppManifest::new().commands(COMMANDS)),
    )
    .expect("failed to run tauri-build");
}
