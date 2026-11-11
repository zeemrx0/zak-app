//! Discovery of the external tools the app drives: `zak`, `node` and the installed `z-delegate.cjs`.
//!
//! A GUI app on macOS does not inherit the shell PATH, and `node` usually comes from a version manager.
//! The PATH is read once from the user's login shell and handed to every child process.

use serde::Serialize;
use std::env;
use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::OnceLock;

/// Environment variables that make `z-delegate ui` refuse to start or change its behaviour.
pub const STRIPPED_ENV: &[&str] = &["Z_DELEGATE_DEPTH", "CLAUDECODE", "CODEX_THREAD_ID"];

pub fn home_dir() -> Option<PathBuf> {
    env::var_os("HOME").or_else(|| env::var_os("USERPROFILE")).map(PathBuf::from)
}

/// Variables that decide where kit and delegation files live. A Finder or Dock launch does not export them, so
/// they are read from the login shell once, the same way as `PATH`.
pub const LOGIN_ENV_KEYS: &[&str] = &["CLAUDE_CONFIG_DIR", "CODEX_HOME", "Z_AGENTS_CONFIG"];
const MARKER: &str = "ZAK_LOGIN_ENV";

#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct LoginEnv {
    pub path: Option<String>,
    pub vars: Vec<(String, String)>,
}

/// Parses the marker lines `ZAK_LOGIN_ENV <NAME>=<value>` printed by the login shell. Profile banners and
/// any other output are ignored. Empty values and unknown names are dropped.
pub fn parse_login_env(text: &str) -> LoginEnv {
    let mut env = LoginEnv::default();
    for line in text.lines() {
        let Some(rest) = line.strip_prefix(MARKER).and_then(|r| r.strip_prefix(' ')) else { continue };
        let Some((name, value)) = rest.split_once('=') else { continue };
        let value = value.trim();
        if value.is_empty() {
            continue;
        }
        if name == "PATH" {
            if value.contains('/') {
                env.path = Some(value.to_string());
            }
        } else if LOGIN_ENV_KEYS.contains(&name) {
            env.vars.push((name.to_string(), value.to_string()));
        }
    }
    env
}

fn login_shell_script() -> String {
    let mut script = format!("printf '\\n{MARKER} PATH=%s' \"$PATH\";");
    for key in LOGIN_ENV_KEYS {
        script.push_str(&format!(" printf '\\n{MARKER} {key}=%s' \"${{{key}}}\";"));
    }
    script.push_str(" printf '\\n'");
    script
}

/// Runs the shell script with `flags` and returns its stdout, or `None` on failure or after `timeout`.
fn run_shell(shell: &str, flags: &str, timeout: std::time::Duration) -> Option<String> {
    use std::io::Read;
    let mut child = Command::new(shell)
        .args([flags, &login_shell_script()])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;
    let mut stdout = child.stdout.take()?;
    let reader = std::thread::spawn(move || {
        let mut s = String::new();
        let _ = stdout.read_to_string(&mut s);
        s
    });
    let deadline = std::time::Instant::now() + timeout;
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                let out = reader.join().ok()?;
                return status.success().then_some(out);
            }
            Ok(None) if std::time::Instant::now() < deadline => std::thread::sleep(std::time::Duration::from_millis(20)),
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                return None;
            }
        }
    }
}

/// Interactive login shell first, because version managers such as fnm and nvm add `node` to PATH only in
/// the rc file (`~/.zshrc`), which a non-interactive login shell skips. Falls back to a plain login shell when
/// the interactive one fails, hangs or prints no PATH.
fn read_login_env() -> LoginEnv {
    let shell = env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".into());
    for flags in ["-ilc", "-lc"] {
        if let Some(out) = run_shell(&shell, flags, std::time::Duration::from_secs(5)) {
            let parsed = parse_login_env(&out);
            if parsed.path.is_some() {
                return parsed;
            }
        }
    }
    LoginEnv::default()
}

fn login_env() -> &'static LoginEnv {
    static ENV: OnceLock<LoginEnv> = OnceLock::new();
    ENV.get_or_init(read_login_env)
}

/// The app's own value when set and non-empty, else the login shell's.
pub fn env_value(key: &str) -> Option<OsString> {
    env::var_os(key)
        .filter(|v| !v.is_empty())
        .or_else(|| login_env().vars.iter().find(|(k, _)| k == key).map(|(_, v)| OsString::from(v)))
}

