import React, { createRef, useState } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, type RenderResult } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { FieldInfo, ResourceEditorContext, ResourceEditorContribution, ResourceEditorReferenceResult, ResourceEditorReferenceService, SchemaFieldsResult, SchemaRequest } from '@omniviewdev/runtime';
import type * as Runtime from '@omniviewdev/runtime';
import ResourceManifestEditor from './ResourceManifestEditor';
import { setManifestMode } from './useManifestMode';
import type { ResourceEditorSubmissionHandle } from './resourceEditorSubmission';
import { resourceEditors as coreResourceEditors } from './providers/issue-265';
import EndpointsForm from './providers/issue-265/EndpointsForm';

const live = vi.hoisted(() => ({ result: undefined as SchemaFieldsResult | undefined, generation: 7, rejected: false, error: null as Error | null }));
const QueryUpdateContext = React.createContext(0);
let queryVersion = 0;
vi.mock('@omniviewdev/runtime', async (importOriginal) => ({
  ...await importOriginal<typeof Runtime>(),
  useSchemaFields: () => {
    React.useContext(QueryUpdateContext);
    return { result: live.result, generation: live.generation, isError: live.rejected, error: live.error };
  },
  useEditorSchema: () => ({ result: undefined, generation: live.generation, error: null }),
}));

vi.mock('../../shared/CodeEditor', () => ({ default: ({ value, onChange, readOnly }: { value: string; onChange?: (source: string) => void; readOnly?: boolean }) =>
  <textarea aria-label="Manifest source" value={value} readOnly={readOnly} onChange={(event) => onChange?.(event.target.value)} /> }));
vi.mock('./useEditorEvidence', () => ({ useEditorEvidence: (context: ResourceEditorContext) => context }));

const source = 'apiVersion: v1\nkind: Pod\nmetadata: {name: fixture, namespace: team}\nspec: {containers: [{name: main, image: nginx}]}\n';
const context: ResourceEditorContext = {
  group: '', version: 'v1', kind: 'Pod', resource: 'pods', scope: 'Namespaced', connectionID: 'fixture', intent: 'edit',
  capabilities: { create: 'available', update: 'available', get: 'available', list: 'available', delete: 'unknown', actions: {} },
  discovery: { status: 'available', features: {} }, schema: { status: 'available' }, ownership: { status: 'application' },
};
const contribution: ResourceEditorContribution = {
  contractVersion: 1, label: 'Fixture Pod', targets: [{ group: '', version: 'v1', kind: 'Pod', resource: 'pods', scope: 'Namespaced' }],
  intents: ['edit'], sections: [{ id: 'basics', label: 'Basics' }], ownedPaths: [['spec']], ownershipPolicy: 'declarative',
  formUnavailable: (_draft, target) => target.schema.status === 'available' ? null : 'Optional schema unavailable.',
  component: function Form({ disabled, draft, patch }) {
    const [pending, setPending] = useState('');
    const [outcome, setOutcome] = useState('');
    return <>
      <input aria-label="Pending form input" value={pending} disabled={disabled} onChange={(event) => setPending(event.target.value)} />
      <output aria-label="Projected image">{String(draft.get(['spec', 'containers', 0, 'image']) ?? '')}</output>
      <button onClick={() => setOutcome(patch({ sessionID: draft.sessionID, expectedRevision: draft.revision,
        operations: [{ op: 'set', path: ['spec', 'containers', 0, 'image'], value: 'unexpected' }] }).status)}>Provider write attempt</button>
      <output aria-label="Patch outcome">{outcome}</output>
    </>;
  },
};
function Fixture({ schema }: { schema: ResourceEditorContext['schema'] }) {
  const [value, setValue] = useState(source);
  return <ResourceManifestEditor resourceKey="k8s:/pods" connectionID="fixture" editing baseline={source} value={value} onChange={setValue}
    contribution={contribution} editorContext={{ ...context, schema }} />;
}

beforeEach(() => {
  localStorage.clear(); setManifestMode('form');
  live.result = undefined; live.generation = 7; live.rejected = false; live.error = null;
});
afterEach(cleanup);

it('keeps pending form controls mounted during optional schema loss', () => {
  const view = render(<Fixture schema={{ status: 'available' }} />);
  const input = screen.getByRole('textbox', { name: 'Pending form input' });
  fireEvent.change(input, { target: { value: 'not committed' } });
  view.rerender(<Fixture schema={{ status: 'unavailable' }} />);
  expect(screen.getByRole('textbox', { name: 'Pending form input' })).toBe(input);
  expect(input).toHaveValue('not committed');
});

