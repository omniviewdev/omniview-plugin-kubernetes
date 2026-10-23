import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function validateClusterPorts(ports, http, https) {
  for (const [container, requested] of [['80/tcp', http], ['443/tcp', https]]) {
    const bindings = ports?.[container];
    if (!Array.isArray(bindings) || bindings.length !== 1
      || bindings[0].HostIp !== '127.0.0.1'
      || bindings[0].HostPort !== String(Number(requested))) {
      throw new Error('Existing cluster ingress mappings differ; recreate the cluster with the requested loopback ports');
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [provider, cluster, http, https] = process.argv.slice(2);
  if (!['docker', 'podman', 'nerdctl'].includes(provider) || !cluster || !http || !https) {
    throw new Error('Expected kind container provider, cluster name, HTTP port and HTTPS port');
  }
  const output = execFileSync(provider, [
    'inspect', '--format', '{{json .NetworkSettings.Ports}}', `${cluster}-control-plane`,
  ], { encoding: 'utf8' });
  validateClusterPorts(JSON.parse(output), http, https);
}
