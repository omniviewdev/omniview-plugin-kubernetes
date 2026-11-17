# `ui/src/pods/data/`: the Pods data layer

The row model, the Pod definition and the hooks behind the Pods list of the new UI. It was written as temporary scaffolding in the host (`ui-next/k8s/` of omniviewdev/omniview, decisions A13 and A16, tracker row N19) and moved here with its tests, in the shape it was verified in; `hack/vendor-host.sh` and `ui/vendor/HOST_COMMIT` say which host commit this plugin builds against.

## The rules

1. **It imports only what a new-UI plugin may:** the runtime's curated entry (`@omniviewdev/runtime/ui/v1`, never its main barrel, which holds the previous UI library), the kit (`@omniviewdev/kit`, never its stylesheet, which the host loads once), React and third-party packages; the tests use `vitest` and `@testing-library/react`. The build holds the same line: `vite/omniview.ts` fails on any other bare import and `scripts/check-bundle.mjs` reads the finished bundle.
2. **It reads only through the fenced hooks** (`useResourceTypes`, `useResolvedResourceTarget`, `useResources`, `useConnectionReadiness`, `useConnections`): no raw RPC, no Wails binding. The providers those hooks read (the QueryClient, the theme, the activity provider) are the host's.

## What is in here

| File | What |
|---|---|
| `pod.ts` | The part of a Pod the list reads, and the decoder from a record body (`Value`) to it. |
| `status.ts` | kubectl's STATUS word (a port of the API server's `printPod`, v1.35) and the seven-role table of the mock. |
| `fields.ts` | Ready, Restarts, Age, Node, IP and the generated-name tail, each derived from the object. |
| `row.ts` | `PodRow`: one row per `HostRecord` object, computed once (a `WeakMap`), keyed by the host key. |
| `sort.ts` | The column comparisons of the mock; a missing value is always last. |
| `definition.ts` | The Pod definition: columns, list rules, quick filters, facets, and one display function per field that answers a `Cell`. |
| `state.ts` | The state of the body (`connecting`, `disconnected`, `needs-sign-in`, `denied`, `unreachable`, `not-found`, `failed`, `unsupported`, `loading`, `empty`, `loaded`), mapped from what the runtime hooks return, and the failure kept beside rows. |
| `usePods.ts` | `usePods({ pluginID, connectionID, sort })`: the fenced read chain, a first explicit page of 256 beside the collection (the bounded first set), the provisional order, `loaded`, `complete`, `count`, and the commands `connect`, `retry`, `refresh`. With no `connectionID` it reads nothing. |
| `index.ts` | The public surface the Pods page reads. |
| `fixtures/pods-table.json` | Real Pod objects and the cells kubectl's server printed for them, from one kind v1.35 cluster: the oracle of `golden.test.ts`. |
| `testing.ts` | Test support: builds a `HostRecord` the way the host hands one over. Nothing else imports it. |

The acquisition rule of the bounded first set, its measurement, and the capture of what the runtime hooks return for each state are in the host's `docs/ui-next/status/1a.2.md`.
