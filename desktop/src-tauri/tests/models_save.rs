//! Runs the real installed `z-delegate ui` server against a temporary config (`Z_AGENTS_CONFIG`) and checks
//! state, preview and save: 200 on a fresh hash, 409 on a stale hash, 422 on an invalid edit.
//! The test skips with a message when node or z-delegate.cjs is not installed.

use serde_json::json;
use std::fs;
use std::os::unix::fs::PermissionsExt;
use zak_desktop_lib::server::Server;
use zak_desktop_lib::tools;

#[test]
fn state_preview_and_save_statuses() {
    let (Some(node), Some(script)) = (tools::find_node(), tools::find_z_delegate()) else {
        eprintln!("skipped: node or z-delegate.cjs is not installed");
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
    let mut server = Server::start(&node, &script, &env).expect("server starts");

    let state = server.state().expect("state");
    assert_eq!(state["path"], config.to_string_lossy().as_ref());
    assert!(state["agents"].is_array() && state["models"].is_array() && state["efforts"].is_array());
    let hash = state["hash"].as_str().expect("existing file has a hash").to_string();

    let preview = server.preview(&json!({"kept": {"model": ["anthropic/claude-sonnet-5-5"], "thinking": "medium"}})).expect("preview");
    assert!(preview["routes"]["kept"].is_object());
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

    server.shutdown();
    assert!(!server.is_running(), "server must stop after shutdown");
    let _ = fs::remove_dir_all(&dir);
}
