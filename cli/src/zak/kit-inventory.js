const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { resolveTarget } = require('./kit-target-locator');
const { kitSnapshot } = require('./kit-snapshot');
const { readPin } = require('./kit-source-pins');
const { readPreference } = require('./kit-source-preference');
const { localSource } = require('./kit-local-source');
const KIT_PATH_ERROR = 'set a local kit path: zak kit source <path>';
const SELECTION_FLAGS = ['--select', '--follow', '--no-follow'];
const SECRET_KEYS = ['ZAK_KIT_CONTROL', 'GH_TOKEN', 'GITHUB_TOKEN', 'GH_ENTERPRISE_TOKEN', 'GITHUB_ENTERPRISE_TOKEN'];
// Item selection, follow links and inventory need a kit that declares kitSelectionProtocol 1.
function supportsSelection(pkg) {
  try { return JSON.parse(fs.readFileSync(path.join(pkg, 'package.json'), 'utf8'))?.kitSelectionProtocol === 1; } catch { return false; }
}
function assertSelectionProtocol(pkg, tag) {
  if (!supportsSelection(pkg)) {
    const error = new Error(`kit source ${tag} does not support item selection; update the kit folder`);
    error.selectionProtocol = true;
    throw error;
  }
}
// Read-only: no source lock, no pin write. Prints the kit's inventory JSON and returns its exit code.
async function kitInventory(args, environment = process.env, dependencies = {}) {
  const { targetArgs, HOSTS } = require('./kit-lifecycle');
  const deps = { resolveTarget, kitSnapshot, readPin, readPreference, localSource, spawnSync, ...dependencies };
  const parsed = targetArgs(args);
  if (parsed.rest.some(arg => !['--global', '--json'].includes(arg) && path.resolve(arg) !== parsed.project))
    throw new Error('unknown kit inventory option');
  const hosts = parsed.hosts || [...HOSTS];
  const preferred = deps.readPreference(environment)?.path;
  const pinned = hosts
    .map(host => deps.readPin(deps.resolveTarget({ host, scope: parsed.scope, project: parsed.project, env: environment }), environment))
    .find(pin => pin?.source.distribution === 'local')?.source.path;
  const localPath = preferred || pinned;
  if (!localPath) throw new Error(KIT_PATH_ERROR);
  const handle = await deps.kitSnapshot(deps.localSource(localPath), { readonly: true }, environment);
  try {
    assertSelectionProtocol(handle.pkg, handle.snapshot.tag);
    const childEnv = { ...environment };
    for (const key of SECRET_KEYS) delete childEnv[key];
    const scope = parsed.scope === 'global' ? ['--global'] : [parsed.project];
    const result = deps.spawnSync(process.execPath, [path.join(handle.pkg, 'scripts/ship-kit.cjs'), ...scope,
      '--inventory', '--target', hosts.join(','), '--json'],
    { env: childEnv, encoding: 'utf8', timeout: 300000, maxBuffer: 64 * 1024 * 1024 });
    if (result.error) throw new Error(`kit inventory failed: ${result.error.message}`);
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    return result.status ?? 1;
  } finally { handle.cleanup(); }
}
module.exports = { kitInventory, assertSelectionProtocol, supportsSelection, SELECTION_FLAGS };
