const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { withFollowers, readFollows } = require('../../src/zak/kit-followers');
const descriptorFor = host => ({ host, lockPath: host });
const follows = map => descriptor => map[descriptor.host] || null;
test('a follower of a named source joins after it and carries the source', () => {
  assert.deepEqual(withFollowers(['claude'], descriptorFor, 'update', follows({ codex: 'claude' })),
    [{ host: 'claude' }, { host: 'codex', follow: 'claude', expanded: true }]);
  assert.deepEqual(withFollowers(['claude'], descriptorFor, 'check', follows({ codex: 'claude' })).map(entry => entry.host),
    ['claude', 'codex']);
});
test('both hosts named puts the source first and marks the follower', () => {
  assert.deepEqual(withFollowers(['codex', 'claude'], descriptorFor, 'update', follows({ codex: 'claude' })),
    [{ host: 'claude' }, { host: 'codex', follow: 'claude' }]);
});
test('a named follower whose source is outside the run is not a dependency of the run', () => {
  assert.deepEqual(withFollowers(['codex'], descriptorFor, 'update', follows({ codex: 'claude' })), [{ host: 'codex' }]);
});
test('hosts without a link are not expanded', () => {
  assert.deepEqual(withFollowers(['claude'], descriptorFor, 'update', follows({})), [{ host: 'claude' }]);
});
test('install and uninstall never expand', () => {
  for (const operation of ['install', 'uninstall'])
    assert.deepEqual(withFollowers(['claude'], descriptorFor, operation, follows({ codex: 'claude' })), [{ host: 'claude' }]);
});
test('a lock that is missing, unreadable or names another value reads as no link', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zak-followers-'));
  try {
    const lock = path.join(dir, 'lock.json');
    assert.equal(readFollows({ lockPath: lock }), null);
    fs.writeFileSync(lock, '{ not json');
    assert.equal(readFollows({ lockPath: lock }), null);
    fs.writeFileSync(lock, JSON.stringify({ follows: 'omp' }));
    assert.equal(readFollows({ lockPath: lock }), null);
    fs.writeFileSync(lock, JSON.stringify({ follows: 'claude', tiers: ['general'] }));
    assert.equal(readFollows({ lockPath: lock }), 'claude');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
