#!/usr/bin/env bash
# Vendors what the new UI takes from the host, all of it from ONE commit of omniviewdev/omniview (decision A16; the host's
# docs/ui-next/slices/n19-plugin-seam.md and docs/ui-next/status/N19b.md):
#
#   ui/vendor/omniviewdev-kit-<version>.tgz         `pnpm pack` of packages/kit
#   ui/vendor/omniviewdev-runtime-<version>.tgz     `pnpm pack` of packages/omniviewdev-runtime (it holds the `./ui/v1` entry)
#   ui/vendor/shared-specifiers.json                the names the host's loader serves to a new-UI bundle (ui-next/plugins/loader/specifiers.ts)
#   ui/vendor/HOST_COMMIT                           the commit all of the above came from
#   ui/src/contract/{v1,page,definition,detailDefinition,shell}.ts   the types of the contribution contract, as the host's ui-next/ declares them (types only): the list page's
#                                                   and the detail page's definitions, the barrel of their type exports (`page.ts`, from ui-next/page/index.ts) and the shell's
#
# Until `@omniviewdev/kit` and the runtime's `ui/v1` entry are on npm under a dist-tag (host tracker row N16) the plugin builds against these
# files, and `ui/package.json` names the two tarballs with `file:` specifiers. Run this from a CLEAN checkout of the host at the commit to
# vendor, never from the owner's working tree:
#
#   git -C <omniview> fetch origin
#   git -C <omniview> worktree add <dir> --detach origin/main
#   hack/vendor-host.sh <dir>
#
# The tarballs are reproducible: the same commit gives the same bytes (checked on macOS arm64 from two checkouts at different paths).
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

# The packages in `task packages` order, less the vite plugin (nothing here needs it, and its build rewrites a tracked shim in the host).
(
  cd "$host"
  pnpm install --frozen-lockfile
  pnpm --filter @omniviewdev/providers run build
  pnpm --filter @omniviewdev/runtime run build
  pnpm --filter @omniviewdev/kit run build
)

mkdir -p "$vendor" "$contract"
rm -f "$vendor"/*.tgz
(cd "$host/packages/kit" && pnpm pack --pack-destination "$vendor")
(cd "$host/packages/omniviewdev-runtime" && pnpm pack --pack-destination "$vendor")
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

# The two dependencies name the tarballs just written (the version in the file name is the host package's).
node --input-type=module - "$root/ui/package.json" "$vendor" <<'NODE'
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
const [file, vendor] = process.argv.slice(2);
const manifest = JSON.parse(readFileSync(file, 'utf8'));
for (const [name, prefix] of [['@omniviewdev/kit', 'omniviewdev-kit-'], ['@omniviewdev/runtime', 'omniviewdev-runtime-']]) {
  const [tarball, ...others] = readdirSync(vendor).filter((entry) => entry.startsWith(prefix) && entry.endsWith('.tgz'));
  if (tarball === undefined || others.length > 0) throw new Error(`expected exactly one ${prefix}*.tgz in ${vendor}`);
  manifest.dependencies[name] = `file:vendor/${tarball}`;
}
writeFileSync(file, `${JSON.stringify(manifest, null, 2)}\n`);
NODE

# The lockfile pins the integrity of each tarball.
(cd "$root/ui" && pnpm install --no-frozen-lockfile)

echo "vendored omniview $commit:"
(cd "$vendor" && shasum -a 256 ./*.tgz)
