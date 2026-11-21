#!/usr/bin/env bash
# Starts and stops one real Go host (bin/Omniview-server, OMNIVIEW_UI=next, server mode) on a throwaway HOME, the way the cluster proofs and the host's scripts/ui-next-pods/host.sh do.
#
#   HOST_ROOT=<host checkout> WORK=<scratch directory> host.sh start <name> <port> <kubeconfig|none> <plugin-dir> [<plugin-dir> ...]
#   WORK=<scratch directory> host.sh stop <name>
#
# Each plugin dir is a plugin as its archive lays it out (plugin.yaml, bin/plugin, assets/). State: $WORK/hosts/<name>/{home,host.log,host.pid}. Nothing ambient (HOME, KUBECONFIG, credentials)
# reaches the host. It stops a host by the pid it recorded, and no other process.
set -euo pipefail
WORK="${WORK:?}"
channel=feature-ui-next

plugin_id() { sed -n 's/^id:[[:space:]]*//p' "$1/plugin.yaml" | head -n 1 | tr -d '[:space:]'; }

start() {
  local name="$1" port="$2" kubeconfig="$3"; shift 3
  local root="${HOST_ROOT:?}" dir="$WORK/hosts/$name" home="$WORK/hosts/$name/home"
  rm -rf "$dir"; mkdir -p "$home"
  if [[ "$kubeconfig" != none ]]; then
    mkdir -p "$home/.kube"; cp "$kubeconfig" "$home/.kube/config"; chmod 600 "$home/.kube/config"
  fi
  for plugin in "$@"; do
    local installed="$home/.omniview-$channel/plugins/$(plugin_id "$plugin")"
    mkdir -p "$installed"; cp -R "$plugin/." "$installed/"
  done
  env -i PATH="$PATH" TMPDIR="${TMPDIR:-/tmp}" LANG="${LANG:-en_US.UTF-8}" USER="${USER:-}" HOME="$home" OMNIVIEW_CHANNEL="$channel" WAILS_SERVER_HOST=127.0.0.1 WAILS_SERVER_PORT="$port" \
    nohup "$root/bin/Omniview-server" >"$dir/host.log" 2>&1 &
  echo $! >"$dir/host.pid"
  for _ in $(seq 1 120); do
    if curl -fsS -o /dev/null "http://127.0.0.1:$port/" 2>/dev/null; then echo "host $name (host at $(git -C "$root" rev-parse --short HEAD)) pid $(cat "$dir/host.pid") on http://127.0.0.1:$port/"; return 0; fi
    kill -0 "$(cat "$dir/host.pid")" 2>/dev/null || { echo "host $name exited during start" >&2; tail -n 40 "$dir/host.log" >&2; exit 1; }
    sleep 0.5
  done
  echo "host $name did not answer in 60 s" >&2; exit 1
}

stop() {
  local pidfile="$WORK/hosts/$1/host.pid" pid
  [[ -f "$pidfile" ]] || { echo "no pid file for $1"; return 0; }
  pid="$(cat "$pidfile")"
  kill "$pid" 2>/dev/null || true
  for _ in $(seq 1 50); do kill -0 "$pid" 2>/dev/null || break; sleep 0.2; done
  if kill -0 "$pid" 2>/dev/null; then kill -KILL "$pid" 2>/dev/null || true; fi
  rm -f "$pidfile"; echo "host $1 (pid $pid) stopped"
}

case "${1:-}" in
  start) shift; start "$@" ;;
  stop) stop "$2" ;;
  *) echo "usage: host.sh start|stop ..." >&2; exit 2 ;;
esac
