// Runs a command and resolves with what it wrote on its standard output.
import { spawn } from 'node:child_process';

export function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const out = [];
    const err = [];
    child.stdout.on('data', (chunk) => out.push(chunk));
    child.stderr.on('data', (chunk) => err.push(chunk));
    child.once('error', reject);
    // `close`, not `exit`: the process can exit while its streams still hold output (or are held open by something it started), and `exit` would resolve with part of it.
    child.once('close', (code) => (code === 0 ? resolve(Buffer.concat(out).toString('utf8')) : reject(new Error(`${command} ${args.join(' ')} exited ${String(code)}: ${Buffer.concat(err).toString('utf8')}`))));
  });
}
