//! Lifecycle and HTTP client for `z-delegate ui`, the installed local settings server.
//!
//! The app never writes `agents.json` itself. Every save goes through `POST /api/save` with the base hash
//! and the per-run token, so the kit's own validator stays the only validator.

use crate::tools;
use serde_json::{json, Value};
use std::io::{BufRead, BufReader, Read};
use std::path::Path;
use std::process::{Child, Stdio};
use std::sync::{mpsc, Mutex};
use std::time::{Duration, Instant};

const URL_PREFIX: &str = "z-delegate ui: ";
const START_TIMEOUT: Duration = Duration::from_secs(10);

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ServerUrl {
    /// `127.0.0.1:<port>`; the server rejects any other `Host` header.
    pub host: String,
    pub token: String,
}

/// Parses the line `z-delegate ui: http://127.0.0.1:<port>/?t=<token>` printed on stdout.
pub fn parse_url(line: &str) -> Result<ServerUrl, String> {
    let url = line
        .trim()
        .strip_prefix(URL_PREFIX)
        .ok_or_else(|| format!("unexpected server output: {line:?}"))?
        .trim();
    let rest = url.strip_prefix("http://").ok_or("server URL is not http")?;
    let (host, query) = rest.split_once("/?t=").ok_or("server URL has no token")?;
    let port = host.strip_prefix("127.0.0.1:").ok_or("server is not bound to 127.0.0.1")?;
    if port.parse::<u16>().is_err() {
        return Err("server URL has an invalid port".into());
    }
    if query.is_empty() || !query.chars().all(|c| c.is_ascii_alphanumeric()) {
        return Err("server URL has an invalid token".into());
    }
    Ok(ServerUrl { host: host.to_string(), token: query.to_string() })
}

/// HTTP status and JSON body of one API call.
#[derive(Debug, Clone, serde::Serialize)]
pub struct ApiReply {
    pub status: u16,
    pub body: Value,
}

pub struct Server {
    child: Child,
    url: ServerUrl,
}

fn http_agent() -> ureq::Agent {
    ureq::Agent::config_builder()
        .http_status_as_error(false)
        .proxy(None)
        .timeout_global(Some(Duration::from_secs(15)))
        .build()
        .into()
}

impl Server {
    /// Starts `node <script> ui --no-open` on a free port. `extra_env` is for tests (for example
    /// `Z_AGENTS_CONFIG`); the guard variables of a delegating parent are always removed.
    pub fn start(node: &Path, script: &Path, extra_env: &[(String, String)]) -> Result<Server, String> {
        let mut cmd = tools::command(node);
        cmd.arg(script)
            .args(["ui", "--no-open"])
            .env("Z_DELEGATE_UI_PORT", "0")
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        // `claude-project` / `codex-project` agent sources are read from the cwd; a Finder launch starts in `/`.
        if let Some(home) = tools::home_dir() {
            cmd.current_dir(home);
        }
        for (k, v) in extra_env {
            cmd.env(k, v);
        }
        let mut child = cmd.spawn().map_err(|e| format!("cannot start z-delegate ui: {e}"))?;
        let stdout = child.stdout.take().ok_or("no stdout from z-delegate ui")?;
        let (tx, rx) = mpsc::channel();
        std::thread::spawn(move || {
            let mut reader = BufReader::new(stdout);
            let mut line = String::new();
            let first = reader.read_line(&mut line).map(|_| line);
            let printed = matches!(&first, Ok(l) if !l.trim().is_empty());
            let _ = tx.send(first);
            if printed {
                // Drain until EOF so the pipe never fills; EOF means the server process ended.
                let _ = std::io::copy(&mut reader, &mut std::io::sink());
            }
        });
        let parsed = match rx.recv_timeout(START_TIMEOUT) {
            Ok(Ok(line)) if !line.trim().is_empty() => parse_url(&line),
            Ok(_) => Err("z-delegate ui exited before printing its URL".to_string()),
            Err(_) => Err("z-delegate ui did not print its URL in time".to_string()),
        };
        match parsed {
            Ok(url) => Ok(Server { child, url }),
            Err(e) => {
                let _ = child.kill();
                let _ = child.wait();
                let mut stderr = String::new();
                if let Some(mut s) = child.stderr.take() {
                    let _ = s.read_to_string(&mut stderr);
                }
                let stderr = stderr.trim();
                Err(if stderr.is_empty() { e } else { format!("{e}: {stderr}") })
            }
        }
    }

    pub fn url(&self) -> &ServerUrl {
        &self.url
    }

    pub fn is_running(&mut self) -> bool {
        matches!(self.child.try_wait(), Ok(None))
    }

