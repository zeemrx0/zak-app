//! Read-only view of what the kit installed (`zak-lock.json` per host) and the remembered project list.
//!
//! The app never writes lock files. It only reads them to show version and tiers.

use crate::tools;
use serde::Serialize;
use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};

const LOCK_FILE: &str = "zak-lock.json";

/// What one lock file says about one host.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Lock {
    pub kit_version: String,
    pub tiers: Vec<String>,
    pub lock_path: String,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
pub struct Hosts {
    pub claude: Option<Lock>,
    pub codex: Option<Lock>,
}

/// One place the kit can be installed: the global config roots (`path` is `None`) or a project.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
pub struct Location {
    pub path: Option<String>,
    pub hosts: Hosts,
    /// Set when a lock file exists but cannot be read or has the wrong shape.
    pub error: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct Installs {
    pub global: Location,
    pub projects: Vec<Location>,
    /// Set when the remembered project list cannot be read. The global location is still reported.
    pub projects_error: Option<String>,
}

/// Result of adding a project: the canonical path that was stored and the full list.
#[derive(Debug, Serialize)]
pub struct Added {
    pub path: String,
    pub projects: Vec<String>,
}

/// Global lock paths: `(claude, codex)`. `claude_dir` / `codex_dir` are the `CLAUDE_CONFIG_DIR` / `CODEX_HOME`
/// values when set and non-empty.
pub fn global_lock_paths(home: &Path, claude_dir: Option<&Path>, codex_dir: Option<&Path>) -> (PathBuf, PathBuf) {
    let claude = claude_dir.map(Path::to_path_buf).unwrap_or_else(|| home.join(".claude"));
    let codex = codex_dir.map(Path::to_path_buf).unwrap_or_else(|| home.join(".codex"));
    (claude.join(LOCK_FILE), codex.join(LOCK_FILE))
}

/// Project lock paths: `(claude, codex)`.
pub fn project_lock_paths(project: &Path) -> (PathBuf, PathBuf) {
    (project.join(".claude").join(LOCK_FILE), project.join(".codex").join(LOCK_FILE))
}

/// Reads one lock. `Ok(None)` when the file does not exist, `Err` when it cannot be used.
pub fn read_lock(path: &Path) -> Result<Option<Lock>, String> {
    let text = match fs::read_to_string(path) {
        Ok(t) => t,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(format!("cannot read {}: {e}", path.display())),
    };
    let json: Value = serde_json::from_str(&text).map_err(|e| format!("{} is not valid JSON: {e}", path.display()))?;
    let kit_version = json
        .get("kitVersion")
        .and_then(Value::as_str)
        .ok_or_else(|| format!("{}: kitVersion must be a string", path.display()))?;
    let tiers = json
        .get("tiers")
        .and_then(Value::as_array)
        .and_then(|a| a.iter().map(|t| t.as_str().map(str::to_string)).collect::<Option<Vec<_>>>())
        .ok_or_else(|| format!("{}: tiers must be an array of strings", path.display()))?;
    Ok(Some(Lock { kit_version: kit_version.to_string(), tiers, lock_path: path.to_string_lossy().into_owned() }))
}

/// Builds a location from its two lock paths. Both locks are tried so one bad file does not hide the other.
pub fn location(path: Option<String>, claude: &Path, codex: &Path) -> Location {
    let mut loc = Location { path, ..Location::default() };
    let mut errors = Vec::new();
    for (slot, lock_path) in [(&mut loc.hosts.claude, claude), (&mut loc.hosts.codex, codex)] {
        match read_lock(lock_path) {
            Ok(lock) => *slot = lock,
            Err(e) => errors.push(e),
        }
    }
    if !errors.is_empty() {
        loc.error = Some(errors.join("; "));
    }
    loc
}

pub fn global_location(home: &Path, claude_dir: Option<&Path>, codex_dir: Option<&Path>) -> Location {
    let (claude, codex) = global_lock_paths(home, claude_dir, codex_dir);
    location(None, &claude, &codex)
}

pub fn project_location(project: &str) -> Location {
    let (claude, codex) = project_lock_paths(Path::new(project));
    location(Some(project.to_string()), &claude, &codex)
}

/// A set, non-empty environment value as a path.
/// The app's own environment first, then the login shell's (a Finder launch has neither).
pub fn env_path(key: &str) -> Option<PathBuf> {
    tools::env_value(key).map(PathBuf::from)
}

/// Reads the global location and every remembered project.
pub fn collect(home: &Path, projects: &[String]) -> Installs {
    Installs {
        global: global_location(home, env_path("CLAUDE_CONFIG_DIR").as_deref(), env_path("CODEX_HOME").as_deref()),
        projects: projects.iter().map(|p| project_location(p)).collect(),
        projects_error: None,
    }
}

/// Like `collect`, reading the project list from `store`. A bad store only empties the project list and sets
/// `projects_error`, so the global page keeps working.
pub fn collect_with_store(home: &Path, store: Result<&Path, String>) -> Installs {
    let loaded = store.and_then(load_projects);
    match loaded {
        Ok(projects) => collect(home, &projects),
        Err(e) => Installs { projects_error: Some(e), ..collect(home, &[]) },
    }
}

/// Loads the project list. A missing file is an empty list.
pub fn load_projects(file: &Path) -> Result<Vec<String>, String> {
    match fs::read_to_string(file) {
        Ok(text) => serde_json::from_str(&text).map_err(|e| format!("{} is not a valid project list: {e}", file.display())),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Vec::new()),
        Err(e) => Err(format!("cannot read {}: {e}", file.display())),
    }
}

