# Status: HM3-k8s (the cluster Overview: the page a connection lands on)

- Agent: HomeAndConnections (sub-agent K8sCards wrote the page and its tests; the parent reviewed it, vendored the host, ran the real host and wrote this file). Row: HM3 (the host's tracker). The owner's complaint behind it: choosing a cluster put him on a list of Pods; the mock lands a connection on its Overview (`k8s-cluster.js`).
- Worktree: `~/Repos/omniviewdev/worktrees/kubernetes-ui-next-hm3-overview`, branch `ui-next/hm3-cluster-overview` from `origin/feature/ui-next` 68ddc19 (#286). Base of the PR: `feature/ui-next`, never `main`.
- What it stands on (host PRs, both merged): HM3a #723 (`useConnectionMetadata({ pluginID?, connectionID, enabled? })` in the runtime's `ui/v1`, the options form; the root export is unchanged) and HM3b #724 (the `overview` page kind in the contribution contract). `ui/vendor/HOST_COMMIT` is the host's main after #724, `773be33829bfc84e11377e91e9c325e3d54f1713` (`hack/vendor-host.sh`, nothing hand-edited); the last proof (landing, below) ran in a real host built from that commit.
- PR: the pull request of that branch (this file is in its one commit, so it names no number).

## Log

- 2026-11-24: the contract could not draw the mock's page (two kinds of page; a detail page cannot be `home` or a sidebar entry): the host got the page kind first (HM3b), and the facts hook (HM3a). The plugin lands on Pods today (`home: 'pods'`, `ui/src/entry.ts`).
- 2026-11-25: tests first, seen red; the page; vendoring from the host; the real host in WebKit against a 3-node kind cluster with a failing Deployment, a dead context, a stopped control plane and an API group that cannot answer; two defects the proof found are fixed (below); gates.

## Established first (file:line)

| Thing | Where | What it says |
|---|---|---|
| The page is five questions | `mock/k8s-cluster.js:1-13`, `:191-253` (`assess`), `:255-282` (Cluster), `:285-312` (Workloads), `:360-390` (Recent warnings), `:447-461` (assembly) | Needs attention, what runs, what the cluster is, how loaded, what changed. "No block waits for ever: a denied, failed or partial read ends in a compact line with its cause and a Retry." |
| It is where a connection lands | `mock/shell-kubernetes.js:366` (first sidebar entry), `:499` | `home` and the first entry of the sidebar. |
| The plugin read kinds, never several at once | `ui/src/kinds/README.md` (rule 2: only the fenced hooks), `useKindRows.ts` (a first page of 256 beside the collection, `complete`, `count`), `sidebar/useSidebarCounts.ts` (a hook cannot run in a loop: four calls written out) | Nine kinds are nine calls written out. |
| The facts exist | `pkg/plugin/resource/connection_metadata.go:41-70` (`kubernetes.server_version`, `.server_url`, `.provider`, `.distribution`), `native_catalog_heal.go:124-170` (`kubernetes.unavailable_api_groups`: `{ count, groups: [{ groupVersion, reason }] }`) | Read with `useConnectionMetadata({ pluginID, connectionID, enabled })` (HM3a; `enabled` is the page's `connected`); each fact is current, stale or unavailable. |
| What the data layer cannot give | `kinds/nodes/row.ts` (a Node row holds status, version, address), no Events kind (`ui/src/kinds/index.ts`), no metrics hook in `ui/v1`, kit `KeyValueRow` (no copy), the kit's icons (no `layout-dashboard`) | Left out and catalogued below; nothing stands in for them. |

## What changed

- `ui/src/overview/` (new): `assess.ts` (what fails, kind by kind: the mock's `assess`, written over the kinds' own row models and roles, so no state word is made again), `model.ts` (the page as plain data: summary, Needs attention, Workloads, Cluster, header chip and facts), `facts.ts` (a connection's facts as the page reads them: current, stale, unavailable, absent, loading), `state.ts` (the connection's states, the words the lists say), `view.tsx` and `cells.tsx` (drawn from the kit's atoms), `useOverviewPage.ts` (the data hook), `useNow.ts` (a claim that has waited five minutes turns failing with no change in the data), `page.ts` and `entry.ts` (the `overview` page; its id, tile and sidebar entry).
- `ui/src/entry.ts`: `home: 'overview'` and the page; `kinds/index.ts`: the first entry of the sidebar. `connection.ts`, `kinds/state.ts`, `kinds/source.ts`, `kinds/fields.ts`, `kinds/nodes/row.ts`, `kinds/useKindPage.ts`: small shared pieces the page and the lists both use (`connectionState`, `connectionSentence`, `versionText`, `nodeIsReady`), moved, not copied.
- `ui/vendor/*`, `ui/src/contract/*`, `ui/pnpm-lock.yaml`: re-vendored from the host (`hack/vendor-host.sh`): the `overview` kind and `useConnectionMetadata`. Nothing hand-edited.
- Tests: 8 files in `ui/src/overview/` and the pinned tests of `entry`, `kinds/index`, `sidebar`.

## The shape

- A page of the new `overview` kind (host HM3b): `{ title: 'Overview', tile, tabs: [Overview] }` and one hook. The host draws the header (the connection's NAME as the heading, the state chip, the facts, the page's own Refresh), the strip, the summary line and three sections in the main column: Needs attention (a `list`), Workloads (a `table`), Cluster (a `kv`). The mock's aside (Usage, Recent warnings) is not built.
- **No fake zeros.** A kind the cluster does not serve has no row. A read on its way is `Loading` with a dash; a first page that says nothing of the rest is `N+`; a read that failed is `Read failed` (`Access denied` for a refusal) and is one row of Needs attention (`Pods can't be listed`, with the lists' own words for the cause); `None failing` needs a whole read that succeeded; the summary says `Everything is running` only when every read is whole and nothing fails, `Checking` while one is on its way, `Not checked: ...` for what failed. A fact that is not current says when it was last read (`v1.35.0 · last read 41 s ago`) and one that is not known says why (`Not reported by the server`).
- **What it costs.** Mounting on a connected cluster opens 9 collections and 9 first pages of 256 (18 reads); 9 stay once the collections answer; one `useConnectionMetadata` subscription; no count reads. A page that is not on screen reads nothing (a test, with the host's `Activity` hiding). The reads are the ones the lists make, at once.
- Links: a row of one failing object opens that object's page (the Deployment, the Job), several open the kind's list; the lists have no filter a link can name, so it is the whole list (gap below).

## What the real host showed (WebKit 1440x900, the host from the local integration of HM3a and HM3b, a 3-node kind cluster, `status/HM3-k8s/*.png`, every picture looked at)

- `overview-landing-...`: a connection chosen from Home lands on ONE tab titled `Overview`, the sidebar's Overview entry selected, `Kubernetes › hm3-prod`, the heading `hm3-prod`, `Connected`, `kind · v1.35.0`, `Needs attention · 7 failing`, five rows (3 Pods in ImagePullBackOff, 1 Pod with an error, 1 Pod in CrashLoopBackOff with 14 restarts, 1 Deployment unavailable `ledger-sync 0 of 2 ready`, 1 Job failed), Workloads Pods 32 / 5 failing (the Pods list's own `Failed 5`), Deployments 6 / 1, Jobs 2 / 1, the rest Healthy; Cluster `v1.35.0`, `3 · 3 ready`, `8` Namespaces, the API server address.
- `overview-loading-...` (a cold start, 84 ms after the tab opened): `Checking · Not checked in full yet: Pods, Deployments, ...`, every Workloads row `Loading` with dashes, Cluster `Loading`: no number is drawn for a read that has not answered. Settled at about 350 ms.
- `overview-link-pods-...`: the row's link opened the Pods list (32 Pods; its `Failed 5` agrees); the object link opened `ledger-sync · Deployment`; Back came back; the sidebar's Overview and the Cluster `Nodes` link work; Refresh shows `Refreshing…` in the header's slot and `Updated`.
- `overview-api-group-...`: with an APIService that has no endpoints registered, the page says `1 API group is unavailable · inv4-unavailable.example.com/v1beta1` (not counted among the failing objects), the same as the host's own account of the fact (`GetConnectionMetadata`).
- `overview-cluster-not-answering-...` (the control plane paused for about 40 s): `Not checked: ...` in the summary, one `X can't be listed · Source session failed.` row for each kind with a Retry, Workloads `Read failed` with `5+`, `1+`, `Not checked`, Cluster `3 · 3 ready · could not be refreshed`, `v1.35.0 · last read 41 s ago`. After the cluster came back, Retry recovered the page; the control plane's Node was `NotReady` for a while and the page said so (`1 Node not ready`).
- `home-dead-context-...`: a context that points nowhere does not open a tab: Home says `Unable to connect to the cluster.` and `Not responding` on its row (HM2's behaviour is intact).

### Defects the proof found, fixed in this PR

1. While the cluster did not answer, rows held from the last good read were drawn as if current: Workloads said `Read failed` beside `None failing`, and Cluster said `Nodes 3 · 3 ready` while Needs attention said `Nodes can't be listed`. Now `None failing` needs a successful whole read (`Not checked`, or `N+` when failing rows were last seen), and the Cluster rows say `could not be refreshed` (red: 8 tests, `expected { text: 'None failing' } to deeply equal { text: 'Not checked' }`).

## What ran

- Red first (assertions seen failing): `connectionState is not a function`; `assess`: `expected undefined to deeply equal { word: 'CrashLoopBackOff', role: 'error' }` (41 of 67); `model`: `expected [] to deeply equal [{ text: 'Everything is running', tone: 'success' }]` (76); `useOverviewPage`: `expected { kind: 'loading' } to deeply equal { kind: 'ready' }` (33 of 39); `entry`: `expected 'pods' to be 'overview'`; and the defect above (8).
- Green, on the vendored contract: `pnpm run lint`; `pnpm test` 4910 tests in 121 files; `pnpm run test:scripts` 36; `pnpm run build` (typecheck, vite, `check-bundle`).
- No Go file changed: the Go checks are untouched.

## What did not run

- The pin of this plugin in the host's Pods cluster check (HM3c) and its assertions of the Overview against `kubectl`.
- Windows and Linux: the archive was built for `darwin_arm64` only.

## Gaps found (catalogue)

| Gap | Where | What it costs now | The fix |
|---|---|---|---|
| No Events kind | `ui/src/kinds/index.ts` | No Recent warnings card (`k8s-cluster.js:360-390`) | A kind for Events (a list page, a Warning quick filter), then the card |
| No metrics for the UI | no hook in `@omniviewdev/runtime/ui/v1`; the plugin's backend has `pkg/plugin/metric` | No Usage card, no Metrics tab | A reviewed `ui/v1` addition for metrics reads |
| A Node row holds no capacity or runtime | `kinds/nodes/row.ts`, `object.ts` | The Cluster card lacks CPU and Memory capacity and Runtime | Plugin only: decode `status.capacity` and `status.nodeInfo.containerRuntimeVersion` |
| A link cannot carry a list's quick filter | host `LinkTarget = { page, params? }` | `Failing 5` opens the whole Pods list | A host contract member (HM3b status, Gaps) |
| The kit has no `layout-dashboard` glyph, no copy on a `KeyValueRow` | kit icons, `KeyValueRow` | The tile is `layout-template`; the API server address is not copyable | Kit additions |
| No hook for connection commands | `ui/v1` | No Disconnect, Connection settings or Check connection in the header | A reviewed `ui/v1` addition |
| One row per kind that cannot be listed | the mock does the same (`unreadableRow`, `k8s-cluster.js:242`) | Eight rows saying `Source session failed.` when the whole cluster stops answering | The owner's call: group by cause |
| A Pod that stays Pending is not failing | the mock's rule (Pending is progress) | The `unschedulable` fixture Pod is on the Pods list as `Pending 1` and not in Needs attention | The owner's call; the mock only ages a claim |

## Dev tools

- `/tmp/hm3/` (not in the repository): the proof's kind config, kubeconfig with `hm3-prod` and the dead `hm3-dead` context, the Playwright steps (`proof1..7.mjs`, in the host worktree's `.scratch/`), the frames of the cold start. The recipe: `hack/package.sh 0.0.0-hm3 darwin_arm64`, unpack into a directory, `scripts/ui-next-pods/host.sh start <name> <port> <kubeconfig> <that directory>` of the host's checkout, then drive `/` in WebKit at 1440x900; `docker pause <cluster>-control-plane` for the cluster that stops answering.
