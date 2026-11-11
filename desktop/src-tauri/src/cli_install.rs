//! Installs the zak CLI from inside the app: fetches the release JSON, downloads `install.sh`, checks its
//! SHA-256 against the release asset digest, then runs it. The selection rules mirror the CLI's own release
//! download (`src/release/release-download.js`).

use crate::tools;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fs;
use std::os::unix::fs::{DirBuilderExt, PermissionsExt};
use std::path::{Path, PathBuf};
use std::process::Command;

/// The only repository the installer is ever fetched from.
pub const REPOSITORY: &str = "zeemrx0/zak-app";
const ASSET_NAME: &str = "install.sh";
const API_TIMEOUT_SECS: &str = "30";
const DOWNLOAD_TIMEOUT_SECS: &str = "60";
const MAX_LIST_PAGES: u32 = 10;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Channel {
    Stable,
    Beta,
}

#[derive(Debug, Serialize)]
pub struct InstallResult {
    pub exit_code: i32,
    pub stdout: String,
    pub stderr: String,
    /// `zak --version` after a successful run; `None` when the install failed or zak is still not found.
    pub version: Option<String>,
}

// ---- release selection (pure) ----

/// `1.2.3` or `1.2.3-beta.4` (numbers without leading zeros, beta number at least 1) as a sortable tuple.
/// A stable version has beta number 0.
fn parse_version(v: &str, channel: Channel) -> Option<[u64; 4]> {
    fn num(s: &str) -> Option<u64> {
        if s.is_empty() || !s.bytes().all(|b| b.is_ascii_digit()) || (s.len() > 1 && s.starts_with('0')) {
            return None;
        }
        s.parse().ok()
    }
    let (core, beta) = match (channel, v.split_once("-beta.")) {
        (Channel::Beta, Some((c, b))) => (c, Some(num(b).filter(|n| *n >= 1)?)),
        (Channel::Beta, None) => return None,
        (Channel::Stable, _) => (v, None),
    };
    let mut parts = core.split('.');
    let out = [num(parts.next()?)?, num(parts.next()?)?, num(parts.next()?)?, beta.unwrap_or(0)];
    parts.next().is_none().then_some(out)
}

/// Same rules as the CLI: not a draft, `prerelease` matches the channel, has `published_at`, tag `v<semver>`
/// (stable) or `v<semver>-beta.<n>` (beta).
fn eligible(channel: Channel, release: &Value) -> Option<[u64; 4]> {
    let obj = release.as_object()?;
    if obj.get("draft")?.as_bool()? || obj.get("prerelease")?.as_bool()? != (channel == Channel::Beta) {
        return None;
    }
    obj.get("published_at")?.as_str()?;
    parse_version(obj.get("tag_name")?.as_str()?.strip_prefix('v')?, channel)
}

/// Stable: the `/releases/latest` object. Beta: the highest eligible entry of the releases list.
pub fn select_release(channel: Channel, body: &Value) -> Result<&Value, String> {
    match channel {
        Channel::Stable => eligible(channel, body).map(|_| body).ok_or_else(|| "no published stable release".to_string()),
        Channel::Beta => body
            .as_array()
            .ok_or_else(|| "invalid release list".to_string())?
            .iter()
            .filter_map(|r| eligible(channel, r).map(|v| (v, r)))
            .max_by_key(|(v, _)| *v)
            .map(|(_, r)| r)
            .ok_or_else(|| "no published beta release".to_string()),
    }
}

