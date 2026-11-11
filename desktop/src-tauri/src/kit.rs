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
    pub scope: Scope,
    /// Required, so a malformed request can never become a real run by omission.
    pub dry_run: bool,
    pub channel: Option<String>,
}

const TARGETS: &[&str] = &["claude", "codex"];

fn valid_tier(t: &str) -> bool {
    t.starts_with(|c: char| c.is_ascii_alphanumeric())
        && t.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
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
    let mut argv = vec!["kit".to_string(), req.action.as_str().to_string(), "--target".into(), targets.join(",")];
    match &req.scope {
        Scope::Global => {
            if req.tiers.is_empty() {
                return Err("global scope needs at least one tier".into());
            }
            if !req.no_tiers.is_empty() {
                return Err("global scope takes an exact tier list; no_tiers applies to projects only".into());
            }
            argv.push("--global".into());
        }
        Scope::Project(path) => {
            let path = path.trim();
            if path.is_empty() {
                return Err("project scope needs a folder path".into());
            }
            if path.starts_with('-') {
                return Err("project path must not start with '-'".into());
            }
            argv.push(path.to_string());
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
    if let Some(ch) = req.channel.as_deref().filter(|c| !c.is_empty()) {
        if !matches!(ch, "stable" | "beta") {
            return Err(format!("invalid channel: {ch}"));
        }
        if matches!(req.action, Action::Install | Action::Update) {
            argv.push("--channel".into());
            argv.push(ch.into());
        }
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

/// `zak kit source` with no argument prints the current source when stdin is not a TTY.
pub fn source_get() -> Result<String, String> {
    let r = run_zak(vec!["kit".into(), "source".into()])?;
    if r.exit_code == Some(0) {
        Ok(r.stdout.trim().to_string())
    } else {
        Err(error_text(&r))
    }
}

/// `choice` is `public`, `private`, or `local:<folder>`.
pub fn source_args(choice: &str) -> Result<Vec<String>, String> {
    let mut argv = vec!["kit".to_string(), "source".to_string()];
    match choice.split_once(':') {
        None if matches!(choice, "public" | "private") => argv.push(choice.into()),
        Some(("local", path)) if !path.trim().is_empty() && !path.trim().starts_with('-') => {
            argv.push("local".into());
            argv.push(path.trim().into());
        }
        _ => return Err("source must be public, private or local:<folder>".into()),
    }
    Ok(argv)
}

pub fn source_set(choice: &str) -> Result<String, String> {
    let r = run_zak(source_args(choice)?)?;
    if r.exit_code == Some(0) {
        Ok(r.stdout.trim().to_string())
    } else {
        Err(error_text(&r))
    }
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
            scope,
            dry_run: false,
            channel: None,
        }
    }

    #[test]
    fn global_check_argv() {
        let argv = build_argv(&req(Action::Check, Scope::Global)).unwrap();
        assert_eq!(argv, ["kit", "check", "--target", "claude,codex", "--global", "--tier", "general,unity", "--json"]);
    }

    #[test]
    fn project_dry_run_install_with_channel() {
        let mut r = req(Action::Install, Scope::Project("/work/app".into()));
        r.dry_run = true;
        r.channel = Some("beta".into());
        let argv = build_argv(&r).unwrap();
        assert_eq!(
            argv,
            ["kit", "install", "--target", "claude,codex", "/work/app", "--tier", "general,unity", "--channel", "beta", "--dry-run", "--json"]
        );
    }

    #[test]
    fn check_never_gets_dry_run_and_uninstall_ignores_channel() {
        let mut r = req(Action::Check, Scope::Global);
        r.dry_run = true;
        assert!(!build_argv(&r).unwrap().contains(&"--dry-run".to_string()));
        let mut u = req(Action::Uninstall, Scope::Global);
        u.channel = Some("stable".into());
        assert!(!build_argv(&u).unwrap().contains(&"--channel".to_string()));
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
        let mut r = req(Action::Update, Scope::Global);
        r.tiers.clear();
        assert!(build_argv(&r).is_err());
        r.tiers = vec!["--force".into()];
        assert!(build_argv(&r).is_err());
        assert!(build_argv(&req(Action::Check, Scope::Project("--global".into()))).is_err());
        assert!(build_argv(&req(Action::Check, Scope::Project("  ".into()))).is_err());
        let mut r = req(Action::Install, Scope::Global);
        r.channel = Some("nightly".into());
        assert!(build_argv(&r).is_err());
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
    fn source_choices() {
        assert_eq!(source_args("public").unwrap(), ["kit", "source", "public"]);
        assert_eq!(source_args("local:/a b").unwrap(), ["kit", "source", "local", "/a b"]);
        assert!(source_args("local:").is_err());
        assert!(source_args("local:--x").is_err());
        assert!(source_args("weird").is_err());
    }
}
