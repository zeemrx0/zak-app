const path = require('node:path');
const { stateRoot } = require('./kit-source-pins');
const { readPrivate, writePrivate } = require('./kit-private-state');
const FILE = 'source-preference.json';
// The selected local kit folder applies to new installs and to updates of installed kits.
function validatePreference(value) {
  if (!value || value.schema !== 1 || value.kind !== 'local' ||
      Object.keys(value).some(key => !['schema', 'kind', 'path'].includes(key)) ||
      typeof value.path !== 'string' || !path.isAbsolute(value.path))
    throw new Error('invalid kit source preference');
  return { schema: 1, kind: 'local', path: value.path };
}
// A remote preference stored by an earlier release reads as not set.
function readPreference(env = process.env) {
  const value = readPrivate(path.join(stateRoot(env), FILE));
  if (value === null || value.schema === 1 && ['public', 'private'].includes(value.kind)) return null;
  return validatePreference(value);
}
function writePreference(value, env = process.env) {
  const preference = validatePreference(value);
  writePrivate(path.join(stateRoot(env, true), FILE), preference);
  return preference;
}
function describeSource(source) {
  return source.distribution === 'local' ? `local ${source.path}` : `${source.distribution} ${source.repository}`;
}
module.exports = { validatePreference, readPreference, writePreference, describeSource };
