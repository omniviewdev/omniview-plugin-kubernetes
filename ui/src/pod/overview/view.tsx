import {
  MissingValue,
  type DataTableColumn,
  type KeyValueRow,
  type PageHeaderFact,
  type PageHeaderState,
  type TagItem,
} from '@omniviewdev/kit';

import type { DetailSection, DetailTableSection, DetailView } from '../../contract/v1';
import type { PodForwardCommand } from '../forward/command';
import type { PodLogsCommand } from '../logs/command';
import type { PodShellCommand } from '../terminal/command';

import { ImageCell, ReadyCell, Run, Since, StateCell } from './cells';
import { podCommands, type PodAction } from './commands';
import type {
  ConditionRow,
  ContainerKind,
  ContainerRow,
  PodOverview,
  TagModel,
  VolumeRow,
} from './model';

// A Pod's Overview as the host draws it: the header's state, facts and commands, the counts, and the Overview tab's summary and sections (the contribution contract's
// `DetailView`). What the page says is `model.ts`'s; this file decides how it is drawn, from the kit's atoms. It imports the kit and the model only.

/** What a protected annotation shows in place of its value: the mock's mask. The value itself is never in the data. */
export const MASK = '••••••••';

// --- the header -------------------------------------------------------------------------------------------------------------------------------------------------------

/** The state chip. A word the table has no role for gets the neutral `info` role: a chip needs one, and the word keeps its spelling. Work that waits to start is drawn with the clock. */
function stateOf(state: PodOverview['header']['state']): PageHeaderState | undefined {
  if (state === undefined) {
    return undefined;
  }

  const role = state.role ?? 'info';
  return role === 'progress'
    ? { role, label: state.word, queued: state.word === 'Pending' }
    : { role, label: state.word };
}

function factsOf(
  { namespace, node }: PodOverview['header'],
  age: string,
): readonly PageHeaderFact[] {
  return [namespace, node ?? '', age].filter((text) => text !== '').map((text) => ({ text }));
}

// --- tables -----------------------------------------------------------------------------------------------------------------------------------------------------------

const columnsOfContainers = new Map<string, ReadonlyArray<DataTableColumn<ContainerRow>>>();

/**
 * The columns of a table of containers. The Ports and Resources columns are drawn only when some row has something to put in them (a column that says nothing in any row is not
 * drawn, as in the mock), and an init or a debug container has no Ready. The image keeps what is left of the row (its name and tag stay whole when it is cut) and measures in the
 * code face it is drawn in; the quantities and the states have the widths of their formats, and a longer run is cut with its whole text in the tip. A table keeps the identity of
 * its columns across renders, so each combination is built once.
 */
function containerColumns(
  kind: ContainerKind,
  ports: boolean,
  resources: boolean,
): ReadonlyArray<DataTableColumn<ContainerRow>> {
  const id = `${kind}:${String(ports)}:${String(resources)}`;
  let columns = columnsOfContainers.get(id);
  if (columns === undefined) {
    columns = [
      { id: 'name', header: 'Name', fit: 'flex', text: (row) => row.name, cell: (row) => row.name },
      {
        id: 'image',
        header: 'Image',
        fit: 'flex',
        text: (row) => [{ text: row.image ?? '', font: 'mono' }],
        keepEnd: (row) => row.imageTail,
        cell: (row) => <ImageCell row={row} />,
      },
      ...(ports
        ? [
            {
              id: 'ports',
              header: 'Ports',
              fit: 'flex' as const,
              text: (row: ContainerRow) => [{ text: row.ports ?? '', font: 'mono' as const }],
              cell: (row: ContainerRow) => <Run text={row.ports} name="No ports" mono />,
            },
          ]
        : []),
      ...(resources
        ? [
            {
              id: 'resources',
              header: 'Resources',
              fit: 'flex' as const,
              text: (row: ContainerRow) => row.resources ?? '',
              cell: (row: ContainerRow) => <Run text={row.resources} name="No resources" />,
            },
          ]
        : []),
      {
        id: 'state',
        header: 'State',
        fit: 'fixed',
        width: 144,
        cell: (row) => <StateCell state={row.state} name="No state" />,
      },
      ...(kind === 'regular'
        ? [
            {
              id: 'ready',
              header: 'Ready',
              fit: 'fixed' as const,
              width: 56,
              cell: (row: ContainerRow) => <ReadyCell ready={row.ready} />,
            },
          ]
        : []),
      {
        id: 'restarts',
        header: 'Restarts',
        fit: 'fixed',
        width: 112,
        align: 'end',
        cell: (row) =>
          row.restarts === undefined ? (
            <MissingValue name="No restarts" />
          ) : (
            <Run
              text={row.restarts.text}
              name="No restarts"
              tip={row.restarts.tip ?? row.restarts.text}
            />
          ),
      },
    ];
    columnsOfContainers.set(id, columns);
  }

  return columns;
}

const VOLUME_COLUMNS: ReadonlyArray<DataTableColumn<VolumeRow>> = [
  { id: 'name', header: 'Name', fit: 'id', text: (row) => row.name, cell: (row) => row.name },
  { id: 'type', header: 'Type', fit: 'fixed', width: 160, cell: (row) => row.type },
  {
    id: 'source',
    header: 'Source',
    fit: 'flex',
    text: (row) => [
      { text: row.source?.text ?? '', font: row.source?.mono === true ? 'mono' : 'text' },
    ],
    cell: (row) => (
      <Run
        text={row.source?.text}
        name="No source"
        mono={row.source?.mono === true}
        tip={row.source?.tip ?? row.source?.text}
      />
    ),
  },
  {
    id: 'mounted',
    header: 'Mounted',
    fit: 'flex',
    text: (row) => row.mounted ?? '',
    cell: (row) => <Run text={row.mounted} name="Not mounted" />,
  },
];