/// The download URL and expected SHA-256 (lowercase hex) of the single `install.sh` asset.
pub fn installer_asset(release: &Value) -> Result<(String, String), String> {
    let missing = || format!("release is missing a verified {ASSET_NAME}");
    let tag = release.get("tag_name").and_then(Value::as_str).ok_or_else(missing)?;
    let assets: Vec<&Value> = release
        .get("assets")
        .and_then(Value::as_array)
        .ok_or_else(missing)?
        .iter()
        .filter(|a| a.get("name").and_then(Value::as_str) == Some(ASSET_NAME))
        .collect();
    let [asset] = assets.as_slice() else { return Err(missing()) };
    let digest = asset.get("digest").and_then(Value::as_str).ok_or_else(missing)?;
    let hex = digest.strip_prefix("sha256:").filter(|h| h.len() == 64 && h.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f')));
    let hex = hex.ok_or_else(missing)?;
    // The tag passed the semver check, so it is safe inside a URL.
    Ok((format!("https://github.com/{REPOSITORY}/releases/download/{tag}/{ASSET_NAME}"), hex.to_string()))
}

pub fn release_urls(channel: Channel) -> Vec<String> {
    let base = format!("https://api.github.com/repos/{REPOSITORY}/releases");
    match channel {
        Channel::Stable => vec![format!("{base}/latest")],
        Channel::Beta => (1..=MAX_LIST_PAGES).map(|p| format!("{base}?per_page=100&page={p}")).collect(),
    }
}

/// Arguments for `sh`: the script path, then the channel flag for beta.
pub fn build_argv(script: &Path, channel: Channel) -> Vec<String> {
    let mut argv = vec![script.to_string_lossy().into_owned()];
    if channel == Channel::Beta {
        argv.extend(["--channel".to_string(), "beta".to_string()]);
    }
    argv
}

// ---- SHA-256 (pure) ----

const K: [u32; 64] = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be,
    0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa,
    0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85,
    0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3,
    0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f,
    0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

pub fn sha256_hex(data: &[u8]) -> String {
    let mut h: [u32; 8] = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    let mut msg = data.to_vec();
    msg.push(0x80);
    while msg.len() % 64 != 56 {
        msg.push(0);
    }
    msg.extend_from_slice(&((data.len() as u64) * 8).to_be_bytes());
    for chunk in msg.chunks_exact(64) {
        let mut w = [0u32; 64];
        for (i, b) in chunk.chunks_exact(4).enumerate() {
            w[i] = u32::from_be_bytes([b[0], b[1], b[2], b[3]]);
        }
        for i in 16..64 {
            let s0 = w[i - 15].rotate_right(7) ^ w[i - 15].rotate_right(18) ^ (w[i - 15] >> 3);
            let s1 = w[i - 2].rotate_right(17) ^ w[i - 2].rotate_right(19) ^ (w[i - 2] >> 10);
            w[i] = w[i - 16].wrapping_add(s0).wrapping_add(w[i - 7]).wrapping_add(s1);
        }
        let [mut a, mut b, mut c, mut d, mut e, mut f, mut g, mut hh] = h;
        for i in 0..64 {
            let s1 = e.rotate_right(6) ^ e.rotate_right(11) ^ e.rotate_right(25);
            let ch = (e & f) ^ (!e & g);
            let t1 = hh.wrapping_add(s1).wrapping_add(ch).wrapping_add(K[i]).wrapping_add(w[i]);
            let s0 = a.rotate_right(2) ^ a.rotate_right(13) ^ a.rotate_right(22);
            let maj = (a & b) ^ (a & c) ^ (b & c);
            let t2 = s0.wrapping_add(maj);
            hh = g;
            g = f;
            f = e;
            e = d.wrapping_add(t1);
            d = c;
            c = b;
            b = a;
            a = t1.wrapping_add(t2);
        }
        for (x, y) in h.iter_mut().zip([a, b, c, d, e, f, g, hh]) {
            *x = x.wrapping_add(y);
        }
    }
    h.iter().map(|x| format!("{x:08x}")).collect()
}

/// Ok only when the SHA-256 of `bytes` equals `expected_hex`.
pub fn verify_digest(bytes: &[u8], expected_hex: &str) -> Result<(), String> {
    if sha256_hex(bytes) == expected_hex {
        Ok(())
    } else {
        Err(format!("{ASSET_NAME} checksum mismatch: refusing to run it"))
    }
}

// ---- process side ----

/// Private temp dir (mode 0700), removed on drop.
struct TempDir(PathBuf);

impl TempDir {
    fn new() -> Result<Self, String> {
        let nanos = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
        let dir = std::env::temp_dir().join(format!("zak-desktop-install-{}-{nanos}", std::process::id()));
        fs::DirBuilder::new().mode(0o700).create(&dir).map_err(|e| format!("cannot create {}: {e}", dir.display()))?;
        Ok(TempDir(dir))
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

fn curl_path() -> Result<PathBuf, String> {
    tools::find_in_path("curl", tools::child_path()).ok_or_else(|| "curl is required to install zak but was not found".to_string())
}

/// `curl -fsSL` with a timeout and a generic User-Agent; `-o <out>` when a file is given, else stdout.
fn curl(url: &str, max_time: &str, out: Option<&Path>) -> Result<Vec<u8>, String> {
    let mut cmd = tools::command(&curl_path()?);
    cmd.args(["-fsSL", "--max-time", max_time, "-A", "zak-desktop", "-H", "Accept: application/vnd.github+json"]);
    if let Some(p) = out {
        cmd.arg("-o").arg(p);
    }
    let output = cmd.arg(url).output().map_err(|e| format!("cannot run curl: {e}"))?;
    if !output.status.success() {
        let msg = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(format!("download failed ({url}): {}", if msg.is_empty() { "curl failed".into() } else { msg }));
    }
    Ok(output.stdout)
}

fn fetch_release(channel: Channel) -> Result<Value, String> {
    let mut merged: Vec<Value> = Vec::new();
    for url in release_urls(channel) {
        let body = curl(&url, API_TIMEOUT_SECS, None)?;
        let json: Value = serde_json::from_slice(&body).map_err(|e| format!("invalid release API JSON: {e}"))?;
        if channel == Channel::Stable {
            return Ok(json);
        }
        let page = json.as_array().ok_or("invalid release list")?;
        let last = page.len() < 100;
        merged.extend(page.iter().cloned());
        if last {
            break;
        }
    }
    Ok(Value::Array(merged))
}

pub fn install(channel: Channel) -> Result<InstallResult, String> {
    let body = fetch_release(channel)?;
    let release = select_release(channel, &body)?;
    let (url, expected) = installer_asset(release)?;

    let dir = TempDir::new()?;
    let script = dir.0.join(ASSET_NAME);
    curl(&url, DOWNLOAD_TIMEOUT_SECS, Some(&script))?;
    let bytes = fs::read(&script).map_err(|e| format!("cannot read the downloaded {ASSET_NAME}: {e}"))?;
    verify_digest(&bytes, &expected)?;
    fs::set_permissions(&script, fs::Permissions::from_mode(0o600)).map_err(|e| format!("cannot protect {ASSET_NAME}: {e}"))?;

    let sh = tools::find_in_path("sh", tools::child_path()).ok_or("sh was not found")?;
    let mut cmd: Command = tools::command(&sh);
    let output = cmd.args(build_argv(&script, channel)).output().map_err(|e| format!("cannot run {ASSET_NAME}: {e}"))?;
    let exit_code = output.status.code().unwrap_or(-1);
    let version = if output.status.success() { tools::zak_version() } else { None };
    Ok(InstallResult {
        exit_code,
        stdout: String::from_utf8_lossy(&output.stdout).into_owned(),
        stderr: String::from_utf8_lossy(&output.stderr).into_owned(),
        version,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn rel(tag: &str, prerelease: bool) -> Value {
        json!({"tag_name": tag, "draft": false, "prerelease": prerelease, "published_at": "2026-11-11T00:00:00Z", "assets": []})
    }

    fn with_assets(assets: Value) -> Value {
        json!({"tag_name": "v1.2.3", "assets": assets})
    }

    const HEX: &str = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";

    #[test]
    fn stable_accepts_only_published_semver_tag() {
        assert!(select_release(Channel::Stable, &rel("v1.2.3", false)).is_ok());
        assert!(select_release(Channel::Stable, &rel("v1.2.3", true)).is_err());
        assert!(select_release(Channel::Stable, &rel("v1.2.3-beta.1", false)).is_err());
        assert!(select_release(Channel::Stable, &rel("1.2.3", false)).is_err());
        assert!(select_release(Channel::Stable, &rel("v01.2.3", false)).is_err());
        let mut draft = rel("v1.2.3", false);
        draft["draft"] = json!(true);
        assert!(select_release(Channel::Stable, &draft).is_err());
        let mut unpublished = rel("v1.2.3", false);
        unpublished["published_at"] = Value::Null;
        assert!(select_release(Channel::Stable, &unpublished).is_err());
    }

    #[test]
    fn beta_picks_highest_eligible_prerelease() {
        let list = json!([
            rel("v1.0.0", false),
            rel("v1.1.0-beta.2", true),
            rel("v1.1.0-beta.10", true),
            rel("v1.0.9-beta.50", true),
            rel("v1.2.0-rc.1", true),
            rel("v1.3.0-beta.1", false),
            {"tag_name": "v9.0.0-beta.1", "draft": true, "prerelease": true, "published_at": "x"}
        ]);
        let picked = select_release(Channel::Beta, &list).unwrap();
        assert_eq!(picked["tag_name"], "v1.1.0-beta.10");
        assert!(select_release(Channel::Beta, &json!([rel("v1.0.0", false)])).is_err());
        assert!(select_release(Channel::Beta, &json!({})).is_err());
    }

    #[test]
    fn asset_and_digest_selection() {
        let ok = with_assets(json!([{"name": "install.sh", "digest": format!("sha256:{HEX}")}, {"name": "other", "digest": "x"}]));
        let (url, hex) = installer_asset(&ok).unwrap();
        assert_eq!(url, "https://github.com/zeemrx0/zak-app/releases/download/v1.2.3/install.sh");
        assert_eq!(hex, HEX);

        assert!(installer_asset(&with_assets(json!([]))).is_err());
        let dup = json!([{"name": "install.sh", "digest": format!("sha256:{HEX}")}, {"name": "install.sh", "digest": format!("sha256:{HEX}")}]);
        assert!(installer_asset(&with_assets(dup)).is_err());
        assert!(installer_asset(&with_assets(json!([{"name": "install.sh"}]))).is_err());
        for bad in ["sha256:abc", &format!("sha1:{HEX}"), &format!("sha256:{}", HEX.to_uppercase()), &format!("sha256:{HEX}0"), HEX] {
            assert!(installer_asset(&with_assets(json!([{"name": "install.sh", "digest": bad}]))).is_err(), "{bad}");
        }
    }

    #[test]
    fn sha256_known_vectors() {
        assert_eq!(sha256_hex(b"abc"), HEX);
        assert_eq!(sha256_hex(b""), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
        let long = vec![b'a'; 1000];
        assert_eq!(sha256_hex(&long), "41edece42d63e8d9bf515a9ba6932e1c20cbc9f5a5d134645adb5db1b9737ea3");
    }

    #[test]
    fn tampered_bytes_are_rejected() {
        assert!(verify_digest(b"abc", HEX).is_ok());
        assert!(verify_digest(b"abd", HEX).is_err());
        assert!(verify_digest(b"abc\n", HEX).is_err());
    }

    #[test]
    fn argv_adds_channel_only_for_beta() {
        assert_eq!(build_argv(Path::new("/t/install.sh"), Channel::Stable), ["/t/install.sh"]);
        assert_eq!(build_argv(Path::new("/t/install.sh"), Channel::Beta), ["/t/install.sh", "--channel", "beta"]);
    }

    #[test]
    fn urls_target_the_one_repository() {
        assert_eq!(release_urls(Channel::Stable), ["https://api.github.com/repos/zeemrx0/zak-app/releases/latest"]);
        assert!(release_urls(Channel::Beta).iter().all(|u| u.starts_with("https://api.github.com/repos/zeemrx0/zak-app/releases?per_page=100&page=")));
    }
}
