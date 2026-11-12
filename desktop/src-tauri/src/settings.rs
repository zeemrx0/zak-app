//! Runner for `z-delegate settings`, the installed one-shot model settings commands.
//!
//! The app never writes `agents.json` itself. Each request spawns `node z-delegate.cjs settings <cmd>`, writes
//! one JSON object to its stdin and reads one JSON object from its stdout, so the kit's own scripts stay the
//! only validator and resolver.

use crate::tools;
use serde_json::{json, Value};
use std::io::Write;
use std::path::PathBuf;
use std::process::Stdio;

/// Status and JSON body of a save: 200 saved, 409 stale file, 422 `{errors}`.
#[derive(Debug, Clone, serde::Serialize)]
pub struct ApiReply {
    pub status: u16,
    pub body: Value,
}

pub struct Runner {
    node: PathBuf,
    script: PathBuf,
    extra_env: Vec<(String, String)>,
}

impl Runner {
    /// Finds `node` and the installed `z-delegate.cjs`.
    pub fn discover() -> Result<Runner, String> {
        let node = tools::find_node().ok_or("node not found in your login-shell PATH")?;
        let script = tools::find_z_delegate().ok_or("z-delegate.cjs not found; install the kit with the z-delegation skill")?;
        Ok(Runner::new(node, script, Vec::new()))
    }

    /// `extra_env` is for tests (for example `Z_AGENTS_CONFIG`); the guard variables of a delegating parent
    /// are always removed.
    pub fn new(node: PathBuf, script: PathBuf, extra_env: Vec<(String, String)>) -> Runner {
        Runner { node, script, extra_env }
    }

    /// Runs `settings <sub>` with `input` on stdin. A non-zero exit becomes an error carrying the script's
    /// own `error` message when it printed one.
    fn call(&self, sub: &str, input: Option<&Value>) -> Result<Value, String> {
        let mut command = tools::command(&self.node);
        command
            .arg(&self.script)
            .args(["settings", sub])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        // `claude-project` / `codex-project` agent sources are read from the cwd; a Finder launch starts in `/`.
        if let Some(home) = tools::home_dir() {
            command.current_dir(home);
        }
        for (k, v) in &self.extra_env {
            command.env(k, v);
        }
        let mut child = command.spawn().map_err(|e| format!("cannot start z-delegate settings {sub}: {e}"))?;
        let payload = input.map(Value::to_string).unwrap_or_default();
        let mut stdin = child.stdin.take().ok_or("no stdin for z-delegate settings")?;
        // Written from a thread so a large payload cannot block against a full stdout pipe.
        let writer = std::thread::spawn(move || {
            let _ = stdin.write_all(payload.as_bytes());
        });
        let out = child.wait_with_output().map_err(|e| format!("z-delegate settings {sub} failed: {e}"))?;
        let _ = writer.join();
        parse_output(sub, out.status.code(), &out.stdout, &out.stderr)
    }

    /// `{agents, models, efforts, path, config, hash, error?}`; `hash` is null when the file is missing and
    /// `error` is set when the file is unusable.
    pub fn state(&self) -> Result<Value, String> {
        self.call("state", None)
    }

    /// `{chains}`: per agent `{effort, chain: [{model, ok, reasons?}]}` or `{error}`.
    pub fn preview(&self, rows: &Value) -> Result<Value, String> {
        self.call("preview", Some(&json!({ "rows": rows })))
    }

    /// 200 saved, 409 stale, 422 `{errors}`; the caller surfaces the reply as is.
    pub fn save(&self, edits: &Value, base_hash: Option<&str>) -> Result<ApiReply, String> {
        let mut body = self.call("save", Some(&json!({ "edits": edits, "baseHash": base_hash })))?;
        let status = body
            .get("status")
            .and_then(Value::as_u64)
            .and_then(|s| u16::try_from(s).ok())
            .ok_or("z-delegate settings save returned no status")?;
        if let Some(map) = body.as_object_mut() {
            map.remove("status");
        }
        Ok(ApiReply { status, body })
    }
}

fn parse_output(sub: &str, code: Option<i32>, stdout: &[u8], stderr: &[u8]) -> Result<Value, String> {
    let parsed = serde_json::from_slice::<Value>(stdout).ok();
    if code == Some(0) {
        return parsed.ok_or_else(|| format!("z-delegate settings {sub} printed no JSON"));
    }
    let message = parsed
        .as_ref()
        .and_then(|v| v.get("error"))
        .and_then(Value::as_str)
        .map(str::to_string)
        .unwrap_or_else(|| String::from_utf8_lossy(stderr).trim().to_string());
    let code = code.map_or_else(|| "a signal".to_string(), |c| format!("exit {c}"));
    Err(if message.is_empty() {
        format!("z-delegate settings {sub} failed ({code})")
    } else {
        format!("z-delegate settings {sub} failed ({code}): {message}")
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn zero_exit_returns_the_json_object() {
        let v = parse_output("state", Some(0), br#"{"hash":null}"#, b"").unwrap();
        assert!(v["hash"].is_null());
    }

    #[test]
    fn zero_exit_without_json_is_an_error() {
        assert!(parse_output("state", Some(0), b"hello", b"").is_err());
    }

    #[test]
    fn failure_reports_the_script_error_then_stderr() {
        let e = parse_output("preview", Some(2), br#"{"ok":false,"error":"rows must be an object"}"#, b"x").unwrap_err();
        assert!(e.contains("exit 2") && e.contains("rows must be an object"), "{e}");
        let e = parse_output("preview", Some(1), b"", b"boom\n").unwrap_err();
        assert!(e.contains("boom"), "{e}");
        assert!(parse_output("save", None, b"", b"").unwrap_err().contains("a signal"));
    }
}
