const fs = require('node:fs');
const HOSTS = ['codex', 'claude'];
// Reads only the optional `follows` field of a host lock. The kit owns the lock and validates it on its own run.
function readFollows(descriptor) {
  try {
    const follows = JSON.parse(fs.readFileSync(descriptor.lockPath, 'utf8'))?.follows;
    return HOSTS.includes(follows) ? follows : null;
  } catch { return null; }
}
// Returns the hosts of one update or check run, sources first. A host whose lock follows a host in the
// run joins it (`expanded`) and carries `follow`. Other operations never expand.
function withFollowers(hosts, descriptorFor, operation, follows = readFollows) {
  if (operation !== 'update' && operation !== 'check') return hosts.map(host => ({ host }));
  const entries = hosts.map(host => ({ host, follow: follows(descriptorFor(host)) }));
  for (let grew = true; grew;) {
    grew = false;
    for (const host of HOSTS) {
      if (entries.some(entry => entry.host === host)) continue;
      const follow = follows(descriptorFor(host));
      if (follow && entries.some(entry => entry.host === follow)) {
        entries.push({ host, follow, expanded: true });
        grew = true;
      }
    }
  }
  // A link to a host outside the run is not a dependency of this run.
  const inRun = new Set(entries.map(entry => entry.host));
  const pending = entries.map(entry => (inRun.has(entry.follow) ? entry : { host: entry.host }));
  const ordered = [];
  while (pending.length) {
    const index = pending.findIndex(entry => !entry.follow || ordered.some(done => done.host === entry.follow));
    ordered.push(...pending.splice(index < 0 ? 0 : index, 1));
  }
  return ordered;
}
module.exports = { withFollowers, readFollows };