/// PATH used for every child process: login-shell PATH, then the inherited PATH, then `~/.local/bin`.
pub fn child_path() -> &'static str {
    static PATH: OnceLock<String> = OnceLock::new();
    PATH.get_or_init(|| {
        let mut parts: Vec<String> = Vec::new();
        if let Some(p) = &login_env().path {
            parts.push(p.clone());
        }
        if let Ok(p) = env::var("PATH") {
            parts.push(p);
        }
        if let Some(h) = home_dir() {
            parts.push(h.join(".local/bin").to_string_lossy().into_owned());
        }
        parts.join(":")
    })
}

fn is_executable(p: &Path) -> bool {
    use std::os::unix::fs::PermissionsExt;
    p.metadata().map(|m| m.is_file() && m.permissions().mode() & 0o111 != 0).unwrap_or(false)
}

/// First executable named `name` in the colon-separated `path`.
pub fn find_in_path(name: &str, path: &str) -> Option<PathBuf> {
    path.split(':')
        .filter(|d| !d.is_empty())
        .map(|d| Path::new(d).join(name))
        .find(|c| is_executable(c))
}

pub fn find_zak() -> Option<PathBuf> {
    find_in_path("zak", child_path())
}

pub fn find_node() -> Option<PathBuf> {
    find_in_path("node", child_path())
}

/// Locations searched for `z-delegate.cjs`, in order: Claude Code (`CLAUDE_CONFIG_DIR` or `~/.claude`), then
/// Codex (`CODEX_HOME` or `~/.codex`).
pub fn z_delegate_candidates(home: &Path, claude_dir: Option<&Path>, codex_dir: Option<&Path>) -> Vec<PathBuf> {
    let rel = "skills/z-delegation/scripts/z-delegate.cjs";
    let claude = claude_dir.map(Path::to_path_buf).unwrap_or_else(|| home.join(".claude"));
    let codex = codex_dir.map(Path::to_path_buf).unwrap_or_else(|| home.join(".codex"));
    vec![claude.join(rel), codex.join(rel)]
}

pub fn find_z_delegate() -> Option<PathBuf> {
    let home = home_dir()?;
    let claude = env_value("CLAUDE_CONFIG_DIR").map(PathBuf::from);
    let codex = env_value("CODEX_HOME").map(PathBuf::from);
    z_delegate_candidates(&home, claude.as_deref(), codex.as_deref()).into_iter().find(|p| p.is_file())
}

/// A command with the login PATH, the login-shell location variables the app itself lacks, no stdin and
/// without the delegation guard variables.
pub fn command(program: &Path) -> Command {
    let mut cmd = Command::new(program);
    cmd.env("PATH", child_path()).stdin(Stdio::null());
    for key in LOGIN_ENV_KEYS {
        if let Some(v) = env_value(key) {
            cmd.env(key, v);
        }
    }
    for key in STRIPPED_ENV {
        cmd.env_remove(key);
    }
    cmd
}

pub fn version_of(program: &Path, flag: &str) -> Option<String> {
    let out = command(program).arg(flag).output().ok()?;
    let text = String::from_utf8_lossy(&out.stdout).trim().to_string();
    (out.status.success() && !text.is_empty()).then(|| text.lines().next().unwrap_or("").to_string())
}

/// First line of `zak --version`, or `None` when zak is not found or fails.
pub fn zak_version() -> Option<String> {
    version_of(&find_zak()?, "--version")
}

/// Oldest Node the zak CLI supports.
pub const MIN_NODE: [u64; 3] = [26, 11, 1];

/// True when `text` (`v26.11.1`, `26.11.1`) is at least `MIN_NODE`. Anything unparsable is not ok.
pub fn node_version_ok(text: &str) -> bool {
    let core = text.trim().trim_start_matches('v').split(['-', '+']).next().unwrap_or("");
    let parts: Vec<u64> = core.split('.').map_while(|p| p.parse().ok()).collect();
    parts.len() == 3 && parts[..] >= MIN_NODE[..]
}

/// Path of the active delegation config: `Z_AGENTS_CONFIG` or `~/.zak/agents.json`.
pub fn current_config_path() -> Option<PathBuf> {
    match env_value("Z_AGENTS_CONFIG") {
        Some(p) => Some(PathBuf::from(p)),
        None => home_dir().map(|h| h.join(".zak/agents.json")),
    }
}

#[derive(Serialize)]
pub struct ToolInfo {
    pub path: Option<String>,
    pub version: Option<String>,
}

