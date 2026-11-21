import type { DataTableColumn, KeyValueRow, LinkTarget, PageHeaderFact, PageHeaderState, TagItem } from '@omniviewdev/kit';

import type { DetailSection, DetailTableSection, DetailView } from '../../contract/v1';
import type { KindCommands } from '../definition';
import type { KindStatus } from '../status';

import { DetailValueView, Run, Since, StateCell } from './cells';
import { unavailableCommands } from './commands';
import type { ConditionRow } from './conditions';
import { MASK, type TagModel } from './metadata';
import type { KindOverview, ObjectRef } from './overview';

// The page of an object as the host draws it (the contribution contract's `DetailView`), from a kind's overview: the header's state, facts and commands, and the Overview tab's summary and sections.
// What the page says is the kind's (`overview.ts`); this file decides how it is drawn, from the kit's atoms, for every kind alike. It imports the kit and the kinds' own types only.

// --- the header -------------------------------------------------------------------------------------------------------------------------------------------------------

/** The state chip. A word the table has no role for gets the neutral `info` role: a chip needs one, and the word keeps its spelling. Work that waits to start is drawn with the clock. */
function stateOf(state: KindStatus | undefined): PageHeaderState | undefined {
  if (state === undefined) {
    return undefined;
  }

  const role = state.role ?? 'info';
  return role === 'progress' ? { role, label: state.word, queued: state.word === 'Pending' } : { role, label: state.word };
}

/** The mock's identity line (K59): at most three of Kind, Namespace and Age, after the state. An object that lives in no namespace says none; one with no creation time says no age. */
function factsOf(kind: string, namespace: string | undefined, age: string): readonly PageHeaderFact[] {
  return [kind, namespace ?? '', age].filter((text) => text !== '').map((text) => ({ text }));
}

// --- the Conditions table ---------------------------------------------------------------------------------------------------------------------------------------------

const CONDITION_COLUMNS: ReadonlyArray<DataTableColumn<ConditionRow>> = [
  {
    id: 'type',
    header: 'Condition',
    fit: 'id',
    text: (row) => row.type,
    cell: (row) => <StateCell state={{ word: row.type, role: row.role, tip: row.message }} name="No condition" />,
  },
  { id: 'status', header: 'Status', fit: 'fixed', width: 88, cell: (row) => row.status },
  { id: 'reason', header: 'Reason', fit: 'flex', text: (row) => row.reason ?? '', cell: (row) => <Run text={row.reason} name="No reason" tip={row.message ?? row.reason} /> },
  { id: 'changed', header: 'Last change', fit: 'fixed', width: 112, align: 'end', cell: (row) => <Since at={row.changedAt} /> },
];

// --- sections ---------------------------------------------------------------------------------------------------------------------------------------------------------

/** A tag is its key and value; a protected annotation shows the mask where its value would be (its value is not in the data), so the key says it exists and the value is never in the page. */
function tagsOf(models: readonly TagModel[]): readonly TagItem[] {
  return models.map((model) => ({ key: model.key, value: model.protected ? MASK : model.value }));
}

export type DetailViewInputs = {
  /** The Kind as the API spells it (`Deployment`): the first fact of the identity line. */
  readonly kind: string;
  /** The object's namespace, from its route; undefined for a kind that lives in no namespace. */
  readonly namespace: string | undefined;
  /** The object's age, as the clock keeps it (`6d`): the page's hook reads it, so the header stays current. Empty when the object has no creation time. */
  readonly age: string;
  /** The header's commands, as the kind lays them out; every one of them is unavailable. */
  readonly commands: KindCommands | undefined;
  /** Where a reference to another object goes, or undefined when the plugin has no page for its kind. */
  readonly resolve: (ref: ObjectRef) => LinkTarget | undefined;
};

/** The sections of the Overview that have something to say, in the order the design gives them (K59: the Details card first, the kind's tables, the Conditions; the aside after). */
function sectionsOf(overview: KindOverview, resolve: DetailViewInputs['resolve']): readonly DetailSection[] {
  const rows: readonly KeyValueRow[] = overview.details.map((fact) => ({
    id: fact.id,
    label: fact.label,
    value: <DetailValueView value={fact.value} label={fact.label} resolve={resolve} />,
    mono: fact.value.kind === 'text' && fact.value.mono === true ? true : undefined,
    wide: fact.wide,
  }));
  const sections: ReadonlyArray<DetailSection | undefined> = [
    rows.length === 0 ? undefined : { id: 'details', kind: 'kv', title: 'Details', priority: 10, columns: 2, rows },
    overview.conditions.length === 0
      ? undefined
      : ({ id: 'conditions', kind: 'table', title: 'Conditions', priority: 90, columns: CONDITION_COLUMNS, rows: overview.conditions, getRowKey: (row) => row.key } satisfies DetailTableSection<ConditionRow>),
    overview.labels.length === 0
      ? undefined
      : { id: 'labels', kind: 'tags', title: 'Labels', count: overview.labels.length, placement: 'aside', priority: 30, visible: 10, items: tagsOf(overview.labels) },
    overview.annotations.length === 0
      ? undefined
      : { id: 'annotations', kind: 'tags', title: 'Annotations', count: overview.annotations.length, placement: 'aside', priority: 40, visible: 6, items: tagsOf(overview.annotations) },
  ];
  return sections.filter((section): section is DetailSection => section !== undefined);
}

/** The page's view of the object: what the host draws while the object is there. A function of the kind's overview, of the age the clock gives it and of the commands the kind lays out. */
export function detailView(overview: KindOverview, { kind, namespace, age, commands, resolve }: DetailViewInputs): DetailView {
  return {
    state: stateOf(overview.state),
    facts: factsOf(kind, namespace, age),
    commands: unavailableCommands(commands),
    tabs: { overview: { kind: 'overview', summary: overview.summary, sections: sectionsOf(overview, resolve) } },
  };
}
