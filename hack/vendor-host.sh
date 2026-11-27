#!/usr/bin/env bash
# Vendors what the new UI takes from the host, all of it from ONE commit of omniviewdev/omniview (decision A16; the host's
# docs/ui-next/slices/n19-plugin-seam.md and docs/ui-next/status/N19b.md):
#
#   ui/vendor/omniviewdev-kit-<version>.tgz         `pnpm pack` of packages/kit
#   ui/vendor/omniviewdev-runtime-<version>.tgz     `pnpm pack` of packages/omniviewdev-runtime (it holds the `./ui/v1` entry)
#   ui/vendor/omniviewdev-vite-plugin-<version>.tgz the static extension descriptor compiler
#   ui/vendor/omniviewdev-kubernetes-extension-points-<version>.tgz  this owner's public point package, built against the packed runtime
#   ui/vendor/shared-specifiers.json                the names the host's loader serves to a new-UI bundle (ui-next/plugins/loader/specifiers.ts)
#   ui/vendor/HOST_COMMIT                           the exact revision of the host dependencies and contract
#   ui/src/contract/{v1,page,definition,detailDefinition,shell}.ts   the types of the contribution contract, as the host's ui-next/ declares them (types only): the list page's
#                                                   and the detail page's definitions, the barrel of their type exports (`page.ts`, from ui-next/page/index.ts) and the shell's
#
# Until those host packages are available together under a public dist-tag, the plugin builds against
# the packs above; the public point package retains its exact registry version through a local override.
# Run this from a CLEAN checkout of the host at the commit to vendor, never from the owner's working tree:
#
#   git -C <omniview> fetch origin
#   git -C <omniview> worktree add <dir> --detach origin/main
#   hack/vendor-host.sh <dir>
#
# The host revision and the checked-in point declarations identify the inputs to this vendor set.
set -euo pipefail

host="$(cd "${1:?usage: hack/vendor-host.sh <omniview checkout>}" && pwd)"
root="$(cd "$(dirname "$0")/.." && pwd)"
vendor="$root/ui/vendor"
contract="$root/ui/src/contract"

if [ -n "$(git -C "$host" status --porcelain -- packages ui-next)" ]; then
  echo "$host has uncommitted changes under packages/ or ui-next/: vendor from a clean checkout" >&2
  exit 1
fi
commit="$(git -C "$host" rev-parse HEAD)"

# All host packages come from the same checkout; the Vite compiler uses the same runtime as the author.
(
  cd "$host"
  pnpm install --frozen-lockfile
  pnpm --filter @omniviewdev/providers run build
  pnpm --filter @omniviewdev/runtime run build
  pnpm --filter @omniviewdev/kit run build
  pnpm --filter @omniviewdev/vite-plugin run build
)

stage="$(mktemp -d)"
trap 'rm -rf "$stage"' EXIT
packs="$stage/packs"
points="$stage/points"
mkdir -p "$packs" "$points/node_modules/@omniviewdev/runtime" "$vendor" "$contract"
(cd "$host/packages/kit" && pnpm pack --pack-destination "$packs")
(cd "$host/packages/omniviewdev-runtime" && pnpm pack --pack-destination "$packs")
(cd "$host/packages/omniviewdev-vite-plugin" && pnpm pack --pack-destination "$packs")

# Bootstrap the public contract independently of the UI project that consumes it. Use the actual
# packed runtime (not the host workspace's sources), without installing the not-yet-built contract.
cp "$root/ui/extension-points/"{index.ts,package.json,tsconfig.json} "$points/"
tar -xzf "$packs"/omniviewdev-runtime-*.tgz -C "$points/node_modules/@omniviewdev/runtime" --strip-components=1
"$host/packages/omniviewdev-vite-plugin/node_modules/.bin/tsc" -p "$points/tsconfig.json"
(cd "$points" && npm pack --ignore-scripts --pack-destination "$packs")