    fn call(&self, method: &str, path: &str, body: Option<&Value>) -> Result<ApiReply, String> {
        let url = format!("http://{}{}", self.url.host, path);
        let agent = http_agent();
        let resp = if method == "GET" {
            agent.get(&url).header("x-z-token", &self.url.token).call()
        } else {
            let payload = body.map(Value::to_string).unwrap_or_else(|| "{}".into());
            agent
                .post(&url)
                .header("x-z-token", &self.url.token)
                .header("content-type", "application/json")
                .send(payload)
        };
        let mut resp = resp.map_err(|e| format!("request to settings server failed: {e}"))?;
        let status = resp.status().as_u16();
        let text = resp.body_mut().read_to_string().map_err(|e| format!("bad server response: {e}"))?;
        let body = serde_json::from_str(&text).unwrap_or(Value::Null);
        Ok(ApiReply { status, body })
    }

    pub fn ping(&self) -> bool {
        matches!(self.call("GET", "/api/state?ping", None), Ok(r) if r.status == 200)
    }

    /// `GET /api/state` body as is: `{agents, models, efforts, path, config, hash, error?}`; `hash` is null
    /// when the file is missing, `error` is set when the file is unusable.
    pub fn state(&self) -> Result<Value, String> {
        let r = self.call("GET", "/api/state", None)?;
        if r.status != 200 {
            return Err(format!("settings server returned {}", r.status));
        }
        Ok(r.body)
    }

    /// `POST /api/preview` with `{rows}`; returns `{routes}`.
    pub fn preview(&self, rows: &Value) -> Result<Value, String> {
        let r = self.call("POST", "/api/preview", Some(&json!({ "rows": rows })))?;
        if r.status != 200 {
            let msg = r.body.get("error").and_then(Value::as_str).unwrap_or("preview failed");
            return Err(format!("settings server returned {}: {msg}", r.status));
        }
        Ok(r.body)
    }

    /// `POST /api/save`. 200 saved, 409 stale, 422 `{errors}`; the caller surfaces the reply as is.
    pub fn save(&self, edits: &Value, base_hash: Option<&str>) -> Result<ApiReply, String> {
        self.call("POST", "/api/save", Some(&json!({ "edits": edits, "baseHash": base_hash })))
    }

    /// Asks the server to stop, then kills the process if it is still alive after a short wait.
    pub fn shutdown(&mut self) {
        let _ = self.call("POST", "/api/close", None);
        let deadline = Instant::now() + Duration::from_secs(2);
        while Instant::now() < deadline {
            if !self.is_running() {
                return;
            }
            std::thread::sleep(Duration::from_millis(50));
        }
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

impl Drop for Server {
    fn drop(&mut self) {
        if self.is_running() {
            self.shutdown();
        }
    }
}

/// Holds the one server the app runs. It restarts transparently when it died or stopped on idle.
pub struct Manager {
    slot: Mutex<Option<Server>>,
}

impl Manager {
    pub fn new() -> Manager {
        Manager { slot: Mutex::new(None) }
    }

    /// Runs `f` against a live server, starting one when none is running.
    pub fn with_server<T>(&self, f: impl FnOnce(&Server) -> Result<T, String>) -> Result<T, String> {
        let mut guard = self.slot.lock().map_err(|_| "server state poisoned".to_string())?;
        let alive = match guard.as_mut() {
            Some(s) => s.is_running() && s.ping(),
            None => false,
        };
        if !alive {
            *guard = None; // drops (and stops) a dead or unresponsive server
            let node = tools::find_node().ok_or("node not found in your login-shell PATH")?;
            let script = tools::find_z_delegate().ok_or("z-delegate.cjs not found; install the kit with the z-delegation skill")?;
            *guard = Some(Server::start(&node, &script, &[])?);
        }
        f(guard.as_ref().expect("server present"))
    }

    pub fn shutdown(&self) {
        if let Ok(mut guard) = self.slot.lock() {
            if let Some(mut s) = guard.take() {
                s.shutdown();
            }
        }
    }
}

impl Default for Manager {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_server_line() {
        let u = parse_url("z-delegate ui: http://127.0.0.1:47621/?t=abc123DEF\n").unwrap();
        assert_eq!(u.host, "127.0.0.1:47621");
        assert_eq!(u.token, "abc123DEF");
    }

    #[test]
    fn rejects_malformed_lines() {
        assert!(parse_url("").is_err());
        assert!(parse_url("hello").is_err());
        assert!(parse_url("z-delegate ui: https://127.0.0.1:1/?t=a").is_err());
        assert!(parse_url("z-delegate ui: http://evil.example:80/?t=a").is_err());
        assert!(parse_url("z-delegate ui: http://127.0.0.1:99999/?t=a").is_err());
        assert!(parse_url("z-delegate ui: http://127.0.0.1:80/").is_err());
        assert!(parse_url("z-delegate ui: http://127.0.0.1:80/?t=").is_err());
        assert!(parse_url("z-delegate ui: http://127.0.0.1:80/?t=a&b=c").is_err());
    }
}