it('keeps an active raw draft visible when optional schema arrives', () => {
  const view = render(<Fixture schema={{ status: 'unavailable' }} />);
  const input = screen.getByRole('textbox', { name: 'Manifest source' });
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: source + '# authored while schema pending\n' } });
  view.rerender(<Fixture schema={{ status: 'available' }} />);
  expect(screen.getByRole('textbox', { name: 'Manifest source' })).toBe(input);
  expect(input).toHaveValue(source + '# authored while schema pending\n');
});

const request: SchemaRequest = {
  route: { connection: 'fixture' }, type: 'k8s:/pods',
  target: { representation: { id: 'kubernetes.object.v1/v1', revision: 'format-1' } },
};
const specField: FieldInfo = {
  Segment: { Kind: 'field', Name: 'spec' }, Types: ['object'], Format: '', Title: '', Description: '', Enum: [],
  Presence: 'required', Nullable: 'no', Applicability: 'unconditional', Conditions: [], CELChecking: 'static', HasChildren: true, NativeFilter: 'unsupported',
};
const available: SchemaFieldsResult = {
  type: request.type, target: request.target, observation: 'schema-observation', schemaRevision: 'schema-1', schemaState: 'available',
  fields: [specField],
  truncated: false, overlay: { Operations: [], NativeQueryLanguages: [], HostEvaluation: 'schemaChecked', HostEvaluationCode: '', Validation: 'full', Unvalidated: [] },
};
function liveFixture(value: string, onChange: (value: string) => void) {
  return <QueryUpdateContext.Provider value={++queryVersion}>
    <ResourceManifestEditor resourceKey="k8s:/pods" connectionID="fixture" editing baseline={source} value={value} onChange={onChange}
      contribution={contribution} editorContext={context} schemaRequest={request} path="inmemory://fixture/pod.yaml" />
  </QueryUpdateContext.Provider>;
}

it('freezes the last admitted projection and blocks provider writes during successful schema loss', async () => {
  live.result = available;
  const changed = vi.fn();
  const view = render(liveFixture(source, changed));
  const input = await screen.findByRole('textbox', { name: 'Pending form input' });
  fireEvent.change(input, { target: { value: 'not committed' } });
  live.result = { ...available, observation: 'unavailable-observation', schemaState: 'unavailable', fields: [] };
  view.rerender(liveFixture(source, changed));
  await waitFor(() => expect(input).toBeDisabled());
  fireEvent.click(screen.getByRole('button', { name: 'Provider write attempt' }));
  expect(screen.getByLabelText('Patch outcome')).toHaveTextContent('forbidden');
  view.rerender(liveFixture(source.replace('image: nginx', 'image: new-hidden'), changed));
  expect(screen.getByRole('textbox', { name: 'Pending form input' })).toBe(input);
  expect(input).toHaveValue('not committed');
  expect(screen.getByLabelText('Projected image')).toHaveTextContent('nginx');
  expect(screen.getByLabelText('Projected image')).not.toHaveTextContent('new-hidden');
  expect(changed).not.toHaveBeenCalled();
});

it.each(['rejected', 'generation'] as const)('clears retained form admission on %s retirement', async (retirement) => {
  live.result = available;
  const view = render(liveFixture(source, vi.fn()));
  await screen.findByRole('textbox', { name: 'Pending form input' });
  live.result = undefined;
  if (retirement === 'rejected') { live.rejected = true; live.error = new Error('Admitted target rejected'); }
  else live.generation++;
  view.rerender(liveFixture(source, vi.fn()));
  await waitFor(() => expect(screen.queryByRole('textbox', { name: 'Pending form input' })).not.toBeInTheDocument());
  expect(screen.queryByLabelText('Projected image')).not.toBeInTheDocument();
});

const endpointsSource = 'apiVersion: v1\nkind: Endpoints\nmetadata: {name: manual, namespace: team}\nsubsets: [{addresses: [{ip: 10.0.0.8}], ports: [{port: 8080}]}]\n';
const endpointsContext: ResourceEditorContext = { ...context, kind: 'Endpoints', resource: 'endpoints', name: 'manual', namespace: 'team' };
const endpointsRequest: SchemaRequest = {
  ...request, type: 'k8s:/endpoints', target: { representation: { id: 'kubernetes.object.v1/v1', revision: 'format-1' } },
};
const endpointsProvider = { ...coreResourceEditors.find(editor => editor.targets[0].kind === 'Endpoints')!, component: EndpointsForm };
const selectorlessService: ResourceEditorReferenceResult = {
  status: 'ready', items: [{ name: 'manual', namespace: 'team', serviceSelector: 'none' }],
};
function endpointsFixture(submissionRef: React.RefObject<ResourceEditorSubmissionHandle | null>, references: ResourceEditorReferenceService, value = endpointsSource) {
  live.result = live.result && { ...live.result, type: endpointsRequest.type, target: endpointsRequest.target,
    fields: [{ ...specField, Segment: { Kind: 'field', Name: 'subsets' }, Types: ['array'] }] };
  return <QueryUpdateContext.Provider value={++queryVersion}>
    <ResourceManifestEditor resourceKey={endpointsRequest.type} connectionID="fixture" editing baseline={endpointsSource}
      value={value} onChange={vi.fn()} contribution={endpointsProvider} editorContext={endpointsContext}
      schemaRequest={endpointsRequest} references={references} actions={{ execute: async () => ({ status: 'unavailable', message: 'Fixture-only transport.' }) }}
      submissionRef={submissionRef} />
  </QueryUpdateContext.Provider>;
}

