import type { Meta, StoryObj } from '@storybook/react-vite';
import { Button } from '@omniviewdev/base-ui';
import React from 'react';
import { stringify } from 'yaml';

import ResourceManifestEditor from '../../manifest/ResourceManifestEditor';
import CreateResourceModal from './CreateResourceModal';

type PreviewKind = 'Pod' | 'Deployment' | 'StatefulSet' | 'ConfigMap';
const resourceTypes: Record<PreviewKind, string> = {
  Pod: 'k8s:/pods', Deployment: 'k8s:apps/deployments', StatefulSet: 'k8s:apps/statefulsets', ConfigMap: 'k8s:/configmaps',
};

function example(kind: PreviewKind, editing = false): string {
  const name = editing ? 'payments-api' : '';
  const metadata = { name, namespace: 'payments', labels: { app: name }, annotations: { 'example.com/owner': 'platform' } };
  if (kind === 'ConfigMap') return stringify({ apiVersion: 'v1', kind, metadata, data: { LOG_LEVEL: 'info' } });
  const pod = { containers: [{ name: 'main', image: editing ? 'nginx:1.27.3' : '' }] };
  return '# This annotation and custom field must survive form edits.\n' + stringify({
    apiVersion: kind === 'Pod' ? 'v1' : 'apps/v1', kind, metadata,
    spec: kind === 'Pod' ? pod : {
      replicas: 3,
      ...(kind === 'StatefulSet' ? { serviceName: 'postgres-headless' } : {}),
      selector: { matchLabels: { app: name } },
      template: { metadata: { labels: { app: name } }, spec: pod },
    },
    'example.com/custom': { exact: 9007199254740993n, preserved: true },
  });
}

function CreatePreview({ kind }: { kind: PreviewKind }) {
  const [open, setOpen] = React.useState(true);
  const [submitted, setSubmitted] = React.useState<string>();
  return (
    <div style={{ minHeight: '100vh', padding: 24, background: 'var(--ov-color-bg-base)', color: 'var(--ov-color-fg-default)' }}>
      <p>Component preview — submissions are captured locally; no cluster requests.</p>
      <Button onClick={() => setOpen(true)}>Create {kind}</Button>
      <CreateResourceModal open={open} onClose={() => setOpen(false)} resourceKey={resourceTypes[kind]}
        resourceName={kind} template={example(kind)} context="dev-us-east / payments"
        onCreate={(source) => { setSubmitted(source); return Promise.resolve(); }} />
      {submitted && <section aria-label="Captured submission"><h2>Captured preview submission</h2><pre>{submitted}</pre></section>}
    </div>
  );
}

function EditPreview() {
  const [baseline, setBaseline] = React.useState(() => example('Deployment', true));
  const [value, setValue] = React.useState(baseline);
  return (
    <div style={{ height: '100vh', padding: 20, display: 'flex', flexDirection: 'column', background: 'var(--ov-color-bg-base)', color: 'var(--ov-color-fg-default)' }}>
      <h2 style={{ fontSize: 16 }}>Edit Deployment · payments-api</h2>
      <ResourceManifestEditor value={value} onChange={setValue} resourceKey="k8s:apps/deployments" editing baseline={baseline} context="dev-us-east / payments" />
      <div style={{ paddingTop: 12 }}><Button disabled={value === baseline} onClick={() => setBaseline(value)}>Save preview draft</Button></div>
      <span style={{ fontSize: 11, paddingTop: 8 }}>Component preview — saves stay in memory; no cluster requests.</span>
    </div>
  );
}

const meta = { title: 'Resources/Manifest editor', parameters: { layout: 'fullscreen' } } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;
export const CreatePod: Story = { render: () => <CreatePreview kind="Pod" /> };
export const CreateDeployment: Story = { render: () => <CreatePreview kind="Deployment" /> };
export const CreateStatefulSet: Story = { render: () => <CreatePreview kind="StatefulSet" /> };
export const YAMLOnlyConfigMap: Story = { render: () => <CreatePreview kind="ConfigMap" /> };
export const EditDeployment: Story = { render: () => <EditPreview /> };