pub fn save_projects(file: &Path, projects: &[String]) -> Result<(), String> {
    if let Some(dir) = file.parent() {
        fs::create_dir_all(dir).map_err(|e| format!("cannot create {}: {e}", dir.display()))?;
    }
    let text = serde_json::to_string_pretty(projects).map_err(|e| e.to_string())?;
    // Write a sibling temp file, then rename: a crash never leaves a truncated list behind.
    let mut tmp_name = file.file_name().ok_or_else(|| format!("{} has no file name", file.display()))?.to_os_string();
    tmp_name.push(".tmp");
    let tmp = file.with_file_name(tmp_name);
    fs::write(&tmp, text).map_err(|e| format!("cannot write {}: {e}", tmp.display()))?;
    fs::rename(&tmp, file).map_err(|e| {
        let _ = fs::remove_file(&tmp);
        format!("cannot write {}: {e}", file.display())
    })
}

/// Adds a project: absolute, existing directory, canonicalized, not already listed. Returns the stored
/// canonical path and the new list.
pub fn add_project(file: &Path, path: &str) -> Result<Added, String> {
    let path = path.trim();
    if !Path::new(path).is_absolute() {
        return Err("project path must be absolute".into());
    }
    let canonical = fs::canonicalize(path).map_err(|e| format!("cannot open {path}: {e}"))?;
    if !canonical.is_dir() {
        return Err(format!("{path} is not a directory"));
    }
    let canonical = canonical.to_string_lossy().into_owned();
    let mut list = load_projects(file)?;
    if list.contains(&canonical) {
        return Err(format!("{canonical} is already in the list"));
    }
    list.push(canonical.clone());
    save_projects(file, &list)?;
    Ok(Added { path: canonical, projects: list })
}

