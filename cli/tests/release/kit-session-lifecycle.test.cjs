const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { kitLifecycle } = require('../../src/zak/kit-lifecycle');
const source = { repository: 'fixture/kit', distribution: 'public', transport: 'curl', channel: 'stable' };
const local = { repository: 'fixture/kit', distribution: 'local', transport: 'local', channel: 'stable', path: '/kit' };
test('multi-host lifecycle closes only after every controlled child', async t => {
  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'zak-session-')));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const previous = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY');
  Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
  t.after(() => previous ? Object.defineProperty(process.stdout, 'isTTY', previous) : delete process.stdout.isTTY);
  const events = [];
  const dependencies = {
    readPin: () => null, writePin: () => {}, lockSources: () => () => {},
    readPreference: () => ({ schema: 1, kind: 'local', path: '/kit' }), localSource: () => local,
    kitSnapshot: async () => ({ pkg: '/fixture', snapshot: {}, cleanup() {} }),
    async runControlled(_pkg, _args, callbacks) {
      events.push(callbacks.descriptor.host);
      await callbacks.onPrepare(callbacks.descriptor);
      await callbacks.onResult({ complete: true, exitCode: 0 });
      return { code: 0 };
    },
    finishKitSession: code => events.push(['end', code]),
  };
  assert.equal(await kitLifecycle('install', [home, '--target', 'codex,claude'], { HOME: home }, dependencies), 0);
  assert.deepEqual(events, ['codex', 'claude', ['end', 0]]);
});
test('interactive missing local path reports its diagnostic before closing', async t => {
  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'zak-session-error-')));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  for (const stream of [process.stdin, process.stdout]) {
    const previous = Object.getOwnPropertyDescriptor(stream, 'isTTY');
    Object.defineProperty(stream, 'isTTY', { value: true, configurable: true });
    t.after(() => previous ? Object.defineProperty(stream, 'isTTY', previous) : delete stream.isTTY);
  }
  const events = [];
  t.mock.method(console, 'error', message => events.push(message));
  const dependencies = {
    readPin: descriptor => ({ descriptor, source, state: 'installed', snapshot: {} }),
    readPreference: () => null,
    selectInstalledTargets: async () => { events.push('select'); return { code: 0, targets: ['codex'] }; },
    runControlled: async () => { throw Error('a missing local path must stop before apply'); },
    finishKitSession: code => events.push(['end', code]),
  };
  assert.equal(await kitLifecycle('install', [home], { HOME: home }, dependencies), 1);
  assert.deepEqual(events, ['select', 'zak: set a local kit path: zak kit source <path>', ['end', 1]]);
});
