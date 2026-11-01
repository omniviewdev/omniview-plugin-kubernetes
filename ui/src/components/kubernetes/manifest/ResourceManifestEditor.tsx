import { SegmentedControl } from '@omniviewdev/base-ui';
import { useMemo, useState } from 'react';
import { LuBox, LuDatabase, LuFileCode2, LuSlidersHorizontal } from 'react-icons/lu';

import CodeEditor from '../../shared/CodeEditor';
import SimpleTooltip from '../../shared/SimpleTooltip';
import { inspectManifest, supportedWorkloadKind } from './manifestDraft';
import WorkloadForm, { type WorkloadSection } from './WorkloadForm';
import { useManifestMode } from './useManifestMode';
import styles from './ResourceManifestEditor.module.css';

export interface ResourceManifestEditorProps {
  value: string;
  onChange: (value: string) => void;
  resourceKey: string;
  editing?: boolean;
  disabled?: boolean;
  filename?: string;
  baseline?: string;
  diff?: boolean;
  context?: string;
}

export default function ResourceManifestEditor({ value, onChange, resourceKey, editing = false, disabled = false, filename = 'resource.yaml', baseline, diff = false, context }: ResourceManifestEditorProps) {
  const draft = useMemo(() => inspectManifest(value, resourceKey), [value, resourceKey]);
  const [preferredMode, chooseMode] = useManifestMode();
  const [section, setSection] = useState<WorkloadSection>('basics');
  const unavailable = draft.error ?? draft.formError;
  const supportedKind = supportedWorkloadKind(resourceKey);
  const formAvailable = !!draft.kind && !unavailable;
  const showForm = formAvailable && !diff && preferredMode === 'form';
  const activeSection = section === 'storage' && draft.kind !== 'StatefulSet' ? 'basics' : section;
  const sections = [
    { key: 'basics' as const, label: 'Basics', icon: <LuSlidersHorizontal size={15} /> },
    { key: 'containers' as const, label: 'Containers', icon: <LuBox size={15} /> },
    ...(draft.kind === 'StatefulSet' ? [{ key: 'storage' as const, label: 'Storage', icon: <LuDatabase size={15} /> }] : []),
  ];

  return <div className={styles.editor}>
    <div className={styles.toolbar}>
      <span className={styles.context}>{context || (diff ? 'Changes' : showForm ? 'Resource configuration' : filename)}</span>
      {supportedKind && !diff && <SegmentedControl size="sm" value={showForm ? 'form' : 'yaml'} onValueChange={(next) => {
        if (next === 'yaml' || (next === 'form' && formAvailable)) chooseMode(next);
      }} aria-label="Manifest editor mode">
        <SegmentedControl.Item value="form" disabled={!formAvailable || disabled}>Form</SegmentedControl.Item>
        <SegmentedControl.Item value="yaml" disabled={disabled}>YAML</SegmentedControl.Item>
      </SegmentedControl>}
      {diff && <span className={styles.modeBadge}><LuFileCode2 size={13} /> YAML diff</span>}
    </div>
    {!showForm && unavailable && <div className={styles.notice} role="status">{unavailable}</div>}
    {showForm ? <div className={styles.formLayout}>
      <nav className={styles.navigation} aria-label="Resource configuration sections">
        {sections.map((item) => <button key={item.key} type="button" className={styles.navItem} aria-current={activeSection === item.key ? 'page' : undefined} onClick={() => setSection(item.key)}>
          {item.icon}<span>{item.label}</span>
        </button>)}
        <SimpleTooltip content="Use YAML for fields not shown in the form. Switching views keeps the same manifest.">
          <button type="button" className={styles.yamlLink} disabled={disabled} onClick={() => chooseMode('yaml')}><LuFileCode2 size={14} /><span>Advanced YAML</span></button>
        </SimpleTooltip>
      </nav>
      <div className={styles.formScroll}>
        <WorkloadForm value={value} onChange={onChange} draft={draft} section={activeSection} editing={editing} disabled={disabled} />
      </div>
    </div> : <div className={styles.code}>
      <CodeEditor filename={filename} language="yaml" value={value} onChange={onChange} readOnly={disabled} diff={diff} original={baseline} height="100%" />
    </div>}
  </div>;
}
