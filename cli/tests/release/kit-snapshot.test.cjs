const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { cacheRoot } = require('../../src/zak/kit-cache');
const { localSource } = require('../../src/zak/kit-local-source');
const { kitSnapshot, pinnedSnapshot } = require('../../src/zak/kit-snapshot');
function fixture(t, protocol = 1) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'zak-snapshot-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const home = path.join(root, 'home'), kit = path.join(root, 'kit');
  fs.mkdirSync(home);
  fs.mkdirSync(path.join(kit, 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(kit, 'src/installer/cli'), { recursive: true });
  fs.writeFileSync(path.join(kit, 'package.json'), JSON.stringify({ name: 'z-agent-kit', version: '8.0.0',
    kitControlProtocol: protocol, repository: 'https://github.com/fixture/public-kit.git' }));
  fs.writeFileSync(path.join(kit, 'scripts/ship-kit.cjs'), '// fixture');
  fs.writeFileSync(path.join(kit, 'src/installer/cli/kit-control.js'), '// fixture');
  const state = { HOME: home };
  return { state, root, kit, source: protocol === 1 ? localSource(kit) : null };
}
test('read-only fresh snapshots remain transient and never create the cache', async t => {
  const f = fixture(t), handle = await kitSnapshot(f.source, { readonly: true }, f.state);
  assert.equal(fs.existsSync(handle.pkg), true);
  assert.equal(fs.existsSync(cacheRoot(f.source, f.state)), false);
  assert.equal(handle.snapshot.tag, 'v8.0.0');
  handle.cleanup(); assert.equal(fs.existsSync(handle.pkg), false);
});
test('mutating snapshots protect cache receipts and pinned lookup ignores cache head', async t => {
  const f = fixture(t), handle = await kitSnapshot(f.source, {}, f.state);
  const root = cacheRoot(f.source, f.state), receipt = path.join(root, 'cache.json');
  assert.equal(fs.statSync(root).mode & 0o777, 0o700);
  assert.equal(fs.statSync(receipt).mode & 0o777, 0o600);
  fs.writeFileSync(receipt, JSON.stringify({ id: 'f'.repeat(64), tag: 'v99.0.0' }));
  const exact = pinnedSnapshot({ source: f.source, snapshot: handle.snapshot }, f.state);
  assert.equal(exact.pkg, handle.pkg);
});
test('missing or edited pinned generations fail', async t => {
  const f = fixture(t), handle = await kitSnapshot(f.source, {}, f.state);
  const pin = { source: f.source, snapshot: handle.snapshot };
  fs.appendFileSync(path.join(handle.pkg, 'scripts/ship-kit.cjs'), '// edit');
  assert.throws(() => pinnedSnapshot(pin, f.state), /edited/);
  fs.rmSync(path.dirname(handle.pkg), { recursive: true, force: true });
  assert.throws(() => pinnedSnapshot(pin, f.state), /unavailable/);
});
test('pins to a public or private remote still resolve from their cached generation', async t => {
  const f = fixture(t), handle = await kitSnapshot(f.source, {}, f.state);
  for (const remote of [{ repository: 'fixture/public-kit', transport: 'curl', channel: 'stable', distribution: 'public' },
    { repository: 'fixture/public-kit', transport: 'gh', channel: 'stable', distribution: 'private', repositoryId: 42, ownerId: 7 }]) {
    const root = cacheRoot(remote, f.state);
    fs.mkdirSync(root, { recursive: true, mode: 0o700 });
    fs.cpSync(path.dirname(handle.pkg), path.join(root, handle.snapshot.id), { recursive: true });
    const exact = pinnedSnapshot({ source: remote, snapshot: handle.snapshot }, f.state);
    assert.equal(exact.pkg, path.join(root, handle.snapshot.id, 'package'));
  }
});
test('protocol-incompatible kits fail before persistent cache mutation', t => {
  const f = fixture(t, 0);
  assert.throws(() => localSource(f.kit), /not a z-agent-kit checkout/);
  assert.equal(fs.existsSync(path.join(f.state.HOME, '.local/share/zak-kit-cache')), false);
});
