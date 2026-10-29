import React from 'react';
import {
  Button,
  Checkbox,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  Dialog,
  FormField,
  Input,
  Stack,
  Text,
  TextArea,
} from '@omniviewdev/base-ui';
import { LuChevronDown, LuChevronRight } from 'react-icons/lu';
import SimpleSelect from '../../components/connections/SimpleSelect';
import type { DebugTemplate } from './config';
import type { StartDebugInput } from '../../components/shared/drawer/actionDeps';

export default function DebugLaunchDialog({
  open,
  input,
  templates,
  initial,
  warnings,
  onClose,
  onLaunch,
  onSettings,
}: {
  open: boolean;
  input: StartDebugInput;
  templates: readonly DebugTemplate[];
  initial: DebugTemplate;
  warnings?: string;
  onClose: () => void;
  onLaunch: (
    template: DebugTemplate,
    acknowledged: boolean,
    mounts: { name: string; mountPath: string; readOnly: true }[],
  ) => Promise<void>;
  onSettings: () => void;
}) {
  const [draft, setDraft] = React.useState(initial);
  const [command, setCommand] = React.useState(JSON.stringify(initial.command));
  const [env, setEnv] = React.useState(JSON.stringify(initial.env ?? {}));
  const [volume, setVolume] = React.useState('');
  const [mountPath, setMountPath] = React.useState('');
  const [acknowledged, setAcknowledged] = React.useState(false);
  const [error, setError] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [customizeOpen, setCustomizeOpen] = React.useState(false);
  const id = React.useId();
  const dialogRef = React.useRef<HTMLDivElement>(null);
  const [popupContainer, setPopupContainer] = React.useState<HTMLDivElement | null>(null);
  React.useLayoutEffect(() => {
    setPopupContainer(open ? dialogRef.current : null);
  }, [open]);
  const elevated = draft.profile !== 'restricted';
  return (
    <Dialog
      ref={dialogRef}
      open={open}
      onClose={() => {
        if (!busy) onClose();
      }}
      size="md"
      style={{ width: 'calc(100% - 32px)' }}
    >
      <Dialog.Title style={{ flexShrink: 0, overflowWrap: 'anywhere' }}>
        Debug {input.resourceID} / {input.targetContainerName}
      </Dialog.Title>
      <Dialog.Body style={{ minHeight: 0 }}>
        <Stack spacing={3}>
          {warnings && (
            <Text as="p" size="sm" tone="warning" role="alert">
              {warnings}
            </Text>
          )}
          <FormField label="Template" htmlFor={`${id}-template`} size="sm">
            <SimpleSelect
              id={`${id}-template`}
              portalContainer={popupContainer}
              value={draft.id}
              disabled={busy}
              style={{ width: '100%' }}
              options={templates.map((template) => ({ value: template.id, label: template.name }))}
              onChange={(value) => {
                const next = templates.find((item) => item.id === value);
                if (next) {
                  setDraft(next);
                  setCommand(JSON.stringify(next.command));
                  setEnv(JSON.stringify(next.env ?? {}));
                  setAcknowledged(false);
                }
              }}
            />
          </FormField>
          <FormField label="Toolbox image" htmlFor={`${id}-image`} size="sm">
            <Input.Control
              id={`${id}-image`}
              size="sm"
              disabled={busy}
              style={{ width: '100%' }}
              value={draft.image}
              onChange={(event) => setDraft({ ...draft, image: event.target.value })}
            />
          </FormField>
          <Collapsible open={customizeOpen} onOpenChange={setCustomizeOpen} disabled={busy}>
            <CollapsibleTrigger aria-controls={`${id}-customize`}>
              <Stack direction="row" align="center" spacing={1}>
                {customizeOpen ? <LuChevronDown aria-hidden /> : <LuChevronRight aria-hidden />}
                <Text size="sm" weight="medium">
                  Customize
                </Text>
              </Stack>
            </CollapsibleTrigger>
            <CollapsibleContent
              id={`${id}-customize`}
              inert={!customizeOpen}
              aria-hidden={!customizeOpen}
            >
              <Stack spacing={3} style={{ paddingTop: 'var(--ov-space-stack-md, 16px)' }}>
                <FormField label="Target" htmlFor={`${id}-target`} size="sm">
                  <Input.Control
                    id={`${id}-target`}
                    size="sm"
                    readOnly
                    disabled={busy}
                    style={{ width: '100%' }}
                    value={input.targetContainerName}
                  />
                </FormField>
                <FormField label="Command argv (JSON array)" htmlFor={`${id}-command`} size="sm">
                  <TextArea.Control
                    id={`${id}-command`}
                    size="sm"
                    mono
                    rows={2}
                    disabled={busy}
                    style={{ width: '100%' }}
                    value={command}
                    onChange={(event) => setCommand(event.target.value)}
                  />
                </FormField>
                <FormField label="Access" htmlFor={`${id}-access`} size="sm">
                  <SimpleSelect
                    id={`${id}-access`}
                    portalContainer={popupContainer}
                    value={draft.profile}
                    disabled={busy}
                    style={{ width: '100%' }}
                    options={[
                      { value: 'restricted', label: 'Restricted' },
                      { value: 'netadmin', label: 'Network administration' },
                      { value: 'sysadmin', label: 'Privileged system administration' },
                    ]}
                    onChange={(value) => {
                      setDraft({ ...draft, profile: value as DebugTemplate['profile'] });
                      setAcknowledged(false);
                    }}
                  />
                </FormField>
                <FormField label="Pull policy" htmlFor={`${id}-pull-policy`} size="sm">
                  <SimpleSelect
                    id={`${id}-pull-policy`}
                    portalContainer={popupContainer}
                    value={draft.imagePullPolicy}
                    disabled={busy}
                    style={{ width: '100%' }}
                    options={['IfNotPresent', 'Always'].map((value) => ({ value, label: value }))}
                    onChange={(value) =>
                      setDraft({
                        ...draft,
                        imagePullPolicy: value as DebugTemplate['imagePullPolicy'],
                      })
                    }
                  />
                </FormField>
                <FormField
                  label="Explicit environment (JSON object)"
                  htmlFor={`${id}-env`}
                  description="No automatic credentials."
                  size="sm"
                >
                  <TextArea.Control
                    id={`${id}-env`}
                    size="sm"
                    mono
                    rows={2}
                    disabled={busy}
                    style={{ width: '100%' }}
                    value={env}
                    onChange={(event) => setEnv(event.target.value)}
                  />
                </FormField>
                <FormField label="Existing volume (read-only)" htmlFor={`${id}-volume`} size="sm">
                  <SimpleSelect
                    id={`${id}-volume`}
                    portalContainer={popupContainer}
                    value={volume}
                    disabled={busy}
                    style={{ width: '100%' }}
                    onChange={setVolume}
                    options={[
                      { value: '', label: 'None' },
                      ...(input.resourceData.spec?.volumes ?? []).map((item) => ({
                        value: item.name,
                        label: item.name,
                      })),
                    ]}
                  />
                </FormField>
                {volume && (
                  <FormField label="Mount path" htmlFor={`${id}-mount-path`} size="sm">
                    <Input.Control
                      id={`${id}-mount-path`}
                      size="sm"
                      disabled={busy}
                      style={{ width: '100%' }}
                      value={mountPath}
                      onChange={(event) => setMountPath(event.target.value)}
                    />
                  </FormField>
                )}
              </Stack>
            </CollapsibleContent>
          </Collapsible>
          <Text as="p" size="sm" tone="muted">
            Shares Pod networking. Process visibility depends on runtime support. Toolbox filesystem
            and environment remain separate.
          </Text>
          {elevated && (
            <Checkbox
              size="sm"
              checked={acknowledged}
              disabled={busy}
              onCheckedChange={(checked) => setAcknowledged(checked)}
            >
              I approve {draft.profile} access for this launch. Cluster admission still applies.
            </Checkbox>
          )}
          {error && (
            <Text as="p" size="sm" tone="danger" role="alert">
              {error}
            </Text>
          )}
        </Stack>
      </Dialog.Body>
      <Dialog.Footer style={{ flexShrink: 0, flexWrap: 'wrap' }}>
        <Button variant="ghost" onClick={onSettings} disabled={busy}>
          Templates & defaults
        </Button>
        <Button variant="ghost" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button
          disabled={busy || (elevated && !acknowledged)}
          onClick={() => {
            void (async () => {
              setBusy(true);
              setError('');
              try {
                const argv: unknown = JSON.parse(command);
                const environment: unknown = JSON.parse(env);
                if (
                  !Array.isArray(argv) ||
                  !argv.length ||
                  argv.some((value) => typeof value !== 'string' || !value)
                )
                  throw new Error('Command must be a nonempty string argv array');
                if (
                  !environment ||
                  Array.isArray(environment) ||
                  typeof environment !== 'object' ||
                  Object.values(environment).some((value) => typeof value !== 'string')
                )
                  throw new Error('Environment must contain string values');
                if (!draft.image.trim()) throw new Error('Image is required');
                if (volume && !mountPath.startsWith('/'))
                  throw new Error('Mount path must be absolute');
                await onLaunch(
                  { ...draft, command: argv, env: environment as Record<string, string> },
                  acknowledged,
                  volume ? [{ name: volume, mountPath, readOnly: true }] : [],
                );
                onClose();
              } catch (cause) {
                setError(String(cause));
              } finally {
                setBusy(false);
              }
            })();
          }}
        >
          Start Debug
        </Button>
      </Dialog.Footer>
    </Dialog>
  );
}
