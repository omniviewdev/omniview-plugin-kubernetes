# `ui/src/kinds/`: the kinds the plugin lists

Every kind of Kubernetes object the new UI lists is a **definition** (`definition.ts`, `KindDefinition<TRow>`): its identity, its columns and how each cell reads a row, the mapping of its state words to the kit's seven state roles, its quick filters, its default sort and, when the plugin has one, the page of one object it links to. ONE generic list page (`list.tsx`, `listPage(definition)`) draws any definition and ONE data hook (`useKindRows.ts`) reads any of them; neither knows a kind, and a kind is added by writing its definition and a line in the registry (`index.ts`), never by a branch in them. The shape is the mock's definition record (`k8s-resource-definitions.js`, chapter 17 K60 and K61); the Pods list was written first (the host's `ui-next/k8s/` of decisions A13 and A16, tracker row N19) and was moved here, then made the first definition (step K2a, `docs/ui-next/status/K2a.md` of omniviewdev/omniview).

## The rules

1. **It imports only what a new-UI plugin may:** the runtime's curated entry (`@omniviewdev/runtime/ui/v1`, never its main barrel, which holds the previous UI library), the kit (`@omniviewdev/kit`, never its stylesheet, which the host loads once), React and third-party packages; the tests use `vitest` and `@testing-library/react`. The build holds the same line: `vite/omniview.ts` fails on any other bare import and `scripts/check-bundle.mjs` reads the finished bundle.
2. **It reads only through the fenced hooks** (`useResourceTypes`, `useResolvedResourceTarget`, `useResources`, `useConnectionReadiness`, `useConnections`): no raw RPC, no Wails binding. The providers those hooks read (the QueryClient, the theme, the activity provider) are the host's.
3. **A generic file never branches on a kind** (the plugin's `CLAUDE.md`: composition, never a switch on a resource key). What differs between kinds is data in a definition.

## What is in here

| File | What |
|---|---|
| `definition.ts` | The types of a definition (`KindDefinition`, `KindColumn`, `KindField`, `QuickFilter`, `RowModel`, the closed vocabulary of `Cell`s) and `typeOf`, `column`. |
| `index.ts` | The registry: the kinds in the order of the mock's Workloads group, and the sidebar's nodes and the pages made from it. The one place the row type is erased. |
| `list.tsx` | `listPage(definition)`: the contribution's list page, its table columns and its words, from a definition. |
| `useKindPage.ts` | The page's one data hook: which connection it reads, what it puts in the frame, the connection it starts. |
| `useKindRows.ts` | `useKindRows(definition, { pluginID, connectionID, sort })`: the fenced read chain, a first explicit page of 256 beside the collection (the bounded first set), the provisional order, `loaded`, `complete`, `count`, and the commands `connect`, `retry`, `refresh`. With no `connectionID` it reads nothing. |
| `state.ts` | The state of the body (`connecting`, `disconnected`, `needs-sign-in`, `denied`, `unreachable`, `not-found`, `failed`, `unsupported`, `loading`, `empty`, `loaded`), mapped from what the runtime hooks return, and the failure kept beside rows. |
| `source.ts` | The data layer's view as the contract's `ListSource`, with the words of a failure in the kind's plural. |
| `cells.tsx`, `cells.module.css` | How a cell of the closed vocabulary is drawn, for every kind: the identity cell (tile, name or link, namespace), a state, a count, an age, a span that is still running. |
| `display.ts` | The cell builders every definition uses: a count, a ratio, a watched ratio, a state, an age, and the dash that says why. |
| `rows.ts` | `rowModel`: one row per `HostRecord` object, computed once (a `WeakMap`), and the search text; `identityOf`: the identity every row holds. |
| `sort.ts` | The column comparisons of the mock; a missing value is always last. |
| `status.ts` | The seven roles and the ONE table of state words (K61.3) that maps a word to a role, spelled as the platform spells it. |
| `fields.ts` | What every kind says the same way: when it was made, how old it is (`formatAge`), the tail of a generated name, a span (`spanText`, `spanSince`). |
| `object.ts` | The helpers a decoder reads an object with, and `metadata`. |
| `workload.ts` | The state word of a Deployment, a StatefulSet or a DaemonSet (the mock's `workloadState`), from the counts. |
| `<kind>/` | One kind: `object.ts` (the part of the object the list reads, and the decoder from a record body, an exact `Value` tree), `row.ts` (the row, derived once, with its status mapper), `definition.ts`, the tests and `fixtures/<kind>-table.json`. `pods/` also holds kubectl's STATUS (`status.ts`) and the Pod's own derivations (`fields.ts`). |
| `testing.ts` | Test support: builds a `HostRecord` the way the host hands one over, and reads a golden. Nothing else imports it. |

The acquisition rule of the bounded first set, its measurement, and the capture of what the runtime hooks return for each state are in the host's `docs/ui-next/status/1a.2.md`.

## Adding a kind

1. A directory `<kind>/` with `object.ts` (what the list reads of the object: each field kept only when it has the type the API gives it), `row.ts` (the row, `rowModel(decode, searchParts)`, the status word from the kind's own mapper and `statusOf`) and `definition.ts` (the `KindDefinition`).
2. If the kind can say a state word the table in `status.ts` lacks, add it there in the role K61.3 gives it.
3. The golden test first: `fixtures/<kind>-table.json` is ONE response of a real API server, the objects and the cells its printer made of them (`hack/kinds-capture/capture.mjs`; the states the host's slice fixture does not make are in `hack/kinds-capture/extra-states.yaml`). The test compares the row with the printed cells, and the state word with the counts in them where kubectl prints no word.
4. A line in `index.ts`. The sidebar entry, the page and the tab are made from the definition.

`index.test.ts` holds every definition to the facts the generic page and hook rely on.

## The page of one Pod reads through this layer too

`ui/src/pod/` (the detail page) uses this layer's `state.ts` (the same words for the connection and the read), the Pod definition's type and `useKindRows.ts`'s `FIRST_SET`, `PLUGIN_ID` and `settled`. Its read is one file, `ui/src/pod/data/usePod.ts`: the page narrows the read to its Pod by namespace and name (a query dimension of every native kind, D1c), so its source view holds that one object. A generic detail Overview driven by the same definitions is the next step (K2b).
