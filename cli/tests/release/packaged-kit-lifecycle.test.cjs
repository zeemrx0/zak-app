const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { buildRelease } = require('../../scripts/build/build-release.cjs');
const { unpack } = require('../../src/release/archive-package');
const { runZak } = require('../zak-release-helper.cjs');
const ROOT = path.resolve(__dirname, '../..');
const REPOSITORY = 'fixture-owner/kit-8173';
const TOKEN = 'fixture-account-token-8173';
const KIT_PATH_ERROR = 'set a local kit path: zak kit source <path>';
function fixture(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'zak-kit-packaged-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const home = path.join(root, 'home'), project = path.join(root, 'project');
  for (const dir of [home, project]) fs.mkdirSync(dir);
  const build = buildRelease(ROOT, path.join(root, 'release'));
  const pkg = unpack(fs.readFileSync(path.join(build.out, build.archive)), path.join(root, 'cli'));
  const kit = path.join(root, 'kit'); fs.mkdirSync(path.join(kit, 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(kit, 'src/installer/cli'), { recursive: true });
  fs.writeFileSync(path.join(kit, 'package.json'), JSON.stringify({ name: 'z-agent-kit', version: '9.0.0',
    kitControlProtocol: 1, repository: `https://github.com/${REPOSITORY}.git` }));
  fs.writeFileSync(path.join(kit, 'src/installer/cli/kit-control.js'), '// protocol fixture');
  fs.copyFileSync(path.join(ROOT, 'src/zak/kit-target-locator.js'), path.join(kit, 'target-locator.js'));
  fs.writeFileSync(path.join(kit, 'scripts/ship-kit.cjs'), `
const fs=require('node:fs'),a=process.argv.slice(2);
if(process.env.GH_TOKEN||process.env.GITHUB_TOKEN)process.exit(7);
const host=a[a.indexOf('--target')+1],project=a.find(arg=>!arg.startsWith('-'));
const descriptor=require('../target-locator').resolveTarget({host,scope:'project',project});
process.on('message',m=>{if(m.sequence===1){
const readonly=a.includes('--check')||a.includes('--dry-run'),keep=process.env.FIXTURE_KEEP==='1';
if(!readonly){if(a.includes('--uninstall')){if(!keep)fs.rmSync(descriptor.lockPath,{force:true});}
else {fs.mkdirSync(descriptor.controlRoot,{recursive:true});fs.writeFileSync(descriptor.lockPath,'owned');}}
process.send({schema:1,kind:'result',sequence:2,descriptor,exitCode:0,complete:!keep});
}else process.disconnect();});process.send({schema:1,kind:'prepare',sequence:1,descriptor});`);
  const env = { ...process.env, HOME: home, GH_TOKEN: TOKEN, GITHUB_TOKEN: TOKEN };
  for (const key of ['XDG_DATA_HOME', 'ZAK_ROOT', 'ZAK_RELEASE_API_URL', 'ZAK_RELEASE_BASE_URL',
    'CODEX_HOME', 'CLAUDE_CONFIG_DIR']) delete env[key];
  const cli = path.join(pkg, 'scripts/zak.cjs');
  function command(operation, extra = [], overrides = {}, target = project) {
    return runZak(cli, ['kit', operation, target, '--target', 'claude', '--json', ...extra], { ...env, ...overrides }, project);
  }
  const setSource = () => runZak(cli, ['kit', 'source', kit], env, project);
  return { root, home, project, kit, pkg, env, command, setSource, state: path.join(home, '.local/share/zak-kit-sources'),
    cache: path.join(home, '.local/share/zak-kit-cache') };
}
const receipts = f => fs.existsSync(f.state) ? fs.readdirSync(f.state).filter(name => name !== 'source-preference.json' && name.endsWith('.json')) : [];
function noLeaks(result) { assert.equal(result.output.includes(TOKEN), false, 'diagnostic token canary count'); }
test('packaged local lifecycle pins the local source and preserves read-only state', { timeout: 90000 }, async t => {
  const f = fixture(t);
  const missing = await f.command('install');
  assert.notEqual(missing.code, 0); assert.match(missing.output, new RegExp(KIT_PATH_ERROR));
  assert.equal(receipts(f).length, 0);
  const source = await f.setSource(); assert.equal(source.code, 0, source.output);
  const shown = await runZak(path.join(f.pkg, 'scripts/zak.cjs'), ['kit', 'source'], f.env, f.project);
  assert.equal(shown.output.trim(), `Kit source: ${f.kit}`);
  const install = await f.command('install'); assert.equal(install.code, 0, install.output); noLeaks(install);
  const receipt = path.join(f.state, receipts(f)[0]), before = fs.readFileSync(receipt), pin = JSON.parse(before);
  assert.equal(pin.source.distribution, 'local'); assert.equal(pin.source.path, f.kit); assert.equal(pin.state, 'installed');
  assert.equal(fs.statSync(receipt).mode & 0o777, 0o600);
  const lock = path.join(f.project, '.claude/zak-lock.json'), lockBefore = fs.readFileSync(lock);
  for (const [operation, extra] of [['check', []], ['install', ['--dry-run']], ['uninstall', ['--dry-run']]]) {
    const result = await f.command(operation, extra);
    assert.equal(result.code, 0, result.output); noLeaks(result);
    assert.deepEqual(fs.readFileSync(receipt), before); assert.deepEqual(fs.readFileSync(lock), lockBefore);
  }
  const partial = await f.command('uninstall', [], { FIXTURE_KEEP: '1' });
  assert.equal(partial.code, 2); noLeaks(partial); assert.equal(JSON.parse(fs.readFileSync(receipt)).state, 'cleanup-required');
  const complete = await f.command('uninstall');
  assert.equal(complete.code, 0); noLeaks(complete); assert.equal(receipts(f).length, 0);
  assert.equal(fs.existsSync(lock), false);
});
test('packaged dry-run and removed source flags cannot create pins or touch the target', { timeout: 90000 }, async t => {
  const f = fixture(t), target = path.join(f.root, 'preview'); fs.mkdirSync(target);
  assert.equal((await f.setSource()).code, 0);
  const dry = await f.command('install', ['--dry-run'], {}, target);
  assert.equal(dry.code, 0, dry.output); noLeaks(dry);
  assert.equal(receipts(f).length, 0); assert.equal(fs.existsSync(f.cache), false);
  assert.deepEqual(fs.readdirSync(target), []);
  for (const extra of [['--repo', REPOSITORY], ['--transport', 'curl'], ['--channel', 'beta']]) {
    const result = await f.command('install', extra, {}, target);
    assert.notEqual(result.code, 0); assert.match(result.output, /unknown kit option/); noLeaks(result);
    assert.deepEqual(fs.readdirSync(target), []);
  }
});
test('packaged pins to a remote source keep check and uninstall but require a local path to install or update', { timeout: 90000 }, async t => {
  const f = fixture(t);
  assert.equal((await f.setSource()).code, 0);
  const installed = await f.command('install'); assert.equal(installed.code, 0, installed.output);
  const receipt = path.join(f.state, receipts(f)[0]), pin = JSON.parse(fs.readFileSync(receipt));
  const { cacheRoot } = require('../../src/zak/kit-cache');
  const remote = { repository: REPOSITORY, transport: 'gh', channel: 'stable', distribution: 'private', repositoryId: 11, ownerId: 7 };
  const generation = path.join(cacheRoot(pin.source, f.env), pin.snapshot.id), copy = path.join(cacheRoot(remote, f.env), pin.snapshot.id);
  fs.mkdirSync(path.dirname(copy), { recursive: true, mode: 0o700 }); fs.cpSync(generation, copy, { recursive: true });
  fs.writeFileSync(receipt, JSON.stringify({ ...pin, source: remote }), { mode: 0o600 });
  fs.rmSync(path.join(f.state, 'source-preference.json'));
  const blocked = await f.command('update');
  assert.notEqual(blocked.code, 0); assert.match(blocked.output, new RegExp(KIT_PATH_ERROR));
  assert.equal(JSON.parse(fs.readFileSync(receipt)).source.distribution, 'private');
  const check = await f.command('check'); assert.equal(check.code, 0, check.output); noLeaks(check);
  assert.equal((await f.setSource()).code, 0);
  const updated = await f.command('update'); assert.equal(updated.code, 0, updated.output);
  assert.equal(JSON.parse(fs.readFileSync(receipt)).source.distribution, 'local');
  assert.equal((await f.command('uninstall')).code, 0); assert.equal(receipts(f).length, 0);
});