# Do not discard a working vendor set if the contract fails to compile, or remove unrelated archives.
rm -f "$vendor"/{omniviewdev-kit-,omniviewdev-runtime-,omniviewdev-vite-plugin-,omniviewdev-kubernetes-extension-points-}*.tgz
mv "$packs"/*.tgz "$vendor/"
printf '%s\n' "$commit" >"$vendor/HOST_COMMIT"

node --input-type=module - "$host/ui-next/plugins/loader/specifiers.ts" >"$vendor/shared-specifiers.json" <<'NODE'
import { pathToFileURL } from 'node:url';
const { SHARED_SPECIFIERS_V1 } = await import(pathToFileURL(process.argv[2]).href);
process.stdout.write(`${JSON.stringify(SHARED_SPECIFIERS_V1, null, 2)}\n`);
NODE

# The contract's types are the host's, so they are copied, not written again: only the two relative imports of the contract file change, to
# the sibling files. They go when the runtime's curated entry carries them (design 2.3.1 of the host's slice document).
vendor_types() {
  local from="$1" to="$2"
  {
    printf '// Vendored from omniviewdev/omniview %s (the commit in ui/vendor/HOST_COMMIT): types only. Do not edit; hack/vendor-host.sh writes it.\n' "$from"
    sed -e "s#'../../page'#'./page'#g" -e "s#'../../shell'#'./shell'#g" "$host/$from"
  } >"$contract/$to"
}
vendor_types ui-next/plugins/contract/v1.ts v1.ts
vendor_types ui-next/page/definition.ts definition.ts
vendor_types ui-next/page/detailDefinition.ts detailDefinition.ts
vendor_types ui-next/shell/registration.ts shell.ts

# `page.ts` is what `v1.ts` reads as the host's `ui-next/page` package: the type exports of that package's index (the list page's and the detail page's definitions), and nothing
# else (its values are components the plugin never imports). It fails when the index has none, so a host that moved them is noticed here and not by a type error elsewhere.
node --input-type=module - "$host/ui-next/page/index.ts" "$contract/page.ts" "$(git -C "$host" rev-parse HEAD)" <<'NODE'
import { readFileSync, writeFileSync } from 'node:fs';
const [index, target, commit] = process.argv.slice(2);
const statements = readFileSync(index, 'utf8').match(/^export type \{[^}]*\} from '\.\/(?:definition|detailDefinition)';$/gm) ?? [];
if (statements.length < 2) {
  throw new Error(`${index} has ${String(statements.length)} type export statements of its definitions: expected the list page's and the detail page's`);
}
const header = `// Vendored from omniviewdev/omniview ${commit} (ui-next/page/index.ts, only its type exports of the definitions): types only. Do not edit; hack/vendor-host.sh writes it.\n`;
writeFileSync(target, `${header}${statements.join('\n')}\n`);
NODE

# Refresh the file specs for the three host packages. The contract keeps its exact registry version:
# pnpm-workspace.yaml resolves that version to the tarball above until the package is published.
node --input-type=module - "$root/ui/package.json" "$vendor" <<'NODE'
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
const [file, vendor] = process.argv.slice(2);
const manifest = JSON.parse(readFileSync(file, 'utf8'));
for (const [field, name, prefix] of [
  ['dependencies', '@omniviewdev/kit', 'omniviewdev-kit-'],
  ['dependencies', '@omniviewdev/runtime', 'omniviewdev-runtime-'],
  ['devDependencies', '@omniviewdev/vite-plugin', 'omniviewdev-vite-plugin-'],
]) {
  const [tarball, ...others] = readdirSync(vendor).filter((entry) => entry.startsWith(prefix) && entry.endsWith('.tgz'));
  if (tarball === undefined || others.length > 0) throw new Error(`expected exactly one ${prefix}*.tgz in ${vendor}`);
  manifest[field][name] = `file:vendor/${tarball}`;
}
writeFileSync(file, `${JSON.stringify(manifest, null, 2)}\n`);
NODE

# The lockfile pins the integrity of each tarball.
(cd "$root/ui" && pnpm install --no-frozen-lockfile)

echo "vendored omniview $commit:"
(cd "$vendor" && shasum -a 256 ./*.tgz)