/// Forgets a project (never touches its files). Returns the new list.
pub fn remove_project(file: &Path, path: &str) -> Result<Vec<String>, String> {
    let path = path.trim();
    let mut list = load_projects(file)?;
    list.retain(|p| p != path);
    save_projects(file, &list)?;
    Ok(list)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("zak-desktop-installs-{}-{name}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn global_paths_default_and_env_roots() {
        let (c, x) = global_lock_paths(Path::new("/h"), None, None);
        assert_eq!(c, Path::new("/h/.claude/zak-lock.json"));
        assert_eq!(x, Path::new("/h/.codex/zak-lock.json"));
        let (c, x) = global_lock_paths(Path::new("/h"), Some(Path::new("/cc")), Some(Path::new("/cx")));
        assert_eq!(c, Path::new("/cc/zak-lock.json"));
        assert_eq!(x, Path::new("/cx/zak-lock.json"));
    }

    #[test]
    fn project_paths() {
        let (c, x) = project_lock_paths(Path::new("/p"));
        assert_eq!(c, Path::new("/p/.claude/zak-lock.json"));
        assert_eq!(x, Path::new("/p/.codex/zak-lock.json"));
    }

    #[test]
    fn parses_valid_missing_and_bad_locks() {
        let dir = scratch("locks");
        let ok = dir.join("ok.json");
        fs::write(&ok, r#"{"kitVersion":"0.7.0","tiers":["general","unity"],"extra":1}"#).unwrap();
        let lock = read_lock(&ok).unwrap().unwrap();
        assert_eq!(lock.kit_version, "0.7.0");
        assert_eq!(lock.tiers, ["general", "unity"]);
        assert_eq!(lock.lock_path, ok.to_string_lossy());

        assert_eq!(read_lock(&dir.join("missing.json")).unwrap(), None);

        for (name, text) in [
            ("junk", "{not json"),
            ("version", r#"{"kitVersion":7,"tiers":[]}"#),
            ("tiers", r#"{"kitVersion":"1","tiers":"general"}"#),
            ("tier-item", r#"{"kitVersion":"1","tiers":["a",2]}"#),
            ("empty", "{}"),
        ] {
            let p = dir.join(format!("{name}.json"));
            fs::write(&p, text).unwrap();
            assert!(read_lock(&p).is_err(), "{name} must be an error");
        }
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn location_keeps_good_host_when_other_is_malformed() {
        let dir = scratch("location");
        let good = dir.join("good.json");
        let bad = dir.join("bad.json");
        fs::write(&good, r#"{"kitVersion":"1.0.0","tiers":["general"]}"#).unwrap();
        fs::write(&bad, "nope").unwrap();
        let loc = location(Some("/p".into()), &good, &bad);
        assert!(loc.hosts.claude.is_some());
        assert!(loc.hosts.codex.is_none());
        assert!(loc.error.is_some());
        let none = location(None, &dir.join("a"), &dir.join("b"));
        assert_eq!(none, Location::default());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn global_location_reads_env_roots() {
        let dir = scratch("global");
        fs::write(dir.join("zak-lock.json"), r#"{"kitVersion":"2","tiers":[]}"#).unwrap();
        let loc = global_location(Path::new("/nonexistent-home"), Some(&dir), None);
        assert_eq!(loc.path, None);
        assert_eq!(loc.hosts.claude.unwrap().kit_version, "2");
        assert!(loc.hosts.codex.is_none());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn project_store_add_duplicate_remove() {
        let dir = scratch("store");
        let store = dir.join("data/projects.json");
        let proj = dir.join("proj");
        fs::create_dir_all(&proj).unwrap();
        let file = dir.join("file.txt");
        fs::write(&file, "x").unwrap();

        assert_eq!(load_projects(&store).unwrap(), Vec::<String>::new());
        let added = add_project(&store, &format!("  {}  ", proj.display())).unwrap();
        let canonical = fs::canonicalize(&proj).unwrap().to_string_lossy().into_owned();
        assert_eq!(added.path, canonical);
        assert_eq!(added.projects, std::slice::from_ref(&canonical));
        assert!(!dir.join("data/projects.json.tmp").exists(), "temp file is renamed away");
        assert_eq!(load_projects(&store).unwrap(), std::slice::from_ref(&canonical));

        assert!(add_project(&store, proj.to_str().unwrap()).unwrap_err().contains("already"));
        assert!(add_project(&store, "relative/dir").unwrap_err().contains("absolute"));
        assert!(add_project(&store, file.to_str().unwrap()).unwrap_err().contains("not a directory"));
        assert!(add_project(&store, dir.join("nope").to_str().unwrap()).is_err());

        assert_eq!(remove_project(&store, &canonical).unwrap(), Vec::<String>::new());
        assert!(proj.is_dir(), "remove only forgets");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn corrupt_store_keeps_the_global_location() {
        let dir = scratch("corrupt");
        let store = dir.join("projects.json");
        fs::write(&store, "{truncated").unwrap();
        let got = collect_with_store(&dir, Ok(&store));
        assert!(got.projects.is_empty());
        assert!(got.projects_error.unwrap().contains("not a valid project list"));
        let ok = collect_with_store(&dir, Ok(&dir.join("missing.json")));
        assert!(ok.projects_error.is_none());
        let unresolved = collect_with_store(&dir, Err("no app dir".into()));
        assert_eq!(unresolved.projects_error.as_deref(), Some("no app dir"));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn save_replaces_an_existing_store_atomically() {
        let dir = scratch("atomic");
        let store = dir.join("projects.json");
        save_projects(&store, &["/a".to_string()]).unwrap();
        save_projects(&store, &["/b".to_string(), "/c".to_string()]).unwrap();
        assert_eq!(load_projects(&store).unwrap(), ["/b", "/c"]);
        assert!(!dir.join("projects.json.tmp").exists());
        let _ = fs::remove_dir_all(&dir);
    }
}
