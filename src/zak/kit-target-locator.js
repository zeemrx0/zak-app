// Generated from the authoritative kit target contract; do not edit.
/** Canonical host paths shared by kit installers and generated CLI lookup. */
const fs = require("node:fs");
const path = require("node:path");
function absolute(value, label) {
  if (typeof value !== "string" || !value || !path.isAbsolute(value)) throw new Error(`${label} must be an absolute path`);
  return path.resolve(value);
}
function globalTarget(name, env = process.env) {
  if (!["codex", "claude"].includes(name)) throw new Error(`unsupported host: ${name}`);
  const home = absolute(env.HOME, "HOME");
  let rootDir, skillsRoot;
  if (name === "codex") {
    rootDir = env.CODEX_HOME ? absolute(env.CODEX_HOME, "CODEX_HOME") : path.join(home, ".codex");
    skillsRoot = path.join(home, ".agents", "skills");
    if (skillsRoot === rootDir || skillsRoot.startsWith(rootDir + path.sep) || rootDir.startsWith(skillsRoot + path.sep))
      throw new Error("Codex skills root aliases control root");
  } else {
    rootDir = env.CLAUDE_CONFIG_DIR ? absolute(env.CLAUDE_CONFIG_DIR, "CLAUDE_CONFIG_DIR") : path.join(home, ".claude");
    skillsRoot = path.join(rootDir, "skills");
  }
  return { name, scope: "user", rootDir, skillsRoot, skills: "skills", rules: name === "codex" ? "z-rules" : "rules", startup: name === "codex" ? "AGENTS.md" : undefined, lock: "zak-lock.json", guard: "z-global-operation.lock", marker: `.${name}/z-project.json`, invocation: name === "codex" ? "$" : "/" };
}
function hostTarget(name) {
  if (!["codex", "claude"].includes(name))
    throw new Error(`unsupported host: ${name}`);
  const root = `.${name}`;
  return {
    name,
    root,
    skills: name === "codex" ? ".agents/skills" : ".claude/skills",
    rules: name === "codex" ? `${root}/z-rules` : `${root}/rules`,
    agents: `${root}/agents`,
    marker: `${root}/z-project.json`,
    lock: `${root}/zak-lock.json`,
    guard: `${root}/z-operation.lock`,
    startup: name === "codex" ? "AGENTS.md" : undefined,
    invocation: name === "codex" ? "$" : "/",
  };
}
function canonicalDirectory(value) {
  const resolved = absolute(value, "target root");
  let parent = path.parse(resolved).root, nearest;
  if (resolved === parent) throw new Error("filesystem root is not a target");
  for (const segment of resolved.slice(parent.length).split(path.sep).filter(Boolean)) {
    parent = path.join(parent, segment);
    let entry;
    try { entry = fs.lstatSync(parent); }
    catch (error) { if (error.code === "ENOENT") continue; throw new Error("target root inspection failed"); }
    if (entry.isSymbolicLink() || !entry.isDirectory()) throw new Error("unsafe target root");
    nearest = entry;
    if (process.getuid && entry.uid !== process.getuid() && (entry.mode & 0o022) &&
        !(entry.uid === 0 && (entry.mode & 0o1000)))
      throw new Error("foreign writable ancestor ownership");
  }
  if (process.getuid && (!nearest || nearest.uid !== process.getuid()))
    throw new Error("foreign target ancestor ownership");
  return resolved;
}
function resolveTarget({ host, scope, project, env = process.env }) {
  if (!["project", "global"].includes(scope)) throw new Error("invalid target scope");
  if (!["codex", "claude"].includes(host)) throw new Error("unsupported host");
  const canonicalProject = scope === "global" ? null : canonicalDirectory(project);
  const target = scope === "global" ? globalTarget(host, env) : hostTarget(host);
  const controlRoot = canonicalDirectory(target.rootDir || path.join(canonicalProject, target.root));
  const skillsRoot = canonicalDirectory(target.skillsRoot || path.join(canonicalProject, target.skills));
  const lockPath = target.rootDir ? path.join(controlRoot, target.lock) : path.join(canonicalProject, target.lock);
  return Object.freeze({ schema: 1, host, scope, project: canonicalProject, controlRoot, skillsRoot, lockPath });
}
module.exports = { globalTarget, hostTarget, resolveTarget };
