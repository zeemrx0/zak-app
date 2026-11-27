const path = require('node:path');
const { assertNode } = require('../shared/node-runtime');
const { selfUpdate, selfUninstall } = require('./cli-self-management');
const { kitLifecycle } = require('./kit-lifecycle');
const { kitInventory } = require('./kit-inventory');
const { kitSourceCommand } = require('./kit-source-command');
const HELP = `zak — independent CLI and kit management
  zak --version
  zak self-update [--channel stable|beta]
  zak self-uninstall
  zak update [options] (alias for zak kit update)
  zak kit install|update|check|uninstall [options]
  zak kit inventory [project] [--global] [--target codex,claude] --json (read-only item catalog)
  zak kit source [<path>] (no argument: show the path, or prompt in a terminal)

Kit source: a local z-agent-kit folder set with 'zak kit source <path>'. Clone z-agent-kit yourself.
Install and update pack that folder with npm pack, then install it like a release. The channel follows its version.
Check and uninstall use the kit snapshot pinned at install time.
Kit options: [project] --target codex,claude --tier <tiers> --global (-g) --json
Item options: --select <tier/kind/name,...> installs only the listed items and what they require.
  --follow <host> makes one target copy another host's selection and keeps the link. --no-follow stops it.
Update and check on a host also run every host whose lock follows it. An explicit --select or --tier on a follower breaks its link.
self-update never changes installed kits; self-uninstall leaves kits and cache.`;
function kitArgs(operation, args) {
  const mode = { install: [], update: ['--update'], check: ['--check'], uninstall: ['--uninstall'] }[operation];
  if (!mode) throw new Error('expected zak kit install|update|check|uninstall');
  if (args.some(arg => ['--update', '--check', '--uninstall', '--cli'].includes(arg)))
    throw new Error('use the kit subcommand, not a lifecycle/bootstrap flag');
  return [...args, ...mode];
}
async function main(argv, root = path.resolve(__dirname, '../..')) {
  assertNode();
  if (!argv.length || argv.length === 1 && ['--help', '-h'].includes(argv[0])) { console.log(HELP); return 0; }
  if (argv.length === 1 && ['--version', '-v'].includes(argv[0])) { console.log(require(path.join(root, 'package.json')).version); return 0; }
  if (argv[0] === 'update') argv = ['kit', 'update', ...argv.slice(1)];
  const [command, ...args] = argv;
  if (command === 'self-update') return selfUpdate(args);
  if (command === 'self-uninstall') return selfUninstall(args);
  if (command !== 'kit') throw new Error(`unknown command: ${command}`);
  const [operation, ...options] = args;
  if (!operation || operation === '--help') { console.log(HELP); return 0; }
  if (operation === 'source') {
    if (options.includes('--help') || options.includes('-h')) { console.log(HELP); return 0; }
    return kitSourceCommand(options);
  }
  if (operation === 'inventory') {
    if (options.includes('--help') || options.includes('-h')) { console.log(HELP); return 0; }
    return kitInventory(options);
  }
  kitArgs(operation, options);
  if (options.includes('--help') || options.includes('-h')) { console.log(HELP); return 0; }
  return kitLifecycle(operation, options);
}
module.exports = { main, kitArgs, HELP };
