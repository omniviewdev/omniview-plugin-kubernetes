import {
  Button,
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
import React, { useId, useState } from 'react';

import SimpleSelect from '../../components/connections/SimpleSelect';

import { BUILTIN_DEBUG_TEMPLATES, resolveDebugTemplate, validateDebugTemplate } from './config';
import type { DebugTemplate } from './config';
import styles from './DebugPreferencesDialog.module.css';
import { useDebugPreferences } from './useDebugPreferences';

export interface DebugPreferencesDialogProps {
  open: boolean;
  connectionID: string;
  onClose: () => void;
}

export function DebugPreferencesDialog({
  open,
  connectionID,
  onClose,
}: DebugPreferencesDialogProps) {
  const preferences = useDebugPreferences(connectionID);
  const [scope, setScope] = useState<'plugin' | 'cluster'>('cluster');
  const savedSelection =
    scope === 'cluster'
      ? (preferences.config.clusterDefaults[connectionID] ?? '')
      : (preferences.config.defaultTemplateId ?? '');
  const [selection, setSelection] = useState(savedSelection);
  const [draft, setDraft] = useState<DebugTemplate | null>(null);
  const [command, setCommand] = useState('');
  const [env, setEnv] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [customizeOpen, setCustomizeOpen] = useState(false);
  const id = useId();
  const dialogRef = React.useRef<HTMLDivElement>(null);
  const [popupContainer, setPopupContainer] = useState<HTMLDivElement | null>(null);
  React.useLayoutEffect(() => {
    setPopupContainer(open ? dialogRef.current : null);
  }, [open]);
  const [previousContext, setPreviousContext] = useState({
    open,
    connectionID,
    scope,
    savedSelection,
  });
  const contextChanged =
    previousContext.open !== open ||
    previousContext.connectionID !== connectionID ||
    previousContext.scope !== scope;
  if (contextChanged || previousContext.savedSelection !== savedSelection) {
    setPreviousContext({ open, connectionID, scope, savedSelection });
    if (open) {
      setSelection(savedSelection);
      if (contextChanged) {
        setDraft(null);
        setError(null);
        setNotice(null);
      }
    }
  }

  function edit(template: DebugTemplate, duplicate: boolean) {
    const value = {
      ...template,
      command: [...template.command],
      env: { ...template.env },
      ...(duplicate ? { id: `custom-${crypto.randomUUID()}`, name: `${template.name} copy` } : {}),
    };
    setDraft(value);
    setCustomizeOpen(false);
    setCommand(JSON.stringify(value.command));
    setEnv(JSON.stringify(value.env, null, 2));
    setError(null);
    setNotice(null);
  }

  async function saveDraft() {
    if (!draft) return;
    setBusy(true);
    setError(null);
    try {
      let argv: unknown;
      let environment: unknown;
      try {
        argv = JSON.parse(command);
      } catch {
        throw new Error('Command must be a JSON argv array, for example ["sh", "-l"].');
      }
      try {
        environment = JSON.parse(env);
      } catch {
        throw new Error('Environment must be a JSON object of non-secret string values.');
      }
      const candidate = { ...draft, command: argv, env: environment };
      const issues = validateDebugTemplate(
        candidate,
        preferences.templates.filter((template) => template.id !== draft.id),
      );
      if (issues.length) throw new Error(issues.map((issue) => issue.message).join(' '));
      await preferences.saveTemplate(candidate as DebugTemplate);
      setDraft(null);
      setNotice(
        'Template saved. Default selection unchanged. Changes apply to future launches only.',
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  async function saveDefault() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await preferences.setDefaultTemplate(scope, selection || null);
      setNotice('Debug default saved for future launches.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  const preview = resolveDebugTemplate(
    {
      ...preferences.config,
      ...(scope === 'plugin' ? { defaultTemplateId: selection || null } : {}),
      clusterDefaults:
        scope === 'cluster'
          ? { ...preferences.config.clusterDefaults, [connectionID]: selection || null }
          : {},
    },
    connectionID,
  );
  const close = () => {
    if (!busy) {
      setDraft(null);
      onClose();
    }
  };
  const disabled = busy || preferences.isLoading;

  return (
    <Dialog ref={dialogRef} open={open} onClose={close} size="lg">
      <Dialog.Title>{draft ? 'Edit debug template' : 'Templates & defaults'}</Dialog.Title>
      <Dialog.Body>
        <Stack direction="column" spacing={3}>
          {(error || preferences.error) && <div role="alert">{error || preferences.error}</div>}
          {notice && <div role="status">{notice}</div>}
          {draft ? (
            <>
              <FormField label="Name" htmlFor={`${id}-name`}>
                <Input.Control
                  id={`${id}-name`}
                  value={draft.name}
                  disabled={busy}
                  onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                    setDraft({ ...draft, name: event.target.value })
                  }
                />
              </FormField>
              <FormField label="Image" htmlFor={`${id}-image`}>
                <Input.Control
                  id={`${id}-image`}
                  value={draft.image}
                  disabled={busy}
                  onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                    setDraft({ ...draft, image: event.target.value })
                  }
                />
              </FormField>
              <Collapsible open={customizeOpen} onOpenChange={setCustomizeOpen}>
                <CollapsibleTrigger aria-controls={`${id}-customize`}>Customize</CollapsibleTrigger>
                <CollapsibleContent
                  id={`${id}-customize`}
                  inert={!customizeOpen}
                  aria-hidden={!customizeOpen}
                >
                  <Stack direction="column" spacing={3}>
                    <FormField label="Command argv (JSON array)" htmlFor={`${id}-command`}>
                      <Input.Control
                        id={`${id}-command`}
                        value={command}
                        disabled={busy}
                        onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                          setCommand(event.target.value)
                        }
                      />
                    </FormField>
                    <FormField label="Access" htmlFor={`${id}-access`}>
                      <SimpleSelect
                        id={`${id}-access`}
                        portalContainer={popupContainer}
                        aria-label="Access"
                        value={draft.profile}
                        disabled={busy}
                        options={[
                          { value: 'restricted', label: 'Restricted' },
                          { value: 'netadmin', label: 'Network administrator' },
                          { value: 'sysadmin', label: 'System administrator (privileged)' },
                        ]}
                        onChange={(value) => {
                          if (
                            value === 'restricted' ||
                            value === 'netadmin' ||
                            value === 'sysadmin'
                          )
                            setDraft({ ...draft, profile: value });
                        }}
                      />
                    </FormField>
                    <FormField label="Image pull policy" htmlFor={`${id}-pull`}>
                      <SimpleSelect
                        id={`${id}-pull`}
                        portalContainer={popupContainer}
                        aria-label="Image pull policy"
                        value={draft.imagePullPolicy}
                        disabled={busy}
                        options={[
                          { value: 'IfNotPresent', label: 'If not present' },
                          { value: 'Always', label: 'Always' },
                        ]}
                        onChange={(value) => {
                          if (value === 'IfNotPresent' || value === 'Always')
                            setDraft({ ...draft, imagePullPolicy: value });
                        }}
                      />
                    </FormField>
                    <FormField label="Non-secret environment (JSON object)" htmlFor={`${id}-env`}>
                      <TextArea.Control
                        rows={4}
                        id={`${id}-env`}
                        value={env}
                        disabled={busy}
                        onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) =>
                          setEnv(event.target.value)
                        }
                      />
                    </FormField>
                    <Text size="sm">
                      Do not store credentials or secrets. Target containers and volume mounts are
                      selected per launch, never saved in templates.
                    </Text>
                  </Stack>
                </CollapsibleContent>
              </Collapsible>
              {draft.profile !== 'restricted' && (
                <div role="note">
                  Elevated access requires fresh confirmation for every launch. Saving does not
                  authorize a launch or bypass cluster policy.
                </div>
              )}
            </>
          ) : (
            <>
              <FormField label="Scope" htmlFor={`${id}-scope`}>
                <SimpleSelect
                  id={`${id}-scope`}
                  portalContainer={popupContainer}
                  aria-label="Scope"
                  value={scope}
                  disabled={disabled}
                  options={[
                    { value: 'cluster', label: 'This cluster' },
                    { value: 'plugin', label: 'All clusters' },
                  ]}
                  onChange={(value) => {
                    if (value === 'plugin' || value === 'cluster') setScope(value);
                  }}
                />
              </FormField>
              <FormField label="Default toolbox" htmlFor={`${id}-default`}>
                <SimpleSelect
                  id={`${id}-default`}
                  portalContainer={popupContainer}
                  aria-label="Default toolbox"
                  value={selection}
                  disabled={disabled}
                  options={[
                    {
                      value: '',
                      label:
                        scope === 'cluster'
                          ? 'Inherit all-cluster default'
                          : 'Built-in Shell fallback',
                    },
                    ...preferences.templates.map((template) => ({
                      value: template.id,
                      label: template.name,
                    })),
                  ]}
                  onChange={setSelection}
                />
              </FormField>
              <Text size="sm">
                Effective: {preview.template.name} · {preview.template.image} · source:{' '}
                {preview.source}
              </Text>
              {preview.issues.map((issue) => (
                <div role="alert" key={`${issue.field}:${issue.message}`}>
                  {issue.message}
                </div>
              ))}
              {preview.requiresElevationConfirmation && (
                <div role="note">
                  Elevated default: every launch still requires fresh confirmation. This setting
                  does not grant access or bypass cluster policy.
                </div>
              )}
              <Button disabled={disabled} onClick={() => void saveDefault()}>
                Save default
              </Button>
              <Text size="sm" weight="semibold">
                Reusable templates
              </Text>
              {preferences.templates.map((template) => {
                const builtIn = BUILTIN_DEBUG_TEMPLATES.some((entry) => entry.id === template.id);
                return (
                  <div className={styles.template} key={template.id}>
                    <div>
                      <strong>{template.name}</strong>
                      <div className={styles.image}>{template.image}</div>
                    </div>
                    <Button
                      variant="outline"
                      disabled={disabled}
                      onClick={() => edit(template, builtIn)}
                    >
                      {builtIn ? `Duplicate ${template.name}` : `Edit ${template.name}`}
                    </Button>
                  </div>
                );
              })}
              <Button
                variant="outline"
                disabled={disabled}
                onClick={() => edit({ ...BUILTIN_DEBUG_TEMPLATES[0], name: 'New template' }, true)}
              >
                New template
              </Button>
              <Text size="sm">
                Template saves never change default selection or existing sessions.
              </Text>
            </>
          )}
        </Stack>
      </Dialog.Body>
      <Dialog.Footer>
        {draft ? (
          <>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => {
                setDraft(null);
                setError(null);
              }}
            >
              Cancel
            </Button>
            <Button disabled={disabled} onClick={() => void saveDraft()}>
              Save template
            </Button>
          </>
        ) : (
          <Button variant="outline" disabled={busy} onClick={close}>
            Close
          </Button>
        )}
      </Dialog.Footer>
    </Dialog>
  );
}

export default DebugPreferencesDialog;
