import { Button, Input, Select } from '@omniviewdev/base-ui';
import { useContext, useId, useState, type ReactNode } from 'react';
import { LuCircleHelp, LuTrash2 } from 'react-icons/lu';
import SimpleTooltip from '../../shared/SimpleTooltip';
import type { ManifestDraft } from './manifestDraft';
import styles from './ResourceManifestEditor.module.css';
import { ResourcePortalContext } from './ResourcePortalContext';

export interface ResourceFormProps {
  value: string;
  onChange: (value: string) => void;
  draft: ManifestDraft;
  section: string;
  editing?: boolean;
  disabled?: boolean;
  baseline?: string;
  connectionID?: string;
  onValidityChange?: (error: string | null) => void;
}

export function scalarText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'bigint' || typeof value === 'boolean') return String(value);
  return '';
}

export function Help({ children }: { children: string }) {
  const container = useContext(ResourcePortalContext);
  return <SimpleTooltip content={children} container={container}><button type="button" className={styles.help} aria-label={children}><LuCircleHelp size={13} /></button></SimpleTooltip>;
}

export function Field({ label, value, onChange, disabled, readOnly, placeholder, help, error, type = 'text', min, max }: {
  label: string; value: string; onChange: (value: string) => void; disabled?: boolean; readOnly?: boolean;
  placeholder?: string; help?: string; error?: string; type?: 'text' | 'number' | 'password'; min?: number; max?: number;
}) {
  const id = useId();
  const [touched, setTouched] = useState(false);
  const visibleError = touched || value !== '' ? error : undefined;
  return <div className={styles.field}>
    <div className={styles.label}><label htmlFor={id}>{label}</label>{help && <Help>{help}</Help>}</div>
    <Input.Root size="sm" invalid={!!visibleError}>
      <Input.Control id={id} size="sm" value={value} type={type} min={min} max={max} step={type === 'number' ? 1 : undefined}
        disabled={disabled} readOnly={readOnly} placeholder={placeholder} autoComplete={type === 'password' ? 'new-password' : 'off'}
        aria-invalid={!!visibleError} aria-describedby={visibleError ? `${id}-error` : undefined}
        onBlur={() => setTouched(true)} onChange={(event) => { setTouched(true); onChange(event.target.value); }} />
    </Input.Root>
    {visibleError && <span id={`${id}-error`} className={styles.error}>{visibleError}</span>}
  </div>;
}

export function Choice({ label, value, options, onChange, disabled, help }: {
  label: string; value: string; options: { value: string; label: string }[];
  onChange: (value: string) => void; disabled?: boolean; help?: string;
}) {
  const id = useId();
  const container = useContext(ResourcePortalContext);
  return <div className={styles.field}>
    <div className={styles.label}><label id={id}>{label}</label>{help && <Help>{help}</Help>}</div>
    <Select.Root value={value} items={options} onValueChange={(next) => { if (next !== null) onChange(next); }} disabled={disabled} size="sm">
      <Select.Trigger aria-labelledby={id} className={styles.select}><Select.Value /></Select.Trigger>
      <Select.Portal container={container}><Select.Positioner sideOffset={4}><Select.Popup><Select.List>
        {options.map((option) => <Select.Item key={option.value} value={option.value}><Select.ItemText>{option.label}</Select.ItemText></Select.Item>)}
      </Select.List></Select.Popup></Select.Positioner></Select.Portal>
    </Select.Root>
  </div>;
}

export function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return <section className={styles.section}><div className={styles.sectionHeading}><h3>{title}</h3>{action}</div>{children}</section>;
}

export function Remove({ label, disabled, onClick }: { label: string; disabled?: boolean; onClick: () => void }) {
  return <Button size="sm" variant="ghost" disabled={disabled} onClick={onClick} aria-label={label} className={styles.remove}><LuTrash2 size={14} /></Button>;
}
