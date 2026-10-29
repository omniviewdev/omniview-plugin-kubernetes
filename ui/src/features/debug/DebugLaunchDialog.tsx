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
import { parseAppError } from '@omniviewdev/runtime';
import React from 'react';
import { LuChevronDown, LuChevronRight } from 'react-icons/lu';

import SimpleSelect from '../../components/connections/SimpleSelect';
import type { StartDebugInput } from '../../components/shared/drawer/actionDeps';

import type { DebugTemplate } from './config';

const formStyles = {
  dialog: { width: 'calc(100% - 32px)' },
  title: { flexShrink: 0, overflowWrap: 'anywhere' },
  body: { minHeight: 0 },
  fullWidth: { width: '100%' },
  customize: { paddingTop: 'var(--ov-space-stack-md, 16px)' },
  footer: { flexShrink: 0, flexWrap: 'wrap' },
} satisfies Record<string, React.CSSProperties>;

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
  const [mountError, setMountError] = React.useState('');
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
      style={formStyles.dialog}
    >
      <Dialog.Title style={formStyles.title}>
        Debug {input.resourceID} / {input.targetContainerName}
      </Dialog.Title>
      <Dialog.Body style={formStyles.body}>
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
              style={formStyles.fullWidth}
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
              style={formStyles.fullWidth}
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
              <Stack spacing={3} style={formStyles.customize}>
                <FormField label="Target" htmlFor={`${id}-target`} size="sm">
                  <Input.Control
                    id={`${id}-target`}
                    size="sm"
                    readOnly
                    disabled={busy}
                    style={formStyles.fullWidth}
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
                    style={formStyles.fullWidth}
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
                    style={formStyles.fullWidth}
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
                    style={formStyles.fullWidth}
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
                    style={formStyles.fullWidth}
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
                    style={formStyles.fullWidth}
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
                  <FormField label="Mount path" htmlFor={`${id}-mount-path`} size="sm" error={mountError || undefined}>
                    <Input.Control
                      id={`${id}-mount-path`}
                      size="sm"
                      disabled={busy}
                      style={formStyles.fullWidth}
                      value={mountPath}
                      onChange={(event) => {
                        setMountPath(event.target.value);
                        setMountError('');
                      }}
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
      <Dialog.Footer style={formStyles.footer}>
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
              setMountError('');
              try {
                const argv: unknown = JSON.parse(command);
                const environment: unknown = JSON.parse(env);
                if (
                  !Array.isArray(argv) ||
                  !argv.length ||
                  !argv.every((value: unknown): value is string => typeof value === 'string' && value.length > 0)
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
                if (
                  volume &&
                  (!mountPath.startsWith('/') ||
                    mountPath.includes('\0') ||
                    (mountPath !== '/' &&
                      mountPath.slice(1).split('/').some((part) => !part || part === '.' || part === '..')))
                ) {
                  const message = 'Mount path must be absolute and canonical, without repeated or trailing slashes, dot segments, or NUL characters.';
                  setMountError(message);
                  return;
                }
                await onLaunch(
                  { ...draft, command: argv, env: environment as Record<string, string> },
                  acknowledged,
                  volume ? [{ name: volume, mountPath, readOnly: true }] : [],
                );
                onClose();
              } catch (cause) {
                const parsed = parseAppError(cause);
                setError(parsed.code ? `${parsed.title}: ${parsed.detail}` : cause instanceof Error ? cause.message : parsed.detail);
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
