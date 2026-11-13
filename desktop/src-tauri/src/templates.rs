//! Runner for the kit's `templates.cjs`, the helper that lists, reads, saves and resets the `z-unity-setup`
//! template overrides.
//!
//! The app never touches the override files itself. Each request spawns `node templates.cjs <cmd>`, writes one
//! JSON object to its stdin and reads one JSON object from its stdout, so the kit stays the only validator.

use crate::settings::{into_reply, parse_output, ApiReply};
use crate::tools;
use serde_json::{json, Value};
use std::io::Write;
use std::path::PathBuf;
use std::process::Stdio;

pub struct Runner {
    node: PathBuf,
    script: PathBuf,
    extra_env: Vec<(String, String)>,
}

impl Runner {
    /// Finds `node` and the installed `templates.cjs`.
    pub fn discover() -> Result<Runner, String> {
        let node = tools::find_node().ok_or("node not found in your login-shell PATH")?;
        let script = tools::find_templates().ok_or("templates.cjs not found; install the kit's unity tier")?;
        Ok(Runner::new(node, script, Vec::new()))
    }

    /// `extra_env` is for tests (for example `Z_TEMPLATES_DIR`).
    pub fn new(node: PathBuf, script: PathBuf, extra_env: Vec<(String, String)>) -> Runner {
        Runner { node, script, extra_env }
    }

    /// Runs `<cmd>` with `input` on stdin. A non-zero exit becomes an error carrying the script's own `error`.
    fn call(&self, cmd: &str, input: Option<&Value>) -> Result<Value, String> {
        let label = format!("templates {cmd}");
        let mut process = tools::command(&self.node);
        process.arg(&self.script).arg(cmd).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());
        for (k, v) in &self.extra_env {
            process.env(k, v);
        }
        let mut child = process.spawn().map_err(|e| format!("cannot start {label}: {e}"))?;
        let payload = input.map(Value::to_string).unwrap_or_default();
        let mut stdin = child.stdin.take().ok_or_else(|| format!("no stdin for {label}"))?;
        // Written from a thread so a large payload cannot block against a full stdout pipe.
        let writer = std::thread::spawn(move || {
            let _ = stdin.write_all(payload.as_bytes());
        });
        let out = child.wait_with_output().map_err(|e| format!("{label} failed: {e}"))?;
        let _ = writer.join();
        parse_output(&label, out.status.code(), &out.stdout, &out.stderr)
    }

    /// `{dir, templates: [{name, label, format, description, overridden}]}`.
    pub fn list(&self) -> Result<Value, String> {
        self.call("list", None)
    }

    /// `{name, format, path, overridden, content, default, hash}`; `hash` is null without an override.
    pub fn get(&self, name: &str) -> Result<Value, String> {
        self.call("get", Some(&json!({ "name": name })))
    }

    /// 200 saved, 409 stale, 422 `{errors}`; the caller surfaces the reply as is.
    pub fn save(&self, name: &str, content: &str, base_hash: Option<&str>) -> Result<ApiReply, String> {
        let body = self.call("save", Some(&json!({ "name": name, "content": content, "baseHash": base_hash })))?;
        into_reply("templates save", body)
    }

    /// Deletes the override. 200 or 409.
    pub fn reset(&self, name: &str, base_hash: Option<&str>) -> Result<ApiReply, String> {
        let body = self.call("reset", Some(&json!({ "name": name, "baseHash": base_hash })))?;
        into_reply("templates reset", body)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn scratch(tag: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("zak-templates-{tag}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        d
    }

    /// A stand-in `templates.cjs` that echoes its command and stdin, so the runner wiring is checked without the kit.
    fn fake_script(dir: &std::path::Path, body: &str) -> PathBuf {
        let p = dir.join("templates.cjs");
        fs::write(&p, body).unwrap();
        p
    }

    #[test]
    fn save_sends_json_on_stdin_and_splits_the_status() {
        let Some(node) = tools::find_node() else { return };
        let dir = scratch("save");
        let script = fake_script(
            &dir,
            r#"let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const i=JSON.parse(s);console.log(JSON.stringify({status:i.baseHash===null?200:409,cmd:process.argv[2],name:i.name,content:i.content}))})"#,
        );
        let r = Runner::new(node, script, Vec::new());
        let ok = r.save("gitignore", "a\n", None).unwrap();
        assert_eq!(ok.status, 200);
        assert_eq!(ok.body["cmd"], "save");
        assert_eq!(ok.body["content"], "a\n");
        assert!(ok.body.get("status").is_none());
        assert_eq!(r.reset("gitignore", Some("abc")).unwrap().status, 409);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_failing_script_surfaces_its_error() {
        let Some(node) = tools::find_node() else { return };
        let dir = scratch("fail");
        let script = fake_script(&dir, r#"console.log(JSON.stringify({ok:false,error:"unknown template"}));process.exit(2)"#);
        let e = Runner::new(node, script, Vec::new()).get("nope").unwrap_err();
        assert!(e.contains("templates get") && e.contains("exit 2") && e.contains("unknown template"), "{e}");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_reply_without_status_is_an_error() {
        assert!(into_reply("templates save", json!({"ok": true})).is_err());
    }
}
