const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { kitLifecycle, targetArgs } = require('../../src/zak/kit-lifecycle');
const { resolveTarget } = require('../../src/zak/kit-target-locator');
const source = { repository: 'fixture/public-kit', transport: 'curl', channel: 'stable', distribution: 'public' };
const snapshot = { id: 'a'.repeat(64), tag: 'v1.0.0', files: {} };
const localKit = { repository: 'fixture/public-kit', transport: 'local', channel: 'stable', distribution: 'local', path: '/kit' };
const KIT_PATH_ERROR = { message: 'set a local kit path: zak kit source <path>' };
function fixture(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'zak-lifecycle-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const env = { HOME: root }, pins = new Map(), events = [];
  const key = descriptor => JSON.stringify(descriptor);
  const descriptor = resolveTarget({ host: 'claude', scope: 'project', project: root, env });
  const handle = { pkg: '/fixture', snapshot, cleanup() { events.push('cleanup'); } };
  const deps = {
    preference: { schema: 1, kind: 'local', path: '/kit' },
    readPin(d) { return pins.get(key(d)) || null; },
    writePin(pin) { pins.set(key(pin.descriptor), pin); events.push(pin.state); },
    removePin(d) { pins.delete(key(d)); events.push('removed'); },
    lockSources() { events.push('lock'); return () => events.push('unlock'); },
    readPreference() { return deps.preference; },
    localSource() { events.push('local'); return localKit; },
    kitSnapshot() { events.push('download'); return handle; },
    pinnedSnapshot() { events.push('exact'); return handle; },
    async runControlled(pkg, args, callbacks) {
      events.push('prepare'); await callbacks.onPrepare(callbacks.descriptor);
      events.push('mutate'); await callbacks.onResult({ exitCode: 0, complete: true, descriptor: callbacks.descriptor });
      return { code: 0 };
    },
  };
  function pin(overrides = {}) { pins.set(key(descriptor), { schema: 1, descriptor, source, snapshot,
    state: 'installed', operation: 'install', ...overrides }); }
  function run(operation, args = [root, '--target', 'claude']) {
    return kitLifecycle(operation, args, env, deps);
  }
  return { root, env, descriptor, pins, events, deps, pin, run };
}
test('target parser rejects ambiguous projects and removed source flags', () => {
  assert.throws(() => targetArgs(['one', 'two']), /one kit project/);
  assert.throws(() => targetArgs(['/project', '--global']), /repository path/);
  for (const flag of ['--channel', '--transport', '--repo']) assert.throws(() => targetArgs([flag, 'value']), /unknown kit option/);
});
test('new install writes pending intent before mutation and commits independently', async t => {
  const f = fixture(t);
  assert.equal(await f.run('install'), 0);
  assert.ok(f.events.indexOf('pending') < f.events.indexOf('mutate'));
  assert.ok(f.events.includes('installed')); assert.equal(f.events.at(-1), 'unlock');
});
test('check and uninstall use the pinned snapshot while install and update re-pin to the local source', async t => {
  for (const operation of ['install', 'update', 'check', 'uninstall']) {
    const f = fixture(t); f.pin();
    assert.equal(await f.run(operation), 0);
    const local = operation === 'install' || operation === 'update';
    assert.ok(f.events.includes(local ? 'download' : 'exact'), operation);
    assert.equal(f.events.includes(local ? 'exact' : 'download'), false, operation);
    if (local) assert.equal([...f.pins.values()][0].source.distribution, 'local');
  }
});
test('install and update without a local path fail while check and uninstall keep the pinned remote source', async t => {
  for (const distribution of ['public', 'private']) {
    const remote = distribution === 'public' ? source
      : { ...source, distribution, transport: 'gh', repositoryId: 42, ownerId: 7 };
    for (const operation of ['install', 'update', 'check', 'uninstall']) {
      const f = fixture(t); f.deps.preference = null; f.pin({ source: remote });
      if (operation === 'install' || operation === 'update') {
        await assert.rejects(f.run(operation), KIT_PATH_ERROR);
        assert.equal(f.events.includes('download'), false);
        assert.equal(f.events.includes('mutate'), false);
      } else {
        assert.equal(await f.run(operation), 0);
        assert.ok(f.events.includes('exact'));
      }
    }
  }
  const fresh = fixture(t); fresh.deps.preference = null;
  await assert.rejects(fresh.run('install'), KIT_PATH_ERROR);
  assert.deepEqual(fresh.events, ['lock', 'unlock']);
});
test('a saved kit folder that no longer exists reports its own error before any state change', async t => {
  for (const operation of ['install', 'update']) {
    const f = fixture(t); f.pin();
    f.deps.localSource = () => { throw new Error('local kit folder not found: /kit'); };
    await assert.rejects(f.run(operation), { message: 'local kit folder not found: /kit' });
    for (const event of ['download', 'pending', 'mutate']) assert.equal(f.events.includes(event), false);
    assert.equal(f.events.at(-1), 'unlock');
  }
});
test('a local pin without a stored preference keeps updating from its own folder', async t => {
  const f = fixture(t); f.deps.preference = null; f.pin({ source: localKit });
  assert.equal(await f.run('update'), 0);
  assert.ok(f.events.includes('download'));
});
test('check and dry-run never write source state or acquire persistent locks', async t => {
  for (const [operation, dry] of [['check', false], ['install', true], ['update', true], ['uninstall', true]]) {
    const f = fixture(t); f.pin();
    assert.equal(await f.run(operation, [f.root, '--target', 'claude', ...(dry ? ['--dry-run'] : [])]), 0);
    assert.equal(f.events.includes('lock'), false);
    assert.equal(f.events.includes('pending'), false); assert.equal(f.events.includes('removed'), false);
  }
});
test('CLI-owned circular selection preserves apply flags in project and global scope', async t => {
  for (const stream of [process.stdin, process.stdout]) {
    const previous = Object.getOwnPropertyDescriptor(stream, 'isTTY');
    Object.defineProperty(stream, 'isTTY', { value: true, configurable: true });
    t.after(() => previous ? Object.defineProperty(stream, 'isTTY', previous) : delete stream.isTTY);
  }
  for (const global of [false, true]) {
    for (const [operation, flag] of [['install', null], ['update', '--update'], ['check', '--check'], ['uninstall', '--uninstall']]) {
      const f = fixture(t), calls = [];
      const descriptor = resolveTarget({ host: 'claude', scope: global ? 'global' : 'project', project: f.root, env: f.env });
      f.pins.set(JSON.stringify(descriptor), { schema: 1, descriptor, source, snapshot, state: 'installed', operation: 'install' });
      const normal = f.deps.runControlled;
      f.deps.runControlled = async (pkg, args, callbacks) => {
        calls.push({ args, mode: callbacks.mode || 'apply' });
        if (callbacks.mode === 'select') {
          assert.equal(f.events.includes('pending'), false);
          assert.equal(f.events.includes('mutate'), false);
          return { code: 0, targets: ['claude'] };
        }
        return normal(pkg, args, callbacks);
      };
      f.deps.selectInstalledTargets = async (hosts, options = {}) => {
        assert.deepEqual(hosts, operation === 'update' ? ['claude'] : ['codex', 'claude']);
        assert.equal(options.operation || 'update', operation);
        assert.equal(f.events.includes('pending'), false);
        return { code: 0, targets: ['claude'] };
      };
      const args = [global ? '--global' : f.root, '--tier', 'general'];
      assert.equal(await f.run(operation, args), 0);
      assert.deepEqual(calls, [
        { args: [...args, '--target', 'claude', ...(flag ? [flag, ...(['update', 'uninstall'].includes(operation) ? ['--force'] : [])] : [])], mode: 'apply' },
      ]);
    }
  }
});
test('cancelled interactive update does not apply or write pending state', async t => {
  for (const stream of [process.stdin, process.stdout]) {
    const previous = Object.getOwnPropertyDescriptor(stream, 'isTTY');
    Object.defineProperty(stream, 'isTTY', { value: true, configurable: true });
    t.after(() => previous ? Object.defineProperty(stream, 'isTTY', previous) : delete stream.isTTY);
  }
  const f = fixture(t); f.pin();
  f.deps.selectInstalledTargets = async hosts => {
    assert.deepEqual(hosts, ['claude']);
    return { code: 130, targets: [] };
  };
  assert.equal(await f.run('update', [f.root]), 130);
  assert.equal(f.events.includes('pending'), false);
  assert.equal(f.events.includes('mutate'), false);
  assert.equal(f.events.at(-1), 'unlock');
});
test('all target pickers cancel before source access or mutation', async t => {
  interactive(t);
  for (const operation of ['install', 'check', 'uninstall']) {
    const f = fixture(t);
    f.deps.selectInstalledTargets = async () => ({ code: 130, targets: [] });
    assert.equal(await f.run(operation, [f.root]), 130);
    for (const event of ['exact', 'local', 'download', 'pending', 'mutate'])
      assert.equal(f.events.includes(event), false, `${operation}: ${event}`);
    if (operation !== 'check') assert.equal(f.events.at(-1), 'unlock');
  }
});
test('invalid target selections cannot cross the apply boundary', async t => {
  interactive(t);
  for (const targets of [null, [], ['claude', 'claude'], ['unknown']]) {
    const f = fixture(t);
    f.deps.selectInstalledTargets = async () => ({ code: 0, targets });
    await assert.rejects(f.run('uninstall', [f.root]), /invalid kit selection/);
    assert.equal(f.events.includes('mutate'), false);
    assert.equal(f.events.at(-1), 'unlock');
  }
});
test('missing pins and legacy targets stop before downloads', async t => {
  const f = fixture(t);
  await assert.rejects(f.run('check'), /no trusted/);
  fs.mkdirSync(f.descriptor.controlRoot);
  fs.writeFileSync(path.join(f.descriptor.controlRoot, 'z-project.json'), '{}');
  await assert.rejects(f.run('install'), /legacy/);
  assert.equal(f.events.includes('download'), false);
});
test('empty post-uninstall roots and unrelated host configuration are not legacy kit evidence', async t => {
  const f = fixture(t); fs.mkdirSync(f.descriptor.controlRoot);
  fs.writeFileSync(path.join(f.descriptor.controlRoot, 'auth.json'), '{"fixture":true}');
  assert.equal(await f.run('install'), 0);
  assert.equal(fs.readFileSync(path.join(f.descriptor.controlRoot, 'auth.json'), 'utf8'), '{"fixture":true}');
});
test('reinstall accepts empty namespaced directory trees after successful uninstall', async t => {
  for (const host of ['codex', 'claude']) {
    for (const scope of ['project', 'global']) {
      const f = fixture(t);
      const descriptor = resolveTarget({ host, scope, project: f.root, env: f.env });
      const args = [scope === 'global' ? '--global' : f.root, '--target', host];
      const skill = path.join(descriptor.skillsRoot, 'z-html-style', 'references', 'styles');
      fs.mkdirSync(skill, { recursive: true });
      f.pins.set(JSON.stringify(descriptor), { schema: 1, descriptor, source, snapshot, state: 'installed', operation: 'install' });
      assert.equal(await f.run('uninstall', args), 0);
      assert.equal(f.pins.size, 0);
      assert.equal(await f.run('install', args), 0, `${host} ${scope}`);
      assert.ok(fs.statSync(skill).isDirectory());
    }
  }
});
test('legacy inspection rejects retained files and symlinks inside namespaced trees', async t => {
  for (const kind of ['file', 'hidden-file', 'empty-link', 'dangling-link']) {
    const f = fixture(t);
    const dir = path.join(f.descriptor.skillsRoot, 'z-html-style', 'references');
    fs.mkdirSync(dir, { recursive: true });
    if (kind.endsWith('link')) {
      const target = path.join(f.root, 'outside');
      if (kind === 'empty-link') fs.mkdirSync(target);
      fs.symlinkSync(target, path.join(dir, 'link'));
    } else fs.writeFileSync(path.join(dir, kind === 'hidden-file' ? '.retained' : 'style.md'), '');
    await assert.rejects(f.run('install'), /legacy/);
    assert.equal(f.events.includes('download'), false);
  }
});
test('legacy inspection fails closed on excessive depth and preserves lock and startup evidence', async t => {
  for (const kind of ['deep-tree', 'lock', 'startup']) {
    const f = fixture(t);
    fs.mkdirSync(f.descriptor.controlRoot, { recursive: true });
    if (kind === 'deep-tree') fs.mkdirSync(path.join(f.descriptor.skillsRoot, 'z-empty', ...Array(66).fill('nested')), { recursive: true });
    else fs.writeFileSync(kind === 'lock' ? f.descriptor.lockPath : path.join(f.descriptor.controlRoot, 'AGENTS.md'), 'z-agent-kit');
    await assert.rejects(f.run('install'), /legacy/);
    assert.equal(f.events.includes('download'), false);
  }
});
test('interruption preserves pending exact generation for retry', async t => {
  const f = fixture(t);
  const normal = f.deps.runControlled;
  f.deps.runControlled = async (_pkg, _args, callbacks) => { await callbacks.onPrepare(callbacks.descriptor); throw Error('interrupted'); };
  assert.equal(await f.run('install'), 1);
  assert.equal([...f.pins.values()][0].state, 'pending');
  f.deps.runControlled = normal;
  assert.equal(await f.run('install'), 0); assert.ok(f.events.includes('exact'));
});
test('partial uninstall retains cleanup state and a successful retry removes it', async t => {
  const f = fixture(t); f.pin(); const normal = f.deps.runControlled;
  f.deps.runControlled = async (_pkg, _args, callbacks) => {
    await callbacks.onPrepare(callbacks.descriptor);
    await callbacks.onResult({ descriptor: callbacks.descriptor, exitCode: 2, complete: false }); return { code: 2 };
  };
  assert.equal(await f.run('uninstall'), 2); assert.equal([...f.pins.values()][0].state, 'cleanup-required');
  f.deps.runControlled = normal; assert.equal(await f.run('uninstall'), 0); assert.equal(f.pins.size, 0);
});
function interactive(t) {
  for (const stream of [process.stdin, process.stdout]) {
    const previous = Object.getOwnPropertyDescriptor(stream, 'isTTY');
    Object.defineProperty(stream, 'isTTY', { value: true, configurable: true });
    t.after(() => previous ? Object.defineProperty(stream, 'isTTY', previous) : delete stream.isTTY);
  }
}
function seed(f, host, scope, state = 'installed', operation = 'install') {
  const descriptor = resolveTarget({ host, scope, project: f.root, env: f.env });
  f.pins.set(JSON.stringify(descriptor), { schema: 1, descriptor, source, snapshot, state, operation });
}
test('automatic update lists only installed hosts within the requested scope', async t => {
  interactive(t);
  for (const [scope, state, operation, expected] of [
    ['project', 'installed', 'install', ['codex', 'claude']],
    ['global', 'pending', 'update', ['codex']],
    ['project', 'cleanup-required', 'uninstall', ['codex']],
  ]) {
    const f = fixture(t), calls = [];
    seed(f, 'codex', scope); seed(f, 'claude', scope, state, operation);
    seed(f, 'claude', scope === 'global' ? 'project' : 'global');
    f.deps.pinnedSnapshot = () => { throw Error('old picker must not run'); };
    f.deps.selectInstalledTargets = async hosts => {
      assert.deepEqual(hosts, expected);
      return { code: 0, targets: hosts };
    };
    const normal = f.deps.runControlled;
    f.deps.runControlled = async (pkg, args, callbacks) => {
      assert.notEqual(callbacks.mode, 'select'); calls.push(args);
      return normal(pkg, args, callbacks);
    };
    const args = [scope === 'global' ? '--global' : f.root, '--tier', 'general', '--force'];
    assert.equal(await f.run('update', args), 0);
    assert.deepEqual(calls, expected.map(host => [...args, '--target', host, '--update']));
  }
});
test('empty update scope is a no-op without locking, prompting or fetching', async t => {
  const f = fixture(t), messages = [], previous = console.log;
  console.log = message => messages.push(message); t.after(() => { console.log = previous; });
  seed(f, 'codex', 'global'); seed(f, 'codex', 'project', 'pending', 'update');
  seed(f, 'claude', 'project', 'cleanup-required', 'uninstall');
  f.deps.selectInstalledTargets = () => { throw Error('must not prompt'); };
  assert.equal(await f.run('update', [f.root, '--json']), 0);
  assert.deepEqual(messages, ['No installed kits to update']);
  assert.deepEqual(f.events, []);
});
test('automatic dry-run selects installed targets but never writes or locks', async t => {
  interactive(t); const f = fixture(t); f.pin();
  f.deps.selectInstalledTargets = async hosts => ({ code: 0, targets: hosts });
  assert.equal(await f.run('update', [f.root, '--dry-run']), 0);
  assert.equal(f.events.includes('lock'), false); assert.equal(f.events.includes('pending'), false);
});
test('populated automatic update still requires explicit targets in JSON mode', async t => {
  interactive(t); const f = fixture(t); f.pin();
  await assert.rejects(f.run('update', [f.root, '--json']), /choose hosts with --target/);
  assert.deepEqual(f.events, []);
});
test('explicit target resumes an interrupted update without the installed-only picker', async t => {
  const f = fixture(t); f.pin({ state: 'pending', operation: 'update' });
  f.deps.selectInstalledTargets = () => { throw Error('must not prompt'); };
  assert.equal(await f.run('update'), 0);
  assert.ok(f.events.includes('exact')); assert.equal(f.events.includes('download'), false);
});
test('automatic update fails closed on unsafe receipts or invalid selection', async t => {
  interactive(t); const f = fixture(t);
  f.deps.readPin = () => { throw Error('invalid installed source receipt'); };
  await assert.rejects(f.run('update', [f.root]), /invalid installed source receipt/);
  assert.deepEqual(f.events, []);
  const other = fixture(t); other.pin();
  other.deps.selectInstalledTargets = async () => ({ code: 0, targets: ['codex'] });
  await assert.rejects(other.run('update', [other.root]), /invalid installed kit selection/);
  assert.deepEqual(other.events, ['lock', 'unlock']);
});
test('mixed-source targets use their own generations and preserve a successful target on failure', async t => {
  const f = fixture(t); f.pin();
  const codex = resolveTarget({ host: 'codex', scope: 'project', project: f.root, env: f.env });
  f.pins.set(JSON.stringify(codex), { schema: 1, descriptor: codex,
    source: { ...source, repository: 'fixture/other-kit' }, snapshot: { ...snapshot, id: 'b'.repeat(64) }, state: 'installed', operation: 'install' });
  const generations = []; f.deps.pinnedSnapshot = pin => { generations.push(pin.snapshot.id); return { pkg: '/fixture', snapshot: pin.snapshot, cleanup() {} }; };
  const normal = f.deps.runControlled;
  f.deps.runControlled = (pkg, args, callbacks) => callbacks.descriptor.host === 'codex' ? Promise.reject(Error('failed')) : normal(pkg, args, callbacks);
  assert.equal(await f.run('uninstall', [f.root, '--target', 'claude,codex']), 1);
  assert.deepEqual(generations, ['a'.repeat(64), 'b'.repeat(64)]); assert.equal(f.pins.size, 1);
});
test('removed OMP and Pi targets fail with a clear message and a supported-target list', () => {
  for (const [host, name, dir] of [['omp', 'OMP', '.omp/'], ['pi', 'Pi', '.pi/']]) {
    for (const value of [host, `claude,${host}`]) {
      assert.throws(() => targetArgs(['--target', value]),
        { message: `${name} support was removed; supported targets: claude, codex. Remove an existing ${dir} install with an earlier zak/zAgentKit release or delete it manually.` });
    }
  }
  assert.throws(() => targetArgs(['--target', 'unknown']), /invalid kit targets/);
});
test('removed targets stop before any lock, download, or prompt', async t => {
  for (const host of ['omp', 'pi']) {
    const f = fixture(t);
    await assert.rejects(f.run('install', [f.root, '--target', host]), /support was removed; supported targets: claude, codex/);
    assert.deepEqual(f.events, []);
  }
});
function selectionPackage(t, protocol) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zak-selection-pkg-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(protocol ? { kitSelectionProtocol: protocol } : {}));
  return dir;
}
function follower(f, follows = 'claude') {
  seed(f, 'codex', 'project');
  const codex = resolveTarget({ host: 'codex', scope: 'project', project: f.root, env: f.env });
  fs.mkdirSync(path.dirname(codex.lockPath), { recursive: true });
  fs.writeFileSync(codex.lockPath, JSON.stringify({ follows }));
}
function recordCalls(f) {
  const calls = [], normal = f.deps.runControlled;
  f.deps.runControlled = (pkg, args, callbacks) => { calls.push(args); return normal(pkg, args, callbacks); };
  return calls;
}
test('target parser reads item selection flags and validates them', () => {
  const parsed = targetArgs(['/p', '--target', 'claude', '--select', 'a/skills/z-x', '--follow', 'codex']);
  assert.equal(parsed.selection, true);
  assert.deepEqual(parsed.rest, ['/p', '--select', 'a/skills/z-x', '--follow', 'codex']);
  assert.equal(targetArgs(['--no-follow']).selection, true);
  assert.equal(targetArgs(['--tier', 'general']).selection, false);
  assert.throws(() => targetArgs(['--select']), /missing kit select value/);
  assert.throws(() => targetArgs(['--select', '--json']), /missing kit select value/);
  assert.throws(() => targetArgs(['--target', 'claude', '--follow']), /missing kit follow value/);
  assert.throws(() => targetArgs(['--target', 'claude', '--follow', 'omp']), /invalid kit follow host/);
  assert.throws(() => targetArgs(['--target', 'claude,codex', '--follow', 'claude']), /exactly one --target/);
  assert.throws(() => targetArgs(['--follow', 'claude']), /exactly one --target/);
});
test('selection flags reach the kit unchanged before the target and operation flags', async t => {
  const f = fixture(t); f.pin();
  f.deps.kitSnapshot = () => ({ pkg: selectionPackage(t, 1), snapshot, cleanup() {} });
  const calls = recordCalls(f);
  assert.equal(await f.run('update', [f.root, '--target', 'claude', '--select', 'a/skills/z-x,a/rules/z-y']), 0);
  assert.deepEqual(calls, [[f.root, '--select', 'a/skills/z-x,a/rules/z-y', '--target', 'claude', '--update', '--force']]);
});
test('a kit without item selection is refused before any pin is written', async t => {
  for (const flags of [['--select', 'a/skills/z-x'], ['--no-follow']]) {
    for (const protocol of [undefined, 2]) {
      const f = fixture(t); f.pin();
      f.deps.kitSnapshot = () => ({ pkg: selectionPackage(t, protocol), snapshot, cleanup() { f.events.push('cleanup'); } });
      const calls = recordCalls(f);
      assert.equal(await f.run('update', [f.root, '--target', 'claude', ...flags]), 1);
      assert.deepEqual(calls, []);
      for (const event of ['pending', 'prepare', 'mutate']) assert.equal(f.events.includes(event), false);
      assert.ok(f.events.includes('cleanup'));
    }
  }
});
test('update on a source also updates a host that follows it, after the source', async t => {
  const f = fixture(t); f.pin(); follower(f);
  f.deps.kitSnapshot = () => ({ pkg: selectionPackage(t, 1), snapshot, cleanup() {} });
  const calls = recordCalls(f);
  assert.equal(await f.run('update', [f.root, '--target', 'claude', '--select', 'a/skills/z-x', '--json']), 0);
  assert.deepEqual(calls, [
    [f.root, '--select', 'a/skills/z-x', '--json', '--target', 'claude', '--update', '--force'],
    [f.root, '--select', 'a/skills/z-x', '--json', '--follow', 'claude', '--target', 'codex', '--update', '--force']]);
});
test('--no-follow on a source is not forwarded to the host that follows it', async t => {
  const f = fixture(t); f.pin(); follower(f);
  f.deps.kitSnapshot = () => ({ pkg: selectionPackage(t, 1), snapshot, cleanup() {} });
  const calls = recordCalls(f);
  assert.equal(await f.run('update', [f.root, '--target', 'claude', '--no-follow', '--json']), 0);
  assert.deepEqual(calls, [
    [f.root, '--no-follow', '--json', '--target', 'claude', '--update', '--force'],
    [f.root, '--json', '--follow', 'claude', '--target', 'codex', '--update', '--force']]);
});
test('check on a source checks a follower of an older kit without a follow flag', async t => {
  const f = fixture(t); f.pin(); follower(f);
  const calls = recordCalls(f);
  assert.equal(await f.run('check', [f.root, '--target', 'claude', '--json']), 0);
  assert.deepEqual(calls, [
    [f.root, '--json', '--target', 'claude', '--check'],
    [f.root, '--json', '--target', 'codex', '--check']]);
});
test('check on a source passes --follow to a follower whose kit supports it, also with a tier list', async t => {
  const f = fixture(t); f.pin(); follower(f);
  f.deps.pinnedSnapshot = () => ({ pkg: selectionPackage(t, 1), snapshot, cleanup() {} });
  const calls = recordCalls(f);
  assert.equal(await f.run('check', [f.root, '--target', 'claude', '--tier', 'unity', '--json']), 0);
  assert.deepEqual(calls, [
    [f.root, '--tier', 'unity', '--json', '--target', 'claude', '--check'],
    [f.root, '--tier', 'unity', '--json', '--follow', 'claude', '--target', 'codex', '--check']]);
});
test('update with a tier list on a source runs its follower with --follow', async t => {
  const f = fixture(t); f.pin(); follower(f);
  f.deps.kitSnapshot = () => ({ pkg: selectionPackage(t, 1), snapshot, cleanup() {} });
  const calls = recordCalls(f);
  assert.equal(await f.run('update', [f.root, '--target', 'claude', '--tier', 'unity', '--json']), 0);
  assert.deepEqual(calls[1], [f.root, '--tier', 'unity', '--json', '--follow', 'claude', '--target', 'codex', '--update', '--force']);
});
test('install and uninstall never expand to followers', async t => {
  for (const operation of ['install', 'uninstall']) {
    const f = fixture(t); f.pin(); follower(f);
    const calls = recordCalls(f);
    assert.equal(await f.run(operation, [f.root, '--target', 'claude']), 0);
    assert.equal(calls.length, 1, operation);
  }
});
test('a follower without an installed pin is skipped with a notice', async t => {
  const f = fixture(t); f.pin(); follower(f);
  const codex = resolveTarget({ host: 'codex', scope: 'project', project: f.root, env: f.env });
  f.pins.delete(JSON.stringify(codex));
  const calls = recordCalls(f), written = [], write = process.stderr.write;
  process.stderr.write = chunk => { written.push(String(chunk)); return true; };
  t.after(() => { process.stderr.write = write; });
  assert.equal(await f.run('check', [f.root, '--target', 'claude', '--json']), 0);
  assert.equal(calls.length, 1);
  assert.deepEqual(written, ['zak kit (codex): follows claude but has no installed pin; skipped\n']);
});
