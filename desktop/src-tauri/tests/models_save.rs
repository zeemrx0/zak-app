//! Runs the real installed `z-delegate settings` commands against a temporary config (`Z_AGENTS_CONFIG`) and
//! checks state, preview and save: 200 on a fresh hash, 409 on a stale hash, 422 on an invalid edit.
//! The test prefers the kit checkout next to this repository, then the installed copy. It skips with a message
//! when node or a `z-delegate.cjs` that has the `settings` commands is not available.

use serde_json::json;
use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use zak_desktop_lib::settings::Runner;
use zak_desktop_lib::tools;

/// The sibling kit checkout when present, else the installed script.
fn find_script() -> Option<PathBuf> {
    let sibling = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../../z-agent-kit/agents/tiers/general/skills/z-delegation/scripts/z-delegate.cjs");
    if sibling.is_file() {
        return Some(sibling);
    }
    tools::find_z_delegate()
}

#[test]
fn state_preview_and_save_statuses() {
    let (Some(node), Some(script)) = (tools::find_node(), find_script()) else {
        eprintln!("skipped: node or z-delegate.cjs is not available");
        return;
    };
    let dir = std::env::temp_dir().join(format!("zak-desktop-it-{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    let config = dir.join("agents.json");
    fs::write(
        &config,
        json!({"configVersion": 1, "models": {"aliases": {
            "kept": {"model": "anthropic/claude-sonnet-5-5", "thinking": "medium"}
        }}})
        .to_string(),
    )
    .unwrap();
    fs::set_permissions(&config, fs::Permissions::from_mode(0o600)).unwrap();

    let env = [("Z_AGENTS_CONFIG".to_string(), config.to_string_lossy().into_owned())];
    let server = Runner::new(node, script, env.to_vec());
    if let Err(e) = server.state() {
        if e.contains("unknown or incomplete command") {
            eprintln!("skipped: the installed z-delegate.cjs has no settings command");
            let _ = fs::remove_dir_all(&dir);
            return;
        }
    }

    let state = server.state().expect("state");
    assert_eq!(state["path"], config.to_string_lossy().as_ref());
    assert!(state["agents"].is_array() && state["models"].is_array() && state["efforts"].is_array());
    let hash = state["hash"].as_str().expect("existing file has a hash").to_string();

    let preview = server
        .preview(&json!({"kept": {"model": ["anthropic/claude-sonnet-5-5", "openai-codex/gpt-6-luna"], "thinking": "medium"}}))
        .expect("preview");
    let chain = preview["chains"]["kept"]["chain"].as_array().expect("ordered chain");
    assert_eq!(chain[0]["model"], "anthropic/claude-sonnet-5-5");
    assert_eq!(chain[1]["model"], "openai-codex/gpt-6-luna");
    assert_eq!(preview["chains"]["kept"]["effort"], "medium");
    assert!(server.preview(&json!("not an object")).is_err());

    let edit = json!({"added": {"model": ["anthropic/claude-haiku-5-5"], "thinking": "low"}});
    let ok = server.save(&edit, Some(&hash)).expect("save");
    assert_eq!(ok.status, 200, "{:?}", ok.body);
    let saved: serde_json::Value = serde_json::from_slice(&fs::read(&config).unwrap()).unwrap();
    assert_eq!(saved["models"]["aliases"]["added"]["thinking"], "low");

    let stale = server.save(&edit, Some(&hash)).expect("save");
    assert_eq!(stale.status, 409);

    let fresh = server.state().unwrap()["hash"].as_str().unwrap().to_string();
    let bad = json!({"kept": {"model": ["anthropic/claude-sonnet-5-5"], "thinking": "bogus"}});
    let rejected = server.save(&bad, Some(&fresh)).expect("save");
    assert_eq!(rejected.status, 422, "{:?}", rejected.body);
    assert!(rejected.body["errors"].is_array());
    let _ = fs::remove_dir_all(&dir);
}
