import { describe, expect, it } from 'vitest';

import { hostRecord } from '../testing';

import { namespaceDefinition } from './definition';
import { namespaceRow, namespaceSearchText, type NamespaceRow } from './row';

// The Namespace definition, as the mock's `PRINTER.Namespace` has it (MOCK k8s-resource-definitions.js:803-806; ch17 K60.3): after the name, Status and Age. The wide set (Labels) and the Columns chooser's
// (Finalizers, Marked for deletion) wait for the list page to have them. A Namespace lives in no namespace: it has no second line under its name.

const NOW = Date.UTC(2026, 10, 19, 20, 0, 0);

const row = (object: unknown): NamespaceRow => namespaceRow(hostRecord(object, 'row:1', namespaceDefinition.type));
const namespace = (extra: Record<string, unknown>, metadata: Record<string, unknown> = {}) =>
  row({ metadata: { name: 'checkout', creationTimestamp: '2026-11-17T20:00:00Z', ...metadata }, ...extra });
const cell = (id: string, target: NamespaceRow) => namespaceDefinition.fields.find((field) => field.id === id)!.display(target, NOW);

const active = namespace({ spec: { finalizers: ['kubernetes'] }, status: { phase: 'Active' } });
const terminating = namespace({ status: { phase: 'Terminating' } }, { deletionTimestamp: '2026-11-19T19:00:00Z' });

describe('the definition', () => {
  it('names the type, the kind and the nouns', () => {
    expect(namespaceDefinition).toMatchObject({
      type: 'k8s:/namespaces',
      identity: { group: '', version: 'v1', resource: 'namespaces' },
      kind: 'Namespace',
      nouns: { one: 'Namespace', other: 'Namespaces' },
      page: 'namespaces',
    });
  });

  it('lists the columns of the mock\'s default set: the identity, Status, Age', () => {
    expect(namespaceDefinition.columns.map((column) => [column.id, column.label, column.defaultHidden])).toEqual([
      ['name', 'Name', false],
      ['status', 'Status', false],
      ['age', 'Age', false],
    ]);
  });

  it('gives each column the fit, width, alignment and sort of the mock: a width that holds the longest state word, `Terminating`, with its glyph (7.2 px a character plus 42)', () => {
    const by = Object.fromEntries(namespaceDefinition.columns.map((column) => [column.id, column]));

    expect(by.name).toMatchObject({ fit: 'id', width: 160, align: 'left', sort: 'text', required: true });
    expect(by.status).toMatchObject({ fit: 'fixed', width: 121, align: 'left', sort: 'text' });
    expect(by.age).toMatchObject({ fit: 'fixed', width: 59, align: 'left', sort: 'time' });
  });

  it('has no second line under the name (it lives in no namespace), no tail to keep, and no detail page yet', () => {
    expect(namespaceDefinition.list.identity.second(active)).toBeNull();
    expect(namespaceDefinition.list.identity.tail(active)).toBe(0);
    expect(namespaceDefinition.detail).toBeUndefined();
  });
});

describe('the quick filters: the two states of a Namespace, each a word', () => {
  const { quickFilters } = namespaceDefinition.list;
  const matching = (target: NamespaceRow) => quickFilters.filter((filter) => filter.test(target)).map((filter) => filter.id);

  it('has them in the mock\'s order, words and tones', () => {
    expect(quickFilters.map(({ id, label, tone }) => [id, label, tone])).toEqual([
      ['active', 'Active', 'success'],
      ['terminating', 'Terminating', 'warning'],
    ]);
  });

  it('files each state under its own filter, and a row that has no state in none', () => {
    expect(matching(active)).toEqual(['active']);
    expect(matching(terminating)).toEqual(['terminating']);
    expect(matching(namespace({}))).toEqual([]);
  });
});

describe('the row: the phase, or Terminating once the Namespace is marked for deletion', () => {
  it('says Active for the phase Active, with the glyph of its role', () => {
    expect(active).toMatchObject({ name: 'checkout', namespace: '', status: { word: 'Active', role: 'healthy' } });
  });

  it('says Terminating for a Namespace that is being deleted: the phase says it, and so does the deletion timestamp that is set before the phase changes', () => {
    expect(terminating.status).toEqual({ word: 'Terminating', role: 'progress' });
    expect(namespace({ status: { phase: 'Active' } }, { deletionTimestamp: '2026-11-19T19:00:00Z' }).status?.word).toBe('Terminating');
  });

  it('says a phase the table has no role for as it is written, without a glyph, and nothing for a Namespace that states none', () => {
    expect(namespace({ status: { phase: 'Frozen' } }).status).toEqual({ word: 'Frozen', role: undefined });
    expect(namespace({})).toMatchObject({ status: undefined });
  });

  it('searches the name and the word', () => {
    const text = namespaceSearchText(active);
    expect(text).toContain('checkout');
    expect(text).toContain('active');
  });
});

describe('the cells', () => {
  it('draws the word with its role, and the age', () => {
    expect(cell('status', active)).toEqual({ kind: 'status', raw: 'Active', label: 'Active', role: 'healthy' });
    expect(cell('status', terminating)).toEqual({ kind: 'status', raw: 'Terminating', label: 'Terminating', role: 'progress' });
    expect(cell('age', active)).toMatchObject({ kind: 'age', text: '2d' });
  });

  it('draws a dash that says why for a Namespace that states no phase', () => {
    expect(cell('status', namespace({}))).toEqual({ kind: 'none', reason: 'The Namespace reports no phase.' });
  });

  it('sorts by the word and the age', () => {
    const sortOf = (id: string) => namespaceDefinition.fields.find((field) => field.id === id)!.sortValue(active);
    expect(sortOf('status')).toBe('Active');
    expect(sortOf('age')).toBe(Date.UTC(2026, 10, 17, 20, 0, 0));
  });
});
