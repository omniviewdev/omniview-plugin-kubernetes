import { Button, Dialog } from '@omniviewdev/base-ui';
import React from 'react';
import { resourceEditorModelURI, type ResourceEditorContext, type ResourceType, type SchemaRequest } from '@omniviewdev/runtime';
import { LuPlus } from 'react-icons/lu';

import ResourceManifestEditor, { type ResourceManifestEditorProps } from '../../manifest/ResourceManifestEditor';
import { ResourcePortalContext } from '../../manifest/ResourcePortalContext';
import styles from './CreateResourceModal.module.css';
import type { ResourceEditorSubmissionHandle } from '../../manifest/resourceEditorSubmission';
import { PLUGIN_ID } from '@/pluginId';
import { catalogEditorContext } from '../../manifest/resourceEditorContext';
import { inspectManifest } from '../../manifest/manifestDraft';

interface Props extends Pick<ResourceManifestEditorProps, 'contribution' | 'references' | 'actions'> {
  open: boolean;
  onClose: () => void;
  resourceKey: string;
  resourceName: string;
  template: string;
  onCreate: (yaml: string, isCurrent: () => boolean) => Promise<void>;
  isCreating?: boolean;
  context?: string;
  connectionID?: string;
  editorPath?: string;
  editorContext?: ResourceEditorContext;
  resolveContext?: (source: string) => ResourceEditorContext;
  descriptor?: ResourceType;
}

const CreateResourceModal: React.FC<Props> = (props) =>
  props.open ? <CreateResourceForm key={JSON.stringify([props.connectionID, props.context, props.resourceKey])} {...props} /> : null;

// Each open owns its draft and completion lifetime, including while a request is pending.
const CreateResourceForm: React.FC<Props> = ({
  onClose, resourceKey, resourceName, template, onCreate, isCreating, context, connectionID, editorPath, editorContext, resolveContext, contribution, references, actions, descriptor,
}) => {
  const [initialTemplate] = React.useState(template);
  const [value, setValue] = React.useState(initialTemplate);
  const [error, setError] = React.useState<string | null>(null);
  const [formError, setFormError] = React.useState<string | null>(null);
  const [readOnly, setReadOnly] = React.useState(false);
  const [pending, setPending] = React.useState(false);
  const activeRef = React.useRef(false);
  const busyRef = React.useRef(false);
  const dialogRef = React.useRef<HTMLDivElement>(null);
  const openerRef = React.useRef(document.activeElement);
  const submission = React.useRef<ResourceEditorSubmissionHandle | null>(null);
  const preparation = React.useRef<AbortController | null>(null);
  const admittedContext = resolveContext?.(value) ?? editorContext;

  React.useLayoutEffect(() => {
    activeRef.current = true;
    const opener = openerRef.current;
    return () => {
      activeRef.current = false;
      preparation.current?.abort();
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, []);

  const handleSubmit = async () => {
    if (busyRef.current || isCreating || formError || readOnly) return;
    setError(null);
    busyRef.current = true;
    setPending(true);
    const preparing = new AbortController(); preparation.current = preparing;
    try {
      const prepared = await submission.current?.prepare(preparing.signal);
      if (!prepared || prepared.status !== 'ready') { if (activeRef.current) setError(prepared?.message ?? 'Editor is not ready for submission.'); return; }
      if (!prepared.isCurrent()) { if (activeRef.current) setError('Editor changed during submission preparation.'); return; }
      await onCreate(prepared.source, prepared.isCurrent);
      if (activeRef.current) onClose();
    } catch {
      if (activeRef.current) setError(resourceKey === 'k8s:/secrets'
        ? 'Secret creation failed. Credential values are hidden; check permissions and server policy.'
        : 'Resource creation failed. Check connection, permissions and server policy.');
    } finally {
      busyRef.current = false;
      if (activeRef.current) setPending(false);
    }
  };

  const trapFocus = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Tab') return;
    const controls = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(
      'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]',
    ) ?? []).filter((element) => element.getClientRects().length > 0);
    const first = controls[0];
    const last = controls.at(-1);
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  };

  return (
    <ResourcePortalContext.Provider value={dialogRef}>
    <Dialog ref={dialogRef} open onClose={onClose} size="xl" className={styles.Dialog} onKeyDown={trapFocus}>
      <Dialog.Close aria-label="Close" />
      <Dialog.Title className={styles.Title} icon={<LuPlus size={16} />}>Create {resourceName}</Dialog.Title>
      <div className={styles.Content}>
        {descriptor && connectionID ? <CatalogCreateEditor
          value={value}
          onChange={(next) => { if (!busyRef.current) { setValue(next); setError(null); } }}
          resourceKey={resourceKey}
          filename="create.yaml"
          context={context}
          connectionID={connectionID}
          descriptor={descriptor}
          template={initialTemplate}
          submissionRef={submission}
          onAdmissionChange={setReadOnly}
          onValidityChange={setFormError}
          disabled={pending || isCreating}
        /> : <ResourceManifestEditor
          value={value}
          onChange={(next) => { if (!busyRef.current) { setValue(next); setError(null); } }}
          resourceKey={resourceKey}
          filename="create.yaml"
          path={editorPath}
          context={context}
          connectionID={connectionID}
          editorContext={admittedContext}
          submissionRef={submission}
          onAdmissionChange={setReadOnly}
          contribution={contribution}
          references={references}
          actions={actions}
          onValidityChange={setFormError}
          disabled={pending || isCreating}
        />}
      </div>
      {error && <div className={styles.Error} role="alert">{error}</div>}
      <Dialog.Footer className={styles.Footer}>
        <Button size="sm" variant="ghost" color="neutral" onClick={onClose}>Cancel</Button>
        <Button size="sm" variant="solid" color="brand" disabled={pending || isCreating || !!formError || readOnly} onClick={() => void handleSubmit()}>
          {pending || isCreating ? 'Creating...' : 'Create'}
        </Button>
      </Dialog.Footer>
    </Dialog>
    </ResourcePortalContext.Provider>
  );
};

function CatalogCreateEditor({ descriptor, template, connectionID, ...props }: ResourceManifestEditorProps & {
  descriptor: ResourceType;
  template: string;
  connectionID: string;
}) {
  const editorID = React.useId();
  const [formatID] = React.useState(descriptor.defaultRepresentation);
  const format = descriptor.representations.find((entry) => entry.id === formatID);
  const request = React.useMemo<SchemaRequest | undefined>(() => format ? {
    route: { connection: connectionID }, type: props.resourceKey, target: { representation: format },
  } : undefined, [connectionID, format, props.resourceKey]);
  const modelURI = formatID ? resourceEditorModelURI({
    pluginID: PLUGIN_ID, route: { connection: connectionID }, type: props.resourceKey,
    target: { representation: { id: formatID, revision: '' } }, name: `${editorID}/create`,
  }) : `inmemory://resource-editor/${encodeURIComponent(editorID)}/create`;
  const context = catalogEditorContext(props.value, props.resourceKey, connectionID, 'create', descriptor);
  const initial = catalogEditorContext(template, props.resourceKey, connectionID, 'create', descriptor);
  const admitted = inspectManifest(template).document
    ? { ...context, group: initial.group, version: initial.version, kind: initial.kind }
    : context;
  return <ResourceManifestEditor {...props} connectionID={connectionID} path={modelURI} schemaRequest={request} editorContext={admitted} />;
}

export default CreateResourceModal;