it.each(['form', 'yaml'] as const)('admits manual Endpoints YAML from %s mode without mounted form controls', async (mode) => {
  setManifestMode(mode);
  live.result = available;
  const list = vi.fn<ResourceEditorReferenceService['list']>().mockResolvedValue(selectorlessService);
  const submission = createRef<ResourceEditorSubmissionHandle>();
  await act(async () => { render(endpointsFixture(submission, { list })); });
  if (mode === 'form') {
    expect(await screen.findByLabelText('Ready IP 1')).toBeEnabled();
    fireEvent.click(screen.getByRole('radio', { name: 'YAML' }));
  }
  expect(screen.queryByLabelText('Ready IP 1')).not.toBeInTheDocument();
  expect(screen.getByLabelText('Manifest source')).toHaveValue(endpointsSource);
  list.mockClear();
  const prepared = await submission.current!.prepare(new AbortController().signal);
  expect(prepared).toMatchObject({ status: 'ready', source: endpointsSource });
  expect(list).toHaveBeenCalledWith(expect.objectContaining({ resource: 'services', namespace: 'team', projection: 'servicePorts' }));
});

it('rejects denied Service ownership and invalid endpoint values after switching to YAML', async () => {
  live.result = available;
  const list = vi.fn<ResourceEditorReferenceService['list']>().mockResolvedValue(selectorlessService);
  const submission = createRef<ResourceEditorSubmissionHandle>();
  let view: RenderResult;
  await act(async () => { view = render(endpointsFixture(submission, { list })); });
  expect(await screen.findByLabelText('Ready IP 1')).toBeEnabled();
  fireEvent.click(screen.getByRole('radio', { name: 'YAML' }));
  list.mockResolvedValue({ status: 'denied', message: 'Fixture Service lookup denied.' });
  list.mockClear();
  expect((await submission.current!.prepare(new AbortController().signal)).status).toBe('invalid');
  expect(list).toHaveBeenCalledTimes(1);
  expect(list.mock.lastCall?.[0]).toMatchObject({ resource: 'services', namespace: 'team', projection: 'servicePorts' });
  list.mockResolvedValue(selectorlessService);
  await act(async () => { view!.rerender(endpointsFixture(submission, { list }, endpointsSource.replace('10.0.0.8', '127.0.0.1'))); });
  list.mockClear();
  expect((await submission.current!.prepare(new AbortController().signal)).status).toBe('invalid');
  expect(list).not.toHaveBeenCalled();
});

it.each(['source', 'generation'] as const)('rejects manual Endpoints admission when %s changes during its Service lookup', async (change) => {
  live.result = available;
  const list = vi.fn<ResourceEditorReferenceService['list']>().mockResolvedValue(selectorlessService);
  const submission = createRef<ResourceEditorSubmissionHandle>();
  let view: RenderResult;
  await act(async () => { view = render(endpointsFixture(submission, { list })); });
  expect(await screen.findByLabelText('Ready IP 1')).toBeEnabled();
  fireEvent.click(screen.getByRole('radio', { name: 'YAML' }));
  const gate = Promise.withResolvers<ResourceEditorReferenceResult>();
  list.mockReturnValue(gate.promise);
  list.mockClear();
  const prepared = submission.current!.prepare(new AbortController().signal);
  expect(list).toHaveBeenCalledTimes(1);
  expect(list.mock.lastCall?.[0]).toMatchObject({ resource: 'services', projection: 'servicePorts' });
  if (change === 'generation') { live.generation++; live.result = undefined; }
  view!.rerender(endpointsFixture(submission, { list }, change === 'source' ? endpointsSource.replace('10.0.0.8', '10.0.0.9') : endpointsSource));
  await act(async () => { gate.resolve(selectorlessService); });
  expect((await prepared).status).toBe('stale');
});
