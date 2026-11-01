import { Button, TextArea } from '@omniviewdev/base-ui';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { parseDocument } from 'yaml';
import { Choice, Field, Section, scalarText, type ResourceFormProps } from './ResourceFormFields';
import { patchManifest, readManifestValue } from './manifestDraft';
import { dataEntries, decodeText, encodeBytes, encodeText, renameDataKey } from './dataDraft';
import styles from './DataForms.module.css';
import DataConfirmation from './DataConfirmation';
export { configMapFields } from './dataDraft';

export default function ConfigMapForm({ value, onChange, draft, section, editing, disabled, onValidityChange }: ResourceFormProps) {
  const [key, setKey] = useState('');
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState<string[]>([]);
  const file = useRef<HTMLInputElement>(null);
  const [renameFrom, setRenameFrom] = useState('');
  const [uploadKind, setUploadKind] = useState('text');
  const immutable = readManifestValue(draft, ['immutable']) === true;
  const locked = disabled || (editing && immutable);
  const latest = useRef(value);
  const mounted = useRef(true);
  const upload = useRef({ generation: 0, value, key, uploadKind, locked, renameFrom, section });
  useLayoutEffect(() => {
    latest.current = value;
    upload.current = { generation: upload.current.generation + 1, value, key, uploadKind, locked, renameFrom, section };
  }, [value, key, uploadKind, locked, renameFrom, section]);
  async function readUpload(selected: File): Promise<Uint8Array | null> {
    const generation = ++upload.current.generation;
    const source = value;
    const destination = key;
    let bytes: Uint8Array;
    try { bytes = new Uint8Array(await selected.arrayBuffer()); }
    catch (error) {
      if (!mounted.current || upload.current.generation !== generation || upload.current.locked) return null;
      throw error;
    }
    const current = upload.current;
    return mounted.current && !current.locked && current.generation === generation && current.value === source && current.key === destination && current.uploadKind === uploadKind ? bytes : null;
  }
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; upload.current.generation++; }; }, []);
  useEffect(() => { onValidityChange?.(error || (key ? 'Add or clear the pending entry key.' : null)); }, [error, key, onValidityChange]);
  useEffect(() => () => onValidityChange?.(null), [onValidityChange]);
  const entries = ['data', 'binaryData'].flatMap((field) => Object.entries(dataEntries(draft, field)).map(([name, text]) => ({ field, name, text })));
  const add = (text: string, binary: boolean) => {
    if (!/^[A-Za-z0-9._-]+$/.test(key)) { setError('Enter a valid entry key.'); return; }
    if (!mounted.current) return;
    const current = parseDocument(latest.current);
    if (current.hasIn(['data', key]) || current.hasIn(['binaryData', key])) { setError('This key already exists in text or binary entries.'); return; }
    onChange(patchManifest(latest.current, [{ path: [binary ? 'binaryData' : 'data', key], value: text }]));
    setKey(''); setError('');
  };
  const [pending, setPending] = useState<{ source: string; section: string; kind: 'immutable' | 'convert'; field?: string; name?: string } | null>(null);
  const confirmation = <DataConfirmation open={!!pending && pending.source === value && pending.section === section && !locked}
    title={pending?.kind === 'immutable' ? 'Enable immutability?' : 'Convert entry?'}
    description={pending?.kind === 'immutable' ? 'Permanent: entries cannot be changed after saving.' : 'Text and binary conversion may change bytes. This changes only the selected entry.'}
    onCancel={() => setPending(null)} onConfirm={() => {
      const action = pending; setPending(null);
      if (!action || action.source !== latest.current || action.section !== section || locked) return;
      if (action.kind === 'immutable') { onChange(patchManifest(latest.current, [{ path: ['immutable'], value: true }])); return; }
      const entry = entries.find((item) => item.field === action.field && item.name === action.name);
      if (!entry) return;
      try { onChange(patchManifest(latest.current, [{ path: [entry.field, entry.name], remove: true }, { path: [entry.field === 'data' ? 'binaryData' : 'data', entry.name], value: entry.field === 'data' ? encodeText(entry.text) : decodeText(entry.text) }])); setError(''); }
      catch { setError('These bytes are not valid UTF-8. Keep the binary entry.'); }
    }} />;
  async function handleFileSelection(selected: File): Promise<void> {
    try {
      const bytes = await readUpload(selected);
      if (bytes) add(uploadKind === 'binary' ? encodeBytes(bytes) : new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes), uploadKind === 'binary');
    } catch {
      if (mounted.current) setError('This file could not be read as UTF-8. Choose original binary bytes explicitly if needed.');
    }
  }
  if (section === 'basics') return <Section title="ConfigMap" action={confirmation}><Field label="Name" value={scalarText(readManifestValue(draft, ['metadata', 'name']) ?? '')} disabled={disabled || editing} onChange={(text) => onChange(patchManifest(value, [{ path: ['metadata', 'name'], value: text }]))} /><Field label="Namespace" value={scalarText(readManifestValue(draft, ['metadata', 'namespace']) ?? '')} disabled={disabled || editing} onChange={(text) => onChange(patchManifest(value, [{ path: ['metadata', 'namespace'], value: text }]))} /><Choice label="Immutable" value={immutable ? 'yes' : 'no'} options={[{ value: 'no', label: 'Mutable' }, { value: 'yes', label: 'Immutable' }]} disabled={locked} onChange={(next) => { if (locked) return; if (next === 'no') onChange(patchManifest(latest.current, [{ path: ['immutable'], value: false }])); else setPending({ source: value, section, kind: 'immutable' }); }} />{immutable && <p role="note">Permanent: entries cannot be changed after saving.</p>}</Section>;
  return <Section title="Entries" action={confirmation}><div className={styles.stack}>{entries.map(({ field, name, text }) => <div className={styles.card} key={`${field}:${name}`}><div className={styles.row}><strong>{name}</strong><span>{field === 'data' ? `${new TextEncoder().encode(text).length} bytes · Text` : 'Binary'}</span><Button size="sm" variant="ghost" onClick={() => setExpanded((current) => current.includes(name) ? current.filter((item) => item !== name) : [...current, name])}>{expanded.includes(name) ? 'Collapse' : 'Expand'}</Button><Button size="sm" variant="ghost" disabled={locked} onClick={() => onChange(patchManifest(value, [{ path: [field, name], remove: true }]))}>Remove</Button></div>{field === 'data' && (expanded.includes(name) ? <TextArea.Root><TextArea.Control aria-label="Entry text" rows={7} value={text} disabled={locked} onChange={(event) => onChange(patchManifest(value, [{ path: [field, name], value: event.target.value }]))} /></TextArea.Root> : <Field label="Value" value={text} disabled={locked} onChange={(next) => onChange(patchManifest(value, [{ path: [field, name], value: next }]))} />)}<Button size="sm" variant="ghost" disabled={locked} onClick={() => {
    setPending({ source: value, section, kind: 'convert', field, name });
  }}>Convert to {field === 'data' ? 'binary' : 'text'}</Button></div>)}<div className={styles.card}><Field label="New entry key" value={key} disabled={locked} onChange={setKey} /><div className={styles.row}><Button size="sm" disabled={locked} onClick={() => add('', false)}>Add text entry</Button><Choice label="File content" value={uploadKind} onChange={setUploadKind} disabled={locked} options={[{ value: 'text', label: 'UTF-8 text' }, { value: 'binary', label: 'Original binary bytes' }]} /><Button size="sm" disabled={locked} onClick={() => file.current?.click()}>Upload file</Button><input ref={file} type="file" hidden disabled={locked} aria-label="Upload ConfigMap file" onChange={(event) => {
    const selected = event.target.files?.[0]; event.target.value = ''; if (!selected) return;
    void handleFileSelection(selected);
  }} /></div><Choice label="Rename existing entry" value={renameFrom} disabled={locked} options={[{ value: '', label: 'Choose entry' }, ...entries.map((entry) => ({ value: `${entry.field}:${entry.name}`, label: entry.name }))]} onChange={setRenameFrom} /><Button size="sm" disabled={locked || !renameFrom || !key} onClick={() => { const [field, previous] = renameFrom.split(':'); try { onChange(renameDataKey(value, field, previous, key)); setKey(''); setRenameFrom(''); setError(''); } catch { setError('Enter a valid, unique key to rename this entry.'); } }}>Rename to new entry key</Button></div>{error && <div role="alert">{error}<Button size="sm" variant="ghost" onClick={() => setError('')}>Dismiss</Button></div>}{locked && <p role="note">Entries are locked.</p>}</div></Section>;
}
