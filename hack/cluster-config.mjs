import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function renderClusterConfig(template, http, https) {
  for (const port of [http, https]) {
    if (!/^[0-9]+$/.test(String(port)) || Number(port) < 1 || Number(port) > 65535) {
      throw new Error('Ingress host ports must be integers from 1 to 65535');
    }
  }
  if (Number(http) === Number(https)) throw new Error('HTTP and HTTPS require distinct host ports');
  return template.replaceAll('__HTTP_PORT__', String(Number(http)))
    .replaceAll('__HTTPS_PORT__', String(Number(https)));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [source, destination, http, https] = process.argv.slice(2);
  if (!source || !destination) throw new Error('Expected template, output, HTTP port and HTTPS port');
  const config = renderClusterConfig(readFileSync(source, 'utf8'), http, https);
  mkdirSync(path.dirname(destination), { recursive: true });
  writeFileSync(destination, config);
}
