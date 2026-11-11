import { describe, expect, it } from 'vitest';
import type { FieldInfo, ResourceEditorContext, SchemaFieldsResult } from '@omniviewdev/runtime';
import { installedEditorSchemaEvidence } from './resourceEditorContext';
import { fieldAvailable } from './providers/issue-272/rules';

const field: FieldInfo = {
  Segment: { Kind: 'field', Name: 'replicas' }, Types: ['integer'], Format: '', Title: '', Description: '', Enum: [],
  Presence: 'optional', Nullable: 'no', Applicability: 'unconditional', Conditions: [], CELChecking: 'static', HasChildren: false, NativeFilter: 'unsupported',
};
const result: SchemaFieldsResult = {
  type: 'k8s:apps/deployments', target: { representation: { id: 'native', revision: 'format-1' } }, observation: 'observation-1',
  schemaState: 'available', schemaRevision: 'schema-1', fields: [field, ...['privileged', 'ordinary'].map((name, branch): FieldInfo => ({
    ...field, Segment: { Kind: 'field', Name: name }, Types: ['boolean'], Applicability: 'conditional',
    Conditions: [{ Pointer: '#/oneOf', Branch: branch, Combinator: 'oneOf' }],
  }))], truncated: false,
  overlay: { Operations: [], NativeQueryLanguages: [], HostEvaluation: 'schemaChecked', HostEvaluationCode: '', Validation: 'full', Unvalidated: [] },
};
const context: ResourceEditorContext = {
  group: 'apps', version: 'v1', kind: 'Deployment', resource: 'deployments', scope: 'Namespaced', connectionID: 'fixture', intent: 'edit',
  capabilities: { create: 'available', update: 'available', delete: 'unknown', get: 'available', list: 'available', actions: {} },
  discovery: { status: 'available', features: {} }, schema: { status: 'unknown' }, ownership: { status: 'application' },
};
const spec = [{ Kind: 'field', Name: 'spec' }] as const;

describe('immediate host field claims', () => {
  it('admits only unconditional fields from the requested parent tier', () => {
    const schema = installedEditorSchemaEvidence(result, spec);
    expect(schema.paths).toEqual([['spec', 'replicas']]);
    expect(fieldAvailable({ ...context, schema }, ['spec', 'replicas'])).toBe(true);
    expect(fieldAvailable({ ...context, schema }, ['spec', 'privileged'])).toBe(false);
    expect(fieldAvailable({ ...context, schema }, ['spec', 'ordinary'])).toBe(false);
    expect(fieldAvailable({ ...context, schema }, ['spec', 'unrequested'])).toBe(false);
  });

  it.each(['truncated', 'unavailable', 'pending'] as const)('withholds dynamic claims with %s evidence', (state) => {
    const observed = state === 'pending' ? undefined : { ...result, truncated: state === 'truncated', schemaState: state === 'unavailable' ? 'unavailable' : 'available' };
    const schema = installedEditorSchemaEvidence(observed, spec);
    expect(schema.paths).toEqual([]);
    expect(fieldAvailable({ ...context, schema }, ['spec', 'replicas'])).toBe(false);
    if (state === 'truncated') expect(schema.status).toBe('available');
  });

  it('projects an unconditional map-value claim without inventing its parent or descendants', () => {
    const schema = installedEditorSchemaEvidence({ ...result, fields: [{ ...field, Segment: { Kind: 'mapValue' }, Types: ['string'] }] },
      [{ Kind: 'field', Name: 'parameters' }]);
    expect(schema.paths).toEqual([['parameters', '*']]);
  });
});
