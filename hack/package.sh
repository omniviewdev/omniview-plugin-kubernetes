#!/usr/bin/env bash
# Build the plugin and package one archive per platform for the marketplace.
#
#   hack/package.sh <version> [platform...]
#
# Writes dist/<plugin-id>-<os>_<arch>.tar.gz, the names the publish action
# uploads. The plugin ID is the id in plugin.yaml unless PLUGIN_ID is set,
# which publishes the same code under another ID: it is stamped into the
# packaged plugin.yaml, the Go binary (pkg/pluginid) and the UI bundle.
# Each archive holds plugin.yaml, bin/plugin and assets/ at its root, which is
# the layout the app installs.
set -euo pipefail

PLUGIN_ID="${PLUGIN_ID:-$(sed -n 's/^id:[[:space:]]*//p' "$(dirname "$0")/../plugin.yaml" | head -n 1)}"
if ! echo "$PLUGIN_ID" | grep -Eq '^[a-z0-9][a-z0-9-]*$'; then
  echo "invalid plugin ID '$PLUGIN_ID'" >&2
  exit 1
fi
export OMNIVIEW_PLUGIN_ID="$PLUGIN_ID"
VERSION="${1:?usage: hack/package.sh <version> [platform...]}"
VERSION="${VERSION#v}"
shift
if [ "$#" -eq 0 ]; then
  set -- darwin_arm64 darwin_amd64 linux_amd64 linux_arm64 windows_amd64
fi

cd "$(dirname "$0")/.."

(cd ui && pnpm install --frozen-lockfile && pnpm run build)

rm -rf dist
for platform in "$@"; do
  os="${platform%%_*}"
  arch="${platform#*_}"
  ext=""
  if [ "$os" = "windows" ]; then ext=".exe"; fi

  stage="dist/stage/$platform"
  mkdir -p "$stage/bin" "$stage/assets"

  echo "Building $platform"
  GOOS="$os" GOARCH="$arch" CGO_ENABLED=0 \
    go build -trimpath \
      -ldflags="-s -w -X github.com/omniview/kubernetes/pkg/pluginid.ID=$PLUGIN_ID" \
      -o "$stage/bin/plugin$ext" ./pkg

  # The released version is the tag, not whatever plugin.yaml said at the time,
  # and the ID is the one the binary and bundle were built for.
  sed -e "s/^version: .*/version: $VERSION/" -e "s/^id: .*/id: $PLUGIN_ID/" \
    plugin.yaml > "$stage/plugin.yaml"
  cp -R ui/dist/assets/. "$stage/assets/"

  COPYFILE_DISABLE=1 tar -czf "dist/$PLUGIN_ID-$platform.tar.gz" -C "$stage" plugin.yaml bin assets
done
rm -rf dist/stage

ls -lh dist
