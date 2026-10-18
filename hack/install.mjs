import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.argv.length !== 2) throw new Error('Installation does not accept modes or direct-copy options');
const { OMNIVIEW_WORKSPACE_FILE, OMNIVIEW_STATE_DIR, OMNIVIEW_DEV_CLI } = process.env;
if (!OMNIVIEW_WORKSPACE_FILE || !OMNIVIEW_STATE_DIR || !OMNIVIEW_DEV_CLI) {
  throw new Error('Installation requires explicit OMNIVIEW_WORKSPACE_FILE, OMNIVIEW_STATE_DIR and OMNIVIEW_DEV_CLI; production fallback is forbidden');
}
const source = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Only the live host may validate the selected source, stop/rebind its managed
// generation and commit an install transaction. Never copy into its state tree.
const result = spawnSync(path.resolve(OMNIVIEW_DEV_CLI), [
  'plugin', 'dev', 'link', '--workspace', OMNIVIEW_WORKSPACE_FILE,
  '--path', source, '--wait', '--json',
], { stdio: 'inherit', env: { ...process.env, GOWORK: 'off', GOFLAGS: '' } });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
