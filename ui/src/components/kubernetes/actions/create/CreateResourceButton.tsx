import { Button } from '@omniviewdev/base-ui';
import { jsonToValue, useResourceMutations, useResourceTypes, useExtensionPointSnapshot, RESOURCE_EDITOR_EXTENSION_POINT, type ResourceEditorContribution, type ResourceEditorContext, type ResourceType } from '@omniviewdev/runtime';
import React from 'react';
import { LuPlus } from 'react-icons/lu';
import { parse } from 'yaml';

import { PLUGIN_ID } from '@/pluginId';
import { resolveKubernetesReference } from '../../../../utils/kubernetesReference';
import { inspectManifest, patchManifest, type ManifestChange } from '../../manifest/manifestDraft';
import { catalogEditorContext } from '../../manifest/resourceEditorContext';
import { builtinResourceEditors } from '../../manifest/resourceEditors';
import CreateResourceModal from './CreateResourceModal';
import { getTemplate } from './templates';
import { validateEditorSource } from '../../manifest/resourceEditorSubmission';

interface Props {
  connectionID: string;
  resourceKey: string;
  selectedNamespaces?: string[];
}

const CreateResourceButton: React.FC<Props> = ({ connectionID, resourceKey, selectedNamespaces = [] }) => {
  const [open, setOpen] = React.useState(false);
  const [isCreating, setIsCreating] = React.useState(false);
  const [template, setTemplate] = React.useState(getTemplate());
  const [sessionDescriptor, setSessionDescriptor] = React.useState<ResourceType>();
  const route = { connection: connectionID };
  const { resourceTypes } = useResourceTypes({ pluginID: PLUGIN_ID, route });
  const descriptor = resourceTypes.data?.find((entry) => entry.type === resourceKey);
  const selectedFormat = descriptor?.representations.find((entry) => entry.id === descriptor.defaultRepresentation);
  const label = descriptor?.displayName ?? resourceKey;
  const { mutate } = useResourceMutations({ pluginID: PLUGIN_ID });
  const editors = useExtensionPointSnapshot<ResourceEditorContribution, ResourceEditorContext>(RESOURCE_EDITOR_EXTENSION_POINT);
  const contributions = editors.store ? editors.contributions.map((entry) => entry.value) : builtinResourceEditors;
  const matches = contributions.filter((entry) => entry.targets.some((target) => `k8s:${target.group}/${target.resource}` === resourceKey));
  const authorable = !matches.length || matches.some((entry) => entry.intents.includes('create') && entry.ownershipPolicy !== 'controller' && entry.ownershipPolicy !== 'system');
  const preparation = React.useRef<AbortController | null>(null);
  React.useEffect(() => () => preparation.current?.abort(), [connectionID, resourceKey]);

  const handleOpen = () => {
    const representation = selectedFormat;
    const targets = matches.flatMap((entry) => entry.targets).filter((target) =>
      `k8s:${target.group}/${target.resource}` === resourceKey
      && `kubernetes.object.v1/${target.group ? `${target.group}/` : ''}${target.version}` === representation?.id);
    const target = targets.length > 0 && targets.every((entry) => entry.kind === targets[0].kind) ? targets[0] : undefined;
    const identity = target ? {
      apiVersion: target.group ? `${target.group}/${target.version}` : target.version,
      kind: target.kind,
      namespaced: descriptor?.identityDimensions.some(({ name }) => name === 'namespace') ?? false,
    } : undefined;
    let nextTemplate = getTemplate(identity);
    const draft = inspectManifest(nextTemplate, resourceKey);
    const changes: ManifestChange[] = [];
    if (identity?.namespaced) {
      changes.push({ path: ['metadata', 'namespace'], value: selectedNamespaces.length === 1 ? selectedNamespaces[0] : '' });
    }
    if (identity) changes.push({ path: ['metadata', 'name'], value: '' });
    if (draft.kind === 'Pod' || draft.kind === 'Deployment' || draft.kind === 'StatefulSet') {
      changes.push({ path: ['metadata', 'labels', 'app'], value: '' });
      const podPath = draft.kind === 'Pod' ? ['spec'] : ['spec', 'template', 'spec'];
      changes.push(
        { path: [...podPath, 'containers', 0, 'image'], value: '' },
        { path: [...podPath, 'containers', 0, 'ports'], remove: true },
      );
      if (draft.kind !== 'Pod') {
        changes.push(
          { path: ['spec', 'selector', 'matchLabels', 'app'], value: '' },
          { path: ['spec', 'template', 'metadata', 'labels', 'app'], value: '' },
        );
      }
      if (draft.kind === 'StatefulSet') changes.push({ path: ['spec', 'serviceName'], value: '' });
    }
    if (draft.kind === 'Service') changes.push({ path: ['spec', 'selector'], remove: true });
    if (draft.kind === 'Ingress') changes.push({ path: ['spec', 'rules'], remove: true });
    if (draft.kind === 'ConfigMap') changes.push({ path: ['data'], remove: true });
    if (draft.kind === 'Secret') changes.push(
      { path: ['data'], remove: true }, { path: ['stringData'], remove: true },
    );
    if (draft.kind === 'PersistentVolumeClaim') changes.push({ path: ['spec', 'resources', 'requests', 'storage'], remove: true });
    if (changes.length) nextTemplate = patchManifest(nextTemplate, changes);
    setTemplate(nextTemplate);
    setSessionDescriptor(descriptor);
    setOpen(true);
  };

  const handleCreate = async (yaml: string, isCurrent: () => boolean) => {
    setIsCreating(true);
    preparation.current?.abort();
    const preparing = new AbortController(); preparation.current = preparing;
    try {
      const parsed = parse(yaml, { intAsBigInt: true }) as Record<string, unknown>;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('YAML must be a Kubernetes resource object');
      const admission = catalogEditorContext(yaml, resourceKey, connectionID, 'create', descriptor);
      const admissionError = validateEditorSource(yaml, admission);
      if (admissionError) throw new Error(admissionError);
      const metadata = parsed.metadata as Record<string, unknown> | undefined;
      if (typeof metadata?.name !== 'string' || !metadata.name) throw new Error('metadata.name is required');
      if (metadata.namespace !== undefined && typeof metadata.namespace !== 'string') throw new Error('metadata.namespace must be a string');
      const resolved = await resolveKubernetesReference({
        connectionID, resourceType: resourceKey, name: metadata.name,
        namespace: metadata.namespace,
      });
      if (preparing.signal.aborted || !isCurrent()) throw new Error('Creation cancelled because the editor changed.');
      await mutate({
        route: resolved.route,
        reference: resolved.reference,
        operation: 'create',
        input: jsonToValue(parsed),
      });
    } finally {
      setIsCreating(false);
    }
  };
  if (!authorable) return null;

  return (
    <>
      <CreateResourceTrigger label={label} onOpen={handleOpen} />
      <CreateResourceModal key={JSON.stringify([connectionID, resourceKey])} open={open} onClose={() => { preparation.current?.abort(); setOpen(false); }} resourceKey={resourceKey}
        resourceName={label} template={template} onCreate={handleCreate} isCreating={isCreating} context={connectionID} connectionID={connectionID}
        descriptor={sessionDescriptor} />
    </>
  );
};

function CreateResourceTrigger({ label, onOpen }: { label: string; onOpen: () => void }) {
  return <Button size="sm" variant="outline" color="neutral" startDecorator={<LuPlus size={13} />} onClick={onOpen}>{`Create ${label}`}</Button>;
}

export default CreateResourceButton;