#[derive(Serialize)]
pub struct FileInfo {
    pub path: Option<String>,
    pub exists: bool,
}

#[derive(Serialize)]
pub struct ToolStatus {
    pub zak: ToolInfo,
    pub node: ToolInfo,
    /// Node is installed and at least `MIN_NODE`.
    pub node_ok: bool,
    pub z_delegate: ToolInfo,
    pub current_config: FileInfo,
}

fn tool(path: Option<PathBuf>, version_flag: Option<&str>) -> ToolInfo {
    let version = match (&path, version_flag) {
        (Some(p), Some(f)) => version_of(p, f),
        _ => None,
    };
    ToolInfo { path: path.map(|p| p.to_string_lossy().into_owned()), version }
}

fn file(path: Option<PathBuf>) -> FileInfo {
    FileInfo {
        exists: path.as_deref().map(Path::is_file).unwrap_or(false),
        path: path.map(|p| p.to_string_lossy().into_owned()),
    }
}

pub fn status() -> ToolStatus {
    let node = tool(find_node(), Some("--version"));
    ToolStatus {
        zak: tool(find_zak(), Some("--version")),
        node_ok: node.version.as_deref().is_some_and(node_version_ok),
        node,
        z_delegate: tool(find_z_delegate(), None),
        current_config: file(current_config_path()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn candidates_prefer_claude_then_codex_dirs() {
        let c = z_delegate_candidates(Path::new("/h"), Some(Path::new("/cc")), Some(Path::new("/cx")));
        assert_eq!(c[0], Path::new("/cc/skills/z-delegation/scripts/z-delegate.cjs"));
        assert_eq!(c[1], Path::new("/cx/skills/z-delegation/scripts/z-delegate.cjs"));
    }

    #[test]
    fn candidates_default_dirs() {
        let c = z_delegate_candidates(Path::new("/h"), None, None);
        assert_eq!(c[0], Path::new("/h/.claude/skills/z-delegation/scripts/z-delegate.cjs"));
        assert_eq!(c[1], Path::new("/h/.codex/skills/z-delegation/scripts/z-delegate.cjs"));
    }

    #[test]
    fn parses_login_env_and_ignores_banners() {
        let out = "Welcome back\nlast login: now\nZAK_LOGIN_ENV PATH=/a/bin:/b/bin\nZAK_LOGIN_ENV CLAUDE_CONFIG_DIR=/cc dir\nZAK_LOGIN_ENV CODEX_HOME=\nZAK_LOGIN_ENV Z_AGENTS_CONFIG=/x/agents.json\nZAK_LOGIN_ENV EVIL=1\nZAK_LOGIN_ENVPATH=/no\n";
        let e = parse_login_env(out);
        assert_eq!(e.path.as_deref(), Some("/a/bin:/b/bin"));
        assert_eq!(
            e.vars,
            [("CLAUDE_CONFIG_DIR".to_string(), "/cc dir".to_string()), ("Z_AGENTS_CONFIG".to_string(), "/x/agents.json".to_string())]
        );
    }

    #[test]
    fn login_env_rejects_pathless_and_empty_output() {
        assert_eq!(parse_login_env(""), LoginEnv::default());
        assert_eq!(parse_login_env("ZAK_LOGIN_ENV PATH=nothing-here\n").path, None);
    }

    #[test]
    fn login_script_prints_every_key() {
        let s = login_shell_script();
        assert!(s.contains("ZAK_LOGIN_ENV PATH=%s"));
        for k in LOGIN_ENV_KEYS {
            assert!(s.contains(&format!("ZAK_LOGIN_ENV {k}=%s")), "{k}");
        }
    }

    #[test]
    fn node_version_comparison() {
        for ok in ["v26.11.1", "26.11.1", "v26.11.2\n", "v26.12.0", "v27.0.0", "v100.0.0", "v26.11.1-nightly"] {
            assert!(node_version_ok(ok), "{ok}");
        }
        for bad in ["v26.11.0", "v26.10.9", "v25.99.99", "v9.0.0", "v26.11", "node", "", "v26.11.x"] {
            assert!(!node_version_ok(bad), "{bad}");
        }
    }

    #[test]
    fn find_in_path_skips_missing_and_empty_entries() {
        assert!(find_in_path("definitely-not-a-real-binary", "::/nonexistent").is_none());
        assert!(find_in_path("sh", "/nonexistent:/bin").is_some());
    }
}
