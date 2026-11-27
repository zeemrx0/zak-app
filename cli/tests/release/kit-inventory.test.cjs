const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { kitInventory, assertSelectionProtocol } = require('../../src/zak/kit-inventory');
const KIT_PATH_ERROR = { message: 'set a local kit path: zak kit source <path>' };
const HOME = { HOME: '/h' };
function fixture(t, { protocol = 1, status = 0, stdout = '{"schema":1}\n' } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zak-inventory-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(protocol ? { kitSelectionProtocol: protocol } : {}));
  const calls = { snapshot: [], spawn: [], cleanup: 0, locks: 0, pins: [] };
  const deps = {
    preference: { schema: 1, kind: 'local', path: '/preferred' },
    pin: null,
    resolveTarget: ({ host }) => ({ host }),
    readPreference() { return deps.preference; },
    readPin(descriptor) { calls.pins.push(descriptor.host); return deps.pin; },
    localSource(p) { calls.local = p; return { distribution: 'local', path: p }; },
    kitSnapshot(source, options) { calls.snapshot.push(options); return { pkg: dir, snapshot: { tag: 'v1.2.3' }, cleanup() { calls.cleanup++; } }; },
    lockSources() { calls.locks++; },
    spawnSync(exe, args, options) { calls.spawn.push({ exe, args, options }); return { status, stdout, stderr: '' }; },
  };
  return { dir, calls, deps };
}
function capture(t) {
  const out = [], write = process.stdout.write;
  process.stdout.write = chunk => { out.push(String(chunk)); return true; };
  t.after(() => { process.stdout.write = write; });
  return out;
}
test('inventory runs the kit read-only from the preferred local folder and prints its output', async t => {
  const f = fixture(t), out = capture(t);
  const environment = { ...HOME, GH_TOKEN: 'x', GITHUB_TOKEN: 'y', ZAK_KIT_CONTROL: 'apply' };
  assert.equal(await kitInventory(['/project', '--target', 'claude,codex', '--json'], environment, f.deps), 0);
  assert.equal(f.calls.local, '/preferred');
  assert.deepEqual(f.calls.snapshot, [{ readonly: true }]);
  assert.equal(f.calls.locks, 0); assert.equal(f.calls.cleanup, 1);
  const [{ args, options }] = f.calls.spawn;
  assert.deepEqual(args.slice(1), [path.resolve('/project'), '--inventory', '--target', 'claude,codex', '--json']);
  assert.match(args[0], /scripts[\\/]ship-kit\.cjs$/);
  assert.deepEqual(options.env, HOME);
  assert.deepEqual(out, ['{"schema":1}\n']);
});
test('inventory uses the local folder of a host pin when no preference is set and honors global scope', async t => {
  const f = fixture(t); capture(t);
  f.deps.preference = null; f.deps.pin = { source: { distribution: 'local', path: '/pinned' } };
  assert.equal(await kitInventory(['--global', '--json'], HOME, f.deps), 0);
  assert.equal(f.calls.local, '/pinned');
  assert.deepEqual(f.calls.pins, ['codex', 'claude']);
  assert.deepEqual(f.calls.spawn[0].args.slice(1), ['--global', '--inventory', '--target', 'codex,claude', '--json']);
});
test('inventory without any local path fails before reading the kit', async t => {
  const f = fixture(t);
  f.deps.preference = null; f.deps.pin = { source: { distribution: 'public' } };
  await assert.rejects(kitInventory(['--json'], HOME, f.deps), KIT_PATH_ERROR);
  assert.deepEqual(f.calls.snapshot, []);
});
test('a non-zero kit exit code is returned', async t => {
  const f = fixture(t, { status: 3, stdout: '' }); capture(t);
  assert.equal(await kitInventory(['--json'], HOME, f.deps), 3);
  assert.equal(f.calls.cleanup, 1);
});
test('a kit without item selection is refused and its snapshot is cleaned up', async t => {
  for (const protocol of [0, 2]) {
    const f = fixture(t, { protocol });
    await assert.rejects(kitInventory(['--json'], HOME, f.deps), /does not support item selection; update the kit folder/);
    assert.deepEqual(f.calls.spawn, []); assert.equal(f.calls.cleanup, 1);
  }
});
test('inventory rejects options that belong to other operations', async t => {
  const f = fixture(t);
  await assert.rejects(kitInventory(['--select', 'a/skills/z-x'], HOME, f.deps), /unknown kit inventory option/);
  await assert.rejects(kitInventory(['--tier', 'general'], HOME, f.deps), /unknown kit inventory option/);
});
test('the protocol check names the kit tag', t => {
  const f = fixture(t, { protocol: 0 });
  assert.throws(() => assertSelectionProtocol(f.dir, 'v9.9.9'), /kit source v9\.9\.9 does not support item selection/);
  assert.throws(() => assertSelectionProtocol(path.join(f.dir, 'missing'), 'v9.9.9'), /does not support item selection/);
});