const CONDITION_COLUMNS: ReadonlyArray<DataTableColumn<ConditionRow>> = [
  {
    id: 'type',
    header: 'Condition',
    fit: 'id',
    text: (row) => row.type,
    cell: (row) => (
      <StateCell state={{ word: row.type, role: row.role, tip: row.message }} name="No condition" />
    ),
  },
  { id: 'status', header: 'Status', fit: 'fixed', width: 88, cell: (row) => row.status },
  {
    id: 'reason',
    header: 'Reason',
    fit: 'flex',
    text: (row) => row.reason ?? '',
    cell: (row) => <Run text={row.reason} name="No reason" tip={row.message ?? row.reason} />,
  },
  {
    id: 'changed',
    header: 'Last change',
    fit: 'fixed',
    width: 112,
    align: 'end',
    cell: (row) => <Since at={row.changedAt} />,
  },
];

// --- sections ---------------------------------------------------------------------------------------------------------------------------------------------------------

function containersSection(
  id: string,
  title: string,
  priority: number,
  kind: ContainerKind,
  rows: readonly ContainerRow[],
): DetailTableSection<ContainerRow> {
  return {
    id,
    kind: 'table',
    title,
    priority,
    columns: containerColumns(
      kind,
      rows.some((row) => row.ports !== undefined),
      rows.some((row) => row.resources !== undefined),
    ),
    rows,
    getRowKey: (row) => row.key,
  };
}

/** A tag is its key and value; a protected annotation shows the mask where its value would be (its value is not in the data), so the key says it exists and the value is never in the page. */
function tagsOf(models: readonly TagModel[]): readonly TagItem[] {
  return models.map((model) => ({ key: model.key, value: model.protected ? MASK : model.value }));
}

/** The sections of the Overview that have something to say, in the order the design gives them (K59: the Details card, the containers, the volumes, the conditions; the aside after). */
function sectionsOf(overview: PodOverview): readonly DetailSection[] {
  const details: readonly KeyValueRow[] = overview.details.map((row) => ({
    id: row.id,
    label: row.label,
    value: row.text,
    mono: row.mono,
  }));
  const sections: ReadonlyArray<DetailSection | undefined> = [
    details.length === 0
      ? undefined
      : { id: 'details', kind: 'kv', title: 'Details', priority: 10, columns: 2, rows: details },
    overview.containers.length === 0
      ? undefined
      : containersSection('containers', 'Containers', 20, 'regular', overview.containers),
    overview.initContainers.length === 0
      ? undefined
      : containersSection(
          'init-containers',
          'Init containers',
          21,
          'init',
          overview.initContainers,
        ),
    overview.debugContainers.length === 0
      ? undefined
      : containersSection(
          'ephemeral-containers',
          'Debug containers',
          22,
          'ephemeral',
          overview.debugContainers,
        ),
    overview.volumes.length === 0
      ? undefined
      : ({
          id: 'volumes',
          kind: 'table',
          title: 'Volumes',
          priority: 30,
          columns: VOLUME_COLUMNS,
          rows: overview.volumes,
          getRowKey: (row) => row.name,
        } satisfies DetailTableSection<VolumeRow>),
    overview.conditions.length === 0
      ? undefined
      : ({
          id: 'conditions',
          kind: 'table',
          title: 'Conditions',
          priority: 90,
          columns: CONDITION_COLUMNS,
          rows: overview.conditions,
          getRowKey: (row) => row.key,
        } satisfies DetailTableSection<ConditionRow>),
    overview.labels.length === 0
      ? undefined
      : {
          id: 'labels',
          kind: 'tags',
          title: 'Labels',
          count: overview.labels.length,
          placement: 'aside',
          priority: 30,
          visible: 10,
          items: tagsOf(overview.labels),
        },
    overview.annotations.length === 0
      ? undefined
      : {
          id: 'annotations',
          kind: 'tags',
          title: 'Annotations',
          count: overview.annotations.length,
          placement: 'aside',
          priority: 40,
          visible: 6,
          items: tagsOf(overview.annotations),
        },
  ];
  return sections.filter((section): section is DetailSection => section !== undefined);
}

export type PodViewInputs = {
  /** The Pod's age, as the clock keeps it ("8m"): the page's hook reads it, so the header stays current. Empty when the Pod has no creation time. */
  readonly age: string;
  /** Where a command that is not wired reports that it was invoked (`commands.ts`). */
  readonly invoke: (action: PodAction) => void;
  /** The Logs command: the page's own (`../logs/command.ts`), which opens a session in the host's Logs tool, or says why it cannot. */
  readonly logs: PodLogsCommand;
  /** The entries that forward a port of the Pod and the operation the forward is at: the page's own (`../forward/command.ts`), which asks the host to start the forward, or gives no entry. */
  readonly forward: PodForwardCommand;
  /** The Pod's shell button, any explicit container choices and a possible native launch failure. */
  readonly shell: PodShellCommand;
};

/** The page's view of the Pod: what the host draws while the object is there. A function of the Pod's overview, of the age the clock gives it and of the Logs and Forward port commands the page gives the header. */
export function podView(
  overview: PodOverview,
  { age, invoke, logs, forward, shell }: PodViewInputs,
): DetailView {
  const operation = forward.operation ?? shell.operation;
  return {
    state: stateOf(overview.header.state),
    facts: factsOf(overview.header, age),
    commands: podCommands(invoke, logs, forward, shell),
    ...(operation === undefined ? {} : { operation }),
    tabs: {
      overview: { kind: 'overview', summary: overview.summary, sections: sectionsOf(overview) },
    },
  };
}
