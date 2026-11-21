#!/usr/bin/env bash
# Builds the real Go host (bin/Omniview-server, OMNIVIEW_UI=next, server mode) in a host checkout, the way the host's own check builds it
# (.github/workflows/ui-next-pods.yml, "Build the host"): the workspace packages, the frontend, then the server binary without cgo.
#
#   hack/sort-proof/build-host.sh <host checkout>
#
# It touches only that checkout (node_modules, packages/*/dist, bin/). The tracked shim `task packages` rewrites is put back, as the workflow does.
set -euo pipefail

dir="${1:?usage: build-host.sh <host checkout>}"
cd "$dir"
export GOWORK=off GOTOOLCHAIN=local

CI= pnpm install --frozen-lockfile >/dev/null
task packages >/dev/null
git checkout -- packages/omniviewdev-vite-plugin/shims/_omniviewdev__runtime__models.mjs
OMNIVIEW_UI=next PRODUCTION=true pnpm run build >/dev/null
HOST_MODFILE="$(task --silent host:prepare)"
CGO_ENABLED=0 go build -tags production,server -trimpath -buildvcs=false -ldflags="-w -s" -modfile="$HOST_MODFILE" -o bin/Omniview-server .
echo "built $(git rev-parse --short HEAD): $(ls -l bin/Omniview-server | awk '{print $5}') bytes, $dir/bin/Omniview-server"
