const test = require('node:test');
const assert = require('node:assert/strict');
const { PassThrough } = require('node:stream');
const { stripVTControlCharacters } = require('node:util');
const { selectInstalledTargets } = require('../../src/zak/kit-update-picker');
function fixture() {
  const input = new PassThrough(), output = new PassThrough();
  input.pause(); input.isTTY = true; output.isTTY = true;
  output.columns = 80; output.rows = 24;
  const modes = [];
  input.setRawMode = value => { modes.push(value); input.isRaw = value; };
  let text = '';
  output.on('data', chunk => { text += chunk; });
  return { input, output, modes, text: () => stripVTControlCharacters(text) };
}
test('Clack picker lists only installed hosts and supports multiple choices', async () => {
  const f = fixture();
  const selection = selectInstalledTargets(['codex', 'claude'], f);
  assert.match(f.text(), /❯ ○ Codex/);
  assert.match(f.text(), /○ Claude Code/);
  assert.doesNotMatch(f.text(), /◻|◼|\[ \]|\[\+\]/);
  assert.match(f.text(), /Space: select/);
  assert.match(f.text(), /Claude Code/);
  assert.doesNotMatch(f.text(), /Choose numbers/);
  f.input.write(' \x1b[B \r');
  assert.deepEqual(await selection, { code: 0, targets: ['codex', 'claude'] });
  assert.equal(f.input.listenerCount('keypress'), 0);
  assert.equal(f.output.listenerCount('resize'), 0);
  assert.equal(f.input.isRaw, false);
});
test('all lifecycle operations render circles and use operation-specific cancellation', async () => {
  for (const operation of ['install', 'check', 'uninstall']) {
    const f = fixture();
    const pending = selectInstalledTargets(['codex', 'claude'], { ...f, operation });
    assert.match(f.text(), new RegExp(`Select targets for ${operation}`));
    assert.match(f.text(), /❯ ○ Codex/);
    assert.doesNotMatch(f.text(), /[□☐☑◻◼]/);
    f.input.write(' ');
    assert.match(f.text(), /❯ ● Codex/);
    f.input.write('\x03');
    assert.deepEqual(await pending, { code: 130, targets: [] });
    assert.match(f.text(), new RegExp(`${operation[0].toUpperCase()}${operation.slice(1)} cancelled; no kits changed`));
    assert.equal(f.input.isRaw, false);
  }
});
test('empty confirmation stays active until an installed host is selected', async () => {
  const f = fixture(), pending = selectInstalledTargets(['codex'], f);
  f.input.write('\r');
  await new Promise(resolve => setImmediate(resolve));
  assert.match(f.text(), /select at least one/i);
  f.input.write(' \r');
  assert.deepEqual(await pending, { code: 0, targets: ['codex'] });
});
test('EOF and Ctrl+C cancel and restore stream state', async () => {
  for (const interrupt of [false, true]) {
    const f = fixture(), pending = selectInstalledTargets(['codex'], f);
    if (interrupt) f.input.write('\x03'); else f.input.end();
    assert.deepEqual(await pending, { code: 130, targets: [] });
    assert.equal(f.input.listenerCount('keypress'), 0);
    assert.equal(f.input.listenerCount('end'), 0);
    assert.equal(f.output.listenerCount('resize'), 0);
    assert.equal(f.input.isRaw, false);
    if (interrupt) assert.equal(f.input.isPaused(), true);
    assert.match(f.text(), /└/);
  }
});
test('successful selection continues into the next prompt without a final outro', async () => {
  const f = fixture(), first = selectInstalledTargets(['codex'], f);
  f.input.write(' \r');
  assert.deepEqual(await first, { code: 0, targets: ['codex'] });
  assert.doesNotMatch(f.text(), /Update cancelled/);
  const second = selectInstalledTargets(['claude'], f);
  f.input.write(' \r');
  assert.deepEqual(await second, { code: 0, targets: ['claude'] });
  assert.equal(f.input.listenerCount('keypress'), 0);
});
