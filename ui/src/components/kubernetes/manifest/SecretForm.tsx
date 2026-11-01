import { Button } from '@omniviewdev/base-ui';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Choice, Field, Section, scalarText, type ResourceFormProps } from './ResourceFormFields';
import { patchManifest, readManifestValue } from './manifestDraft';
import { changeSecretType, dataEntries, decodeText, dockerConfig, encodeBytes, removeSecretKey, replaceSecretKey, restoreSecretKey, secretTypes } from './dataDraft';
import styles from './DataForms.module.css';
import DataConfirmation from './DataConfirmation';
export { secretFields } from './dataDraft';

export default function SecretForm({ value, onChange, draft, section, editing, disabled, onValidityChange }: ResourceFormProps) {
  const originals = useRef(new Map<string, string>());
  const latest = useRef(value);
  const mounted = useRef(true);
  useLayoutEffect(() => { latest.current = value; }, [value]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const uploadTokens = useRef(new Map<string, number>());
  const uploadSequence = useRef(0);
  useEffect(() => () => { uploadTokens.current.clear(); }, []);
  const latestLock = useRef(false);
  function discardForType(next: string): void {
    uploadTokens.current.clear();
    const source = latest.current;
    onChange(changeSecretType(source, next));
  }
  function removeCredential(name: string): void {
    uploadTokens.current.delete(name);
    onChange(removeSecretKey(latest.current, name));
  }
  async function handleTlsUpload(file: File, name: string): Promise<void> {
    const token = ++uploadSequence.current;
    uploadTokens.current.set(name, token);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (!mounted.current || latestLock.current || uploadTokens.current.get(name) !== token) return;
      if (!originals.current.has(name)) originals.current.set(name, latest.current);
      const next = patchManifest(latest.current, [{ path: ['stringData', name], remove: true }, { path: ['data', name], value: encodeBytes(bytes) }]);
      latest.current = next;
      onChange(next);
      setFiles((current) => ({ ...current, [name]: file.name }));
      setError('');
      setIntents((current) => ({ ...current, [name]: 'replace' }));
    } catch {
      if (mounted.current && uploadTokens.current.get(name) === token) setError('File could not be read. No credential changed.');
    }
  }
  const [intents, setIntents] = useState<Record<string, 'replace' | 'remove'>>({});
  const [revealed, setRevealed] = useState<string[]>([]);
  const [key, setKey] = useState('');
  const [error, setError] = useState('');
  const [files, setFiles] = useState<Record<string, string>>({});
  const [registry, setRegistry] = useState({ server: '', username: '', password: '', email: '' });
  const [registryArmed, setRegistryArmed] = useState(false);
  const type = scalarText(readManifestValue(draft, ['type']) ?? 'Opaque');
  const immutable = readManifestValue(draft, ['immutable']) === true;
  const locked = disabled || (editing && immutable);
  useLayoutEffect(() => {
    latestLock.current = !!locked || type !== 'kubernetes.io/tls';
    uploadTokens.current.clear();
  }, [type, locked, section]);
  const data = dataEntries(draft, 'data');
  const plaintext = dataEntries(draft, 'stringData');
  const keys = [...new Set([...Object.keys(data), ...Object.keys(plaintext), ...Object.keys(intents)])];
  const [previousSection, setPreviousSection] = useState(section);
  if (previousSection !== section) {
    setPreviousSection(section);
    setRevealed([]);
  }
  useEffect(() => { onValidityChange?.(error || (key ? 'Add or clear the pending credential key.' : registryArmed && !registry.server.trim() ? 'Provide a registry server or cancel replacement.' : null)); }, [error, key, registryArmed, registry.server, onValidityChange]);
  useEffect(() => () => onValidityChange?.(null), [onValidityChange]);
  const remember = (name: string) => { if (!originals.current.has(name)) originals.current.set(name, value); };
  const arm = (name: string) => { remember(name); setIntents((current) => ({ ...current, [name]: 'replace' })); onChange(replaceSecretKey(value, name, '')); setRevealed([]); };
  const cancel = (name: string) => {
    uploadTokens.current.delete(name);
    setError('');
    const original = originals.current.get(name);
    if (original !== undefined) onChange(restoreSecretKey(value, original, name));
    originals.current.delete(name); setIntents((current) => { const next = { ...current }; delete next[name]; return next; }); setRevealed([]);
    setFiles((current) => { const next = { ...current }; delete next[name]; return next; });
  };
  const secretText = (name: string) => { try { return Object.hasOwn(plaintext, name) ? plaintext[name] : decodeText(data[name] ?? ''); } catch { return ''; } };
  const [pending, setPending] = useState<{ source: string; section: string; kind: 'immutable' | 'type' | 'registry'; next?: string } | null>(null);
  function applyType(next: string): void {
    discardForType(next); originals.current.clear(); setIntents({}); setRevealed([]); setFiles({}); setRegistry({ server: '', username: '', password: '', email: '' }); setRegistryArmed(false);
  }
  const confirmation = <DataConfirmation open={!!pending && pending.source === value && pending.section === section && !locked}
    title={pending?.kind === 'immutable' ? 'Enable immutability?' : pending?.kind === 'type' ? 'Discard credentials and change type?' : 'Replace Docker configuration?'}
    description={pending?.kind === 'immutable' ? 'Permanent: credentials cannot be changed after saving.' : pending?.kind === 'type' ? 'Changing type discards entered credential values.' : 'This replaces the whole Docker configuration. Other registry entries will be discarded.'}
    onCancel={() => setPending(null)} onConfirm={() => {
      const action = pending; setPending(null);
      if (!action || action.source !== latest.current || action.section !== section || locked) return;
      if (action.kind === 'immutable') onChange(patchManifest(latest.current, [{ path: ['immutable'], value: true }]));
      else if (action.kind === 'type' && action.next && !editing) applyType(action.next);
      else if (action.kind === 'registry' && type === 'kubernetes.io/dockerconfigjson') setRegistryArmed(true);
    }} />;
  if (section === 'basics') return <Section title="Secret" action={confirmation}><Field label="Name" value={scalarText(readManifestValue(draft, ['metadata', 'name']) ?? '')} disabled={disabled || editing} onChange={(text) => onChange(patchManifest(value, [{ path: ['metadata', 'name'], value: text }]))} /><Field label="Namespace" value={scalarText(readManifestValue(draft, ['metadata', 'namespace']) ?? '')} disabled={disabled || editing} onChange={(text) => onChange(patchManifest(value, [{ path: ['metadata', 'namespace'], value: text }]))} /><Choice label="Secret type" value={type} options={secretTypes.map((item) => ({ value: item, label: item }))} disabled={disabled || editing} onChange={(next) => {
    if (next === type) return;
    if (disabled || editing || locked) return;
    if (keys.length || Object.values(registry).some(Boolean)) { setPending({ source: value, section, kind: 'type', next }); return; }
    applyType(next);
  }} /><Choice label="Immutable" value={immutable ? 'yes' : 'no'} disabled={locked} options={[{ value: 'no', label: 'Mutable' }, { value: 'yes', label: 'Immutable' }]} onChange={(next) => { if (locked) return; if (next === 'no') onChange(patchManifest(latest.current, [{ path: ['immutable'], value: false }])); else setPending({ source: value, section, kind: 'immutable' }); }} />{immutable && <p role="note">Permanent: credentials cannot be changed after saving.</p>}</Section>;
  if (!secretTypes.includes(type)) return <p role="alert">This Secret type is not supported by Form. Source remains unchanged.</p>;
  return <Section title="Credentials" action={confirmation}><div className={styles.stack}><p role="note">Values hidden. Base64 is not encryption.</p>{type === 'Opaque' && <>{keys.map((name) => <div className={styles.card} key={name}><div className={styles.row}><strong>{name}</strong><span>{intents[name] === 'remove' ? 'Remove on save' : intents[name] === 'replace' ? 'Replacement' : 'Keep existing'}</span></div>{intents[name] === 'replace' ? <Field label="Replacement value" type="password" value={secretText(name)} disabled={locked} onChange={(text) => onChange(replaceSecretKey(value, name, text))} /> : intents[name] !== 'remove' && <Field label="Existing value" type={revealed.includes(name) ? 'text' : 'password'} value={revealed.includes(name) ? secretText(name) : '••••••••'} readOnly onChange={() => undefined} />}<div className={styles.row}>{!intents[name] && <><Button size="sm" variant="ghost" onClick={() => setRevealed((current) => current.includes(name) ? current.filter((item) => item !== name) : [...current, name])}>{revealed.includes(name) ? 'Hide' : 'Reveal'}</Button><Button size="sm" disabled={locked} onClick={() => arm(name)}>Replace</Button></>}{intents[name] && <Button size="sm" disabled={locked} onClick={() => cancel(name)}>Cancel change</Button>}<Button size="sm" variant="ghost" disabled={locked || intents[name] === 'remove'} onClick={() => { remember(name); removeCredential(name); setIntents((current) => ({ ...current, [name]: 'remove' })); setRevealed([]); }}>Remove</Button></div></div>)}<div className={styles.row}><Field label="New credential key" value={key} onChange={(next) => { setKey(next); setError(''); }} disabled={locked} /><Button size="sm" disabled={locked} onClick={() => { if (!/^[A-Za-z0-9._-]+$/.test(key) || keys.includes(key)) { setError('Enter a valid, unique credential key.'); return; } arm(key); setKey(''); setError(''); }}>Add credential</Button></div></>}{type === 'kubernetes.io/tls' && ['tls.crt', 'tls.key'].map((name) => <div className={styles.card} key={name}><strong>{name === 'tls.crt' ? 'Certificate chain' : 'Private key'}</strong><span>{files[name] ? 'Replacement file selected' : Object.hasOwn(data, name) || Object.hasOwn(plaintext, name) ? 'Existing value retained' : 'No file selected'}</span><SecretFileInput name={name} disabled={locked} onFile={handleTlsUpload} />{intents[name] && <Button size="sm" disabled={locked} onClick={() => cancel(name)}>Cancel change</Button>}</div>)}{type === 'kubernetes.io/dockerconfigjson' && <div className={styles.card}><p role="note">Saving registry credentials replaces the whole Docker configuration, including other registry entries. No login check is performed.</p>{!registryArmed ? <Button size="sm" disabled={locked} onClick={() => { if (!locked) setPending({ source: value, section, kind: 'registry' }); }}>Replace registry configuration</Button> : <>{(['server', 'username', 'password', 'email'] as const).map((field) => <Field key={field} label={field === 'server' ? 'Registry server' : field === 'email' ? 'Email (optional)' : field === 'username' ? 'Username' : 'Password'} type="password" value={registry[field]} disabled={locked} onChange={(text) => { const next = { ...registry, [field]: text }; setRegistry(next); remember('.dockerconfigjson'); onChange(replaceSecretKey(value, '.dockerconfigjson', dockerConfig(next.server, next.username, next.password, next.email))); setIntents((current) => ({ ...current, '.dockerconfigjson': 'replace' })); }} />)}<Button size="sm" onClick={() => { cancel('.dockerconfigjson'); setRegistry({ server: '', username: '', password: '', email: '' }); setRegistryArmed(false); }}>Cancel replacement</Button></>}</div>}{error && <p role="alert">{error}</p>}{locked && <p role="note">Credentials are locked.</p>}</div></Section>;
}

function SecretFileInput({ name, disabled, onFile }: {
  name: string; disabled?: boolean; onFile: (file: File, name: string) => Promise<void>;
}) {
  const label = name === 'tls.crt' ? 'Upload certificate chain' : 'Upload private key';
  return <label className={styles.upload}>Upload original bytes<input type="file" disabled={disabled} aria-label={label} onChange={(event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file) void onFile(file, name);
  }} /></label>;
}
