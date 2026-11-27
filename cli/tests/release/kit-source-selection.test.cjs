const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { kitSourceCommand } = require('../../src/zak/kit-source-command');
const { readPreference, writePreference } = require('../../src/zak/kit-source-preference');
const { localSource } = require('../../src/zak/kit-local-source');
const { stateRoot } = require('../../src/zak/kit-source-pins');
const { kitLifecycle } = require('../../src/zak/kit-lifecycle');
const { resolveTarget } = require('../../src/zak/kit-target-locator');
function home(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'zak-source-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const kit = path.join(root, 'kit');
  fs.mkdirSync(path.join(kit, 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(kit, 'scripts/ship-kit.cjs'), '');
  fs.writeFileSync(path.join(kit, 'package.json'), JSON.stringify({ name: 'z-agent-kit', version: '1.2.0', kitControlProtocol: 1,
    repository: { url: 'https://github.com/fixture/public-kit.git' } }));
  return { root, kit, env: { HOME: root } };
}
function capture(t) {
  const lines = [], previous = console.log;
  console.log = message => lines.push(String(message));
  t.after(() => { console.log = previous; });
  return lines;
}
const quiet = { tty: false };
test('source command stores a relative or absolute local folder', async t => {
  const h = home(t); capture(t);
  assert.equal(await kitSourceCommand(['kit'], h.env, { ...quiet, cwd: h.root }), 0);
  assert.deepEqual(readPreference(h.env), { schema: 1, kind: 'local', path: h.kit });
  assert.equal(await kitSourceCommand([h.kit], h.env, { ...quiet, cwd: '/' }), 0);
  assert.equal(readPreference(h.env).path, h.kit);
});
test('source command rejects invalid folders and extra arguments', async t => {
  const h = home(t);
  const deps = { ...quiet, cwd: h.root };
  await assert.rejects(kitSourceCommand([h.root], h.env, deps), /not a z-agent-kit checkout/);
  await assert.rejects(kitSourceCommand(['missing'], h.env, deps), /not found/);
  for (const args of [['local', 'kit'], ['kit', 'other'], ['--public'], ['']])
    await assert.rejects(kitSourceCommand(args, h.env, deps), { message: 'usage: zak kit source <path>' });
  assert.equal(readPreference(h.env), null);
});
test('source command without a terminal prints the stored path or not set', async t => {
  const h = home(t), lines = capture(t);
  assert.equal(await kitSourceCommand([], h.env, { ...quiet, cwd: h.root }), 0);
  writePreference({ schema: 1, kind: 'local', path: h.kit }, h.env);
  assert.equal(await kitSourceCommand([], h.env, { ...quiet, cwd: h.root }), 0);
  assert.deepEqual(lines, ['Kit source: not set', `Kit source: ${h.kit}`]);
});
test('interactive source command prompts for the local path and honors cancel', async t => {
  const h = home(t); capture(t);
  let initial;
  const prompt = { async promptKitPath({ initialValue, validate }) {
    initial = initialValue;
    assert.match(validate(h.root), /not a z-agent-kit/); assert.equal(validate(h.kit), undefined); return h.kit; } };
  assert.equal(await kitSourceCommand([], h.env, { tty: true, cwd: h.root, prompt: () => prompt, defaultLocalPath: () => '/default' }), 0);
  assert.equal(initial, '/default');
  assert.equal(readPreference(h.env).path, h.kit);
  await kitSourceCommand([], h.env, { tty: true, cwd: h.root, prompt: () => ({ async promptKitPath({ initialValue }) { initial = initialValue; return null; } }) });
  assert.equal(initial, h.kit);
  assert.equal(await kitSourceCommand([], h.env, { tty: true, cwd: h.root, prompt: () => ({ async promptKitPath() { return null; } }) }), 130);
  assert.equal(readPreference(h.env).path, h.kit);
});
test('local sources derive their channel from the kit version', t => {
  const h = home(t);
  assert.deepEqual(localSource(h.kit), { repository: 'fixture/public-kit', transport: 'local', channel: 'stable', distribution: 'local', path: h.kit });
  fs.writeFileSync(path.join(h.kit, 'package.json'), JSON.stringify({ name: 'z-agent-kit', version: '1.3.0-beta.2', kitControlProtocol: 1,
    repository: { url: 'https://github.com/fixture/public-kit.git' } }));
  assert.equal(localSource(h.kit).channel, 'beta');
});
test('a stored public or private preference reads as not set', t => {
  const h = home(t);
  assert.equal(readPreference(h.env), null);
  fs.writeFileSync(path.join(stateRoot(h.env, true), 'source-preference.json'), JSON.stringify({ schema: 1, kind: 'private' }), { mode: 0o600 });
  assert.equal(readPreference(h.env), null);
  fs.writeFileSync(path.join(stateRoot(h.env), 'source-preference.json'), JSON.stringify({ schema: 1, kind: 'public' }), { mode: 0o600 });
  assert.equal(readPreference(h.env), null);
  fs.writeFileSync(path.join(stateRoot(h.env), 'source-preference.json'), JSON.stringify({ schema: 1, kind: 'other' }), { mode: 0o600 });
  assert.throws(() => readPreference(h.env), /invalid kit source preference/);
});
test('update switches an installed remote pin to the selected local source', async t => {
  const h = home(t);
  writePreference({ schema: 1, kind: 'local', path: h.kit }, h.env);
  const descriptor = resolveTarget({ host: 'codex', scope: 'project', project: h.root, env: h.env });
  const remote = { repository: 'fixture/public-kit', transport: 'curl', channel: 'stable', distribution: 'public' };
  const snapshot = { id: 'a'.repeat(64), tag: 'v1.0.0', files: {} };
  let pin = { schema: 1, descriptor, source: remote, snapshot, state: 'installed', operation: 'install' }, used;
  const deps = {
    readPin: () => pin, writePin(value) { pin = value; }, removePin() {}, lockSources: () => () => {},
    async kitSnapshot(source) { used = source; return { pkg: '/fixture', snapshot, cleanup() {} }; },
    async runControlled(_pkg, _args, callbacks) {
      await callbacks.onPrepare(callbacks.descriptor);
      await callbacks.onResult({ exitCode: 0, complete: true, descriptor: callbacks.descriptor });
      return { code: 0 };
    },
  };
  assert.equal(await kitLifecycle('update', [h.root, '--target', 'codex', '--json'], h.env, deps), 0);
  assert.equal(used.distribution, 'local');
  assert.equal(pin.source.path, h.kit);
  assert.equal(pin.state, 'installed');
});
