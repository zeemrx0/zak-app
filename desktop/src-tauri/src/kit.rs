//! `zak kit ...` invocation: a pure argv builder plus the process runner.

use crate::tools;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::process::Stdio;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Action {
    Check,
    Install,
    Update,
    Uninstall,
}

impl Action {
    fn as_str(self) -> &'static str {
        match self {
            Action::Check => "check",
            Action::Install => "install",
            Action::Update => "update",
            Action::Uninstall => "uninstall",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(tag = "kind", content = "path", rename_all = "lowercase")]
pub enum Scope {
    Global,
    Project(String),
}

#[derive(Debug, Clone, Deserialize)]
pub struct KitRequest {
    pub action: Action,
    pub targets: Vec<String>,
    pub tiers: Vec<String>,
    /// Project scope only: tiers the kit would add by default (general, detected) that must be removed.
    #[serde(default)]
    pub no_tiers: Vec<String>,
    /// Item IDs (`tier/kind/name`). Install and update only; excludes `tiers` and `no_tiers`.
    #[serde(default)]
    pub select: Vec<String>,
    /// Host whose selection this host copies and keeps following. One target, install and update only.
    #[serde(default)]
    pub follow: Option<String>,
    /// Stops following and keeps the installed files. Install and update only.
    #[serde(default)]
    pub no_follow: bool,
    pub scope: Scope,
    /// Required, so a malformed request can never become a real run by omission.
    pub dry_run: bool,
}

const TARGETS: &[&str] = &["claude", "codex"];

fn valid_tier(t: &str) -> bool {
    t.starts_with(|c: char| c.is_ascii_alphanumeric())
        && t.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

const KINDS: &[&str] = &["skills", "rules", "agents"];

/// `tier/kind/name`: a valid tier, `skills|rules|agents`, and a `z-` name of `[a-z0-9-]` with an optional `.md`.
fn valid_item(id: &str) -> bool {
    let parts: Vec<&str> = id.split('/').collect();
    let [tier, kind, name] = parts[..] else { return false };
    let stem = name.strip_suffix(".md").unwrap_or(name);
    valid_tier(tier)
        && KINDS.contains(&kind)
        && stem.starts_with("z-")
        && stem.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
}

fn project_path(path: &str) -> Result<&str, String> {
    let path = path.trim();
    if path.is_empty() {
        return Err("project scope needs a folder path".into());
    }
    if path.starts_with('-') {
        return Err("project path must not start with '-'".into());
    }
    Ok(path)
}

/// Builds the arguments after the `zak` program name. Always non-interactive: explicit targets, `--json`,
/// and tiers whenever the CLI needs them (global scope).
pub fn build_argv(req: &KitRequest) -> Result<Vec<String>, String> {
    if req.targets.is_empty() {
        return Err("select at least one target".into());
    }
    let mut targets: Vec<&str> = Vec::new();
    for t in &req.targets {
        if !TARGETS.contains(&t.as_str()) {
            return Err(format!("unknown target: {t}"));
        }
        if !targets.contains(&t.as_str()) {
            targets.push(t);
        }
    }
    if let Some(bad) = req.tiers.iter().find(|t| !valid_tier(t)) {
        return Err(format!("invalid tier name: {bad:?}"));
    }
    if let Some(bad) = req.no_tiers.iter().find(|t| !valid_tier(t)) {
        return Err(format!("invalid tier name: {bad:?}"));
    }
    let applies = matches!(req.action, Action::Install | Action::Update);
    if let Some(bad) = req.select.iter().find(|id| !valid_item(id)) {
        return Err(format!("invalid item id: {bad:?}"));
    }
    if !req.select.is_empty() {
        if !applies {
            return Err("select applies to install and update only".into());
        }
        if !req.tiers.is_empty() || !req.no_tiers.is_empty() {
            return Err("select cannot be combined with tiers or no_tiers".into());
        }
    }
    if req.follow.is_some() || req.no_follow {
        if !applies {
            return Err("follow and no_follow apply to install and update only".into());
        }
        if req.follow.is_some() && req.no_follow {
            return Err("follow and no_follow exclude each other".into());
        }
    }
    if let Some(source) = &req.follow {
        if !TARGETS.contains(&source.as_str()) {
            return Err(format!("unknown follow host: {source}"));
        }
        if targets.len() != 1 {
            return Err("follow needs exactly one target".into());
        }
        if targets[0] == source {
            return Err("a host cannot follow itself".into());
        }
    }
    let mut argv = vec!["kit".to_string(), req.action.as_str().to_string(), "--target".into(), targets.join(",")];
    match &req.scope {
        Scope::Global => {
            if req.action == Action::Install && req.tiers.is_empty() && req.select.is_empty() {
                return Err("global install needs at least one tier or item".into());
            }
            if !req.no_tiers.is_empty() {
                return Err("global scope takes an exact tier list; no_tiers applies to projects only".into());
            }
            argv.push("--global".into());
        }
        Scope::Project(path) => {
            argv.push(project_path(path)?.to_string());
        }
    }
    if !req.tiers.is_empty() {
        argv.push("--tier".into());
        argv.push(req.tiers.join(","));
    }
    if !req.no_tiers.is_empty() {
        argv.push("--no-tier".into());
        argv.push(req.no_tiers.join(","));
    }
    if !req.select.is_empty() {
        argv.push("--select".into());
        argv.push(req.select.join(","));
    }
    if let Some(source) = &req.follow {
        argv.push("--follow".into());
        argv.push(source.clone());
    }
    if req.no_follow {
        argv.push("--no-follow".into());
    }
    if req.dry_run && req.action != Action::Check {
        argv.push("--dry-run".into());
    }
    argv.push("--json".into());
    Ok(argv)
}

/// `zak kit ... --json` prints one pretty JSON object per target, back to back.
pub fn parse_json_stream(stdout: &str) -> Result<Vec<Value>, String> {
    serde_json::Deserializer::from_str(stdout)
        .into_iter::<Value>()
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

#[derive(Serialize)]
pub struct RunResult {
    pub exit_code: Option<i32>,
    pub argv: Vec<String>,
    /// Parsed JSON objects (one per target) when stdout was JSON.
    pub reports: Option<Vec<Value>>,
    pub stdout: String,
    pub stderr: String,
}

fn run_zak(argv: Vec<String>) -> Result<RunResult, String> {
    let zak = tools::find_zak().ok_or("zak CLI not found; install it or add it to your login-shell PATH")?;
    let out = tools::command(&zak)
        .args(&argv)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .map_err(|e| format!("cannot run zak: {e}"))?;
    let stdout = String::from_utf8_lossy(&out.stdout).into_owned();
    let reports = parse_json_stream(&stdout).ok().filter(|v| !v.is_empty());
    Ok(RunResult {
        exit_code: out.status.code(),
        argv,
        reports,
        stdout,
        stderr: String::from_utf8_lossy(&out.stderr).into_owned(),
    })
}

pub fn run(req: &KitRequest) -> Result<RunResult, String> {
    run_zak(build_argv(req)?)
}

/// `zak kit source` with no argument prints `Kit source: <path>` or `Kit source: not set` when stdin is not a TTY.
pub fn source_get() -> Result<String, String> {
    let r = run_zak(vec!["kit".into(), "source".into()])?;
    if r.exit_code == Some(0) {
        Ok(r.stdout.trim().to_string())
    } else {
        Err(error_text(&r))
    }
}

/// `path` is the local kit folder.
pub fn source_args(path: &str) -> Result<Vec<String>, String> {
    let path = path.trim();
    if path.is_empty() || path.starts_with('-') {
        return Err("choose a kit folder".into());
    }
    Ok(vec!["kit".into(), "source".into(), path.into()])
}

pub fn source_set(path: &str) -> Result<String, String> {
    let r = run_zak(source_args(path)?)?;
    if r.exit_code == Some(0) {
        Ok(r.stdout.trim().to_string())
    } else {
        Err(error_text(&r))
    }
}

/// Arguments of `zak kit inventory` for both hosts in one scope.
pub fn inventory_argv(scope: &Scope) -> Result<Vec<String>, String> {
    let place = match scope {
        Scope::Global => "--global".to_string(),
        Scope::Project(path) => project_path(path)?.to_string(),
    };
    Ok(["kit", "inventory", "--target", "claude,codex"].map(String::from).into_iter().chain([place, "--json".into()]).collect())
}

/// Items, requirements, digest and per-host selection from the local kit source, as the kit prints them.
pub fn inventory(scope: &Scope) -> Result<Value, String> {
    let r = run_zak(inventory_argv(scope)?)?;
    if r.exit_code != Some(0) {
        return Err(error_text(&r));
    }
    serde_json::from_str(&r.stdout).map_err(|e| format!("kit inventory returned invalid JSON: {e}"))
}

fn error_text(r: &RunResult) -> String {
    let e = r.stderr.trim();
    if e.is_empty() {
        r.stdout.trim().to_string()
    } else {
        e.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn req(action: Action, scope: Scope) -> KitRequest {
        KitRequest {
            action,
            targets: vec!["claude".into(), "codex".into()],
            tiers: vec!["general".into(), "unity".into()],
            no_tiers: vec![],
            select: vec![],
            follow: None,
            no_follow: false,
            scope,
            dry_run: false,
        }
    }

    #[test]
    fn global_check_argv() {
        let argv = build_argv(&req(Action::Check, Scope::Global)).unwrap();
        assert_eq!(argv, ["kit", "check", "--target", "claude,codex", "--global", "--tier", "general,unity", "--json"]);
    }

    #[test]
    fn project_dry_run_install() {
        let mut r = req(Action::Install, Scope::Project("/work/app".into()));
        r.dry_run = true;
        let argv = build_argv(&r).unwrap();
        assert_eq!(
            argv,
            ["kit", "install", "--target", "claude,codex", "/work/app", "--tier", "general,unity", "--dry-run", "--json"]
        );
    }

    #[test]
    fn check_never_gets_dry_run() {
        let mut r = req(Action::Check, Scope::Global);
        r.dry_run = true;
        assert!(!build_argv(&r).unwrap().contains(&"--dry-run".to_string()));
    }

    #[test]
    fn project_scope_without_tiers_omits_tier_flag() {
        let mut r = req(Action::Check, Scope::Project("/p".into()));
        r.tiers.clear();
        assert!(!build_argv(&r).unwrap().contains(&"--tier".to_string()));
    }

    #[test]
    fn project_no_tiers_become_no_tier_flag() {
        let mut r = req(Action::Update, Scope::Project("/p".into()));
        r.no_tiers = vec!["luna".into(), "web".into()];
        let argv = build_argv(&r).unwrap();
        assert_eq!(
            argv,
            ["kit", "update", "--target", "claude,codex", "/p", "--tier", "general,unity", "--no-tier", "luna,web", "--json"]
        );
        r.tiers.clear();
        let argv = build_argv(&r).unwrap();
        assert!(!argv.contains(&"--tier".to_string()));
        assert!(argv.windows(2).any(|w| w == ["--no-tier", "luna,web"]));
    }

    #[test]
    fn no_tiers_are_validated_and_rejected_for_global() {
        let mut r = req(Action::Update, Scope::Project("/p".into()));
        r.no_tiers = vec!["--force".into()];
        assert!(build_argv(&r).is_err());
        r.no_tiers = vec!["a;b".into()];
        assert!(build_argv(&r).is_err());
        let mut g = req(Action::Update, Scope::Global);
        g.no_tiers = vec!["luna".into()];
        assert!(build_argv(&g).unwrap_err().contains("projects only"));
    }

    #[test]
    fn rejects_unsafe_or_incomplete_input() {
        let mut r = req(Action::Update, Scope::Global);
        r.targets = vec![];
        assert!(build_argv(&r).is_err());
        r.targets = vec!["claude;rm".into()];
        assert!(build_argv(&r).is_err());
        let mut r = req(Action::Install, Scope::Global);
        r.tiers.clear();
        assert!(build_argv(&r).is_err());
        r.tiers = vec!["--force".into()];
        assert!(build_argv(&r).is_err());
        assert!(build_argv(&req(Action::Check, Scope::Project("--global".into()))).is_err());
        assert!(build_argv(&req(Action::Check, Scope::Project("  ".into()))).is_err());
    }

    #[test]
    fn duplicate_targets_collapse() {
        let mut r = req(Action::Check, Scope::Global);
        r.targets = vec!["claude".into(), "claude".into()];
        assert_eq!(build_argv(&r).unwrap()[3], "claude");
    }

    #[test]
    fn request_deserializes_from_ui_shape() {
        let r: KitRequest = serde_json::from_str(
            r#"{"action":"update","targets":["claude"],"tiers":["general"],"scope":{"kind":"project","path":"/p"},"dry_run":true}"#,
        )
        .unwrap();
        assert_eq!(r.scope, Scope::Project("/p".into()));
        assert!(r.no_tiers.is_empty());
        let g: KitRequest = serde_json::from_str(
            r#"{"action":"check","targets":["codex"],"tiers":[],"no_tiers":["x"],"scope":{"kind":"global"},"dry_run":false}"#,
        )
        .unwrap();
        assert_eq!(g.scope, Scope::Global);
        assert_eq!(g.no_tiers, ["x"]);
    }

    #[test]
    fn dry_run_is_required() {
        let missing = serde_json::from_str::<KitRequest>(r#"{"action":"update","targets":["claude"],"tiers":["general"],"scope":{"kind":"global"}}"#);
        assert!(missing.is_err());
    }

    #[test]
    fn parses_concatenated_json_objects() {
        let v = parse_json_stream("{\n \"target\": \"claude\"\n}\n{\n \"target\": \"codex\"\n}\n").unwrap();
        assert_eq!(v.len(), 2);
        assert_eq!(v[1]["target"], "codex");
        assert!(parse_json_stream("not json").is_err());
    }

    #[test]
    fn source_path() {
        assert_eq!(source_args("/a b").unwrap(), ["kit", "source", "/a b"]);
        assert_eq!(source_args("  /kit ").unwrap(), ["kit", "source", "/kit"]);
        assert!(source_args("").is_err());
        assert!(source_args("   ").is_err());
        assert!(source_args("--x").is_err());
    }

    const ID_A: &str = "general/skills/z-ste";
    const ID_B: &str = "unity/rules/z-unity-core.md";

    fn selecting(action: Action, scope: Scope, ids: &[&str]) -> KitRequest {
        let mut r = req(action, scope);
        r.tiers.clear();
        r.select = ids.iter().map(|s| s.to_string()).collect();
        r
    }

    #[test]
    fn select_becomes_one_ordered_flag() {
        let r = selecting(Action::Update, Scope::Project("/p".into()), &[ID_B, ID_A]);
        assert_eq!(
            build_argv(&r).unwrap(),
            ["kit", "update", "--target", "claude,codex", "/p", "--select", "unity/rules/z-unity-core.md,general/skills/z-ste", "--json"]
        );
    }

    #[test]
    fn select_with_tiers_or_no_tiers_is_rejected() {
        let mut r = selecting(Action::Install, Scope::Global, &[ID_A]);
        r.tiers = vec!["general".into()];
        assert!(build_argv(&r).unwrap_err().contains("cannot be combined"));
        let mut r = selecting(Action::Update, Scope::Project("/p".into()), &[ID_A]);
        r.no_tiers = vec!["luna".into()];
        assert!(build_argv(&r).is_err());
    }

    #[test]
    fn select_is_for_install_and_update_only() {
        for action in [Action::Check, Action::Uninstall] {
            assert!(build_argv(&selecting(action, Scope::Global, &[ID_A])).is_err());
        }
    }

    #[test]
    fn bad_item_ids_are_rejected() {
        for bad in [
            "",
            "general",
            "general/skills",
            "general/skills/z-a/extra",
            "general/tools/z-a",
            "general/skills/ste",
            "general/skills/z-A",
            "general/skills/z-a b",
            "general/skills/z-a.txt",
            "-general/skills/z-a",
            "gen eral/skills/z-a",
            "--force",
        ] {
            let r = selecting(Action::Update, Scope::Project("/p".into()), &[ID_A, bad]);
            assert!(build_argv(&r).is_err(), "{bad:?} must be rejected");
        }
    }

    #[test]
    fn follow_argv_and_no_follow_argv() {
        let mut r = req(Action::Install, Scope::Project("/p".into()));
        r.targets = vec!["codex".into()];
        r.tiers.clear();
        r.follow = Some("claude".into());
        assert_eq!(
            build_argv(&r).unwrap(),
            ["kit", "install", "--target", "codex", "/p", "--follow", "claude", "--json"]
        );
        r.follow = None;
        r.no_follow = true;
        r.action = Action::Update;
        assert_eq!(
            build_argv(&r).unwrap(),
            ["kit", "update", "--target", "codex", "/p", "--no-follow", "--json"]
        );
    }

    #[test]
    fn follow_may_carry_the_source_tiers() {
        let mut r = req(Action::Install, Scope::Global);
        r.targets = vec!["codex".into()];
        r.tiers = vec!["general".into(), "unity".into()];
        r.follow = Some("claude".into());
        assert_eq!(
            build_argv(&r).unwrap(),
            ["kit", "install", "--target", "codex", "--global", "--tier", "general,unity", "--follow", "claude", "--json"]
        );
    }

    #[test]
    fn follow_rules() {
        let mut r = req(Action::Update, Scope::Project("/p".into()));
        r.tiers.clear();
        r.follow = Some("claude".into());
        assert!(build_argv(&r).unwrap_err().contains("exactly one target"));
        r.targets = vec!["claude".into()];
        assert!(build_argv(&r).unwrap_err().contains("itself"));
        r.targets = vec!["codex".into()];
        r.follow = Some("omp".into());
        assert!(build_argv(&r).is_err());
        r.follow = Some("claude".into());
        r.no_follow = true;
        assert!(build_argv(&r).unwrap_err().contains("exclude each other"));
        r.no_follow = false;
        r.action = Action::Check;
        assert!(build_argv(&r).is_err());
        r.follow = None;
        r.no_follow = true;
        r.action = Action::Uninstall;
        assert!(build_argv(&r).is_err());
    }

    #[test]
    fn global_scope_tiers_are_required_for_install_only() {
        for action in [Action::Check, Action::Update, Action::Uninstall] {
            let mut r = req(action, Scope::Global);
            r.tiers.clear();
            assert_eq!(
                build_argv(&r).unwrap(),
                ["kit", action.as_str(), "--target", "claude,codex", "--global", "--json"]
            );
        }
        let mut r = req(Action::Install, Scope::Global);
        r.tiers.clear();
        assert!(build_argv(&r).is_err());
        assert!(build_argv(&selecting(Action::Install, Scope::Global, &[ID_A])).is_ok());
    }

    #[test]
    fn request_defaults_for_the_new_fields() {
        let r: KitRequest = serde_json::from_str(
            r#"{"action":"update","targets":["codex"],"tiers":[],"select":["general/skills/z-ste"],"follow":"claude","scope":{"kind":"global"},"dry_run":false}"#,
        )
        .unwrap();
        assert_eq!(r.select, ["general/skills/z-ste"]);
        assert_eq!(r.follow.as_deref(), Some("claude"));
        assert!(!r.no_follow);
        let old: KitRequest =
            serde_json::from_str(r#"{"action":"update","targets":["claude"],"tiers":["general"],"scope":{"kind":"global"},"dry_run":true}"#).unwrap();
        assert!(old.select.is_empty() && old.follow.is_none() && !old.no_follow);
    }

    #[test]
    fn inventory_argv_for_both_scopes() {
        assert_eq!(
            inventory_argv(&Scope::Global).unwrap(),
            ["kit", "inventory", "--target", "claude,codex", "--global", "--json"]
        );
        assert_eq!(
            inventory_argv(&Scope::Project(" /work/app ".into())).unwrap(),
            ["kit", "inventory", "--target", "claude,codex", "/work/app", "--json"]
        );
        assert!(inventory_argv(&Scope::Project("".into())).is_err());
        assert!(inventory_argv(&Scope::Project("--global".into())).is_err());
    }
}
