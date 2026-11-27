const path = require('node:path');
const ui = require('./cli-ui');
const { localSource, defaultLocalPath } = require('./kit-local-source');
const { readPreference, writePreference } = require('./kit-source-preference');
const USAGE = 'usage: zak kit source <path>';
async function kitSourceCommand(args, env = process.env, dependencies = {}) {
  const deps = { readPreference, writePreference, localSource, defaultLocalPath,
    prompt: () => require('../../dist/installer/update-picker.cjs'),
    tty: !!process.stdin.isTTY && !!process.stdout.isTTY, cwd: process.cwd(), ...dependencies };
  const [value, ...extra] = args;
  if (extra.length || value !== undefined && (!value || value.startsWith('-'))) throw new Error(USAGE);
  const current = deps.readPreference(env);
  let chosen = value;
  if (chosen === undefined) {
    if (!deps.tty) { ui.info(`Kit source: ${current ? current.path : 'not set'}`, { plain: true }); return 0; }
    chosen = await deps.prompt().promptKitPath({ initialValue: current?.path || deps.defaultLocalPath(deps.cwd),
      validate(input) { try { deps.localSource(path.resolve(deps.cwd, input || '')); } catch (error) { return error.message; } } });
    if (chosen === null) return 130;
  }
  const preference = { schema: 1, kind: 'local', path: deps.localSource(path.resolve(deps.cwd, chosen)).path };
  deps.writePreference(preference, env);
  ui.success(`Kit source: ${preference.path}. New installs and \`zak update\` now use it.`, { plain: !deps.tty });
  return 0;
}
module.exports = { kitSourceCommand, USAGE };
