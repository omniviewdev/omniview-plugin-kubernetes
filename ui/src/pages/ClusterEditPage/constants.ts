import type React from 'react';

import type { NavSection } from '../../types/navigation';

const divider = '1px solid var(--ov-color-border-muted)';

export const sidenavHeaderStyle: React.CSSProperties = { padding: 8, borderBottom: divider };

export const clusterCardWrapperStyle: React.CSSProperties = { padding: 8 };

export const clusterCardStyle: React.CSSProperties = {
  background: 'var(--ov-color-bg-surface-raised)',
  border: '1px solid var(--ov-color-border-default)',
  borderRadius: 4,
  padding: 10,
  display: 'flex',
  alignItems: 'center',
  gap: 10,
};

export const avatarImgStyle: React.CSSProperties = { width: 40, height: 40, borderRadius: 4, flexShrink: 0 };

export const avatarFallbackStyle: React.CSSProperties = {
  width: 40,
  height: 40,
  borderRadius: 4,
  flexShrink: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: '#fff',
  fontSize: '0.875rem',
  fontWeight: 500,
};

export const navMenuStyle: React.CSSProperties = { paddingBlock: 4, paddingInline: 4 };

export const sectionWrapperHeaderStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  paddingBottom: 16,
  borderBottom: divider,
};

export const sectionWrapperBodyStyle: React.CSSProperties = { flex: 1, overflow: 'auto', minHeight: 0, paddingTop: 16 };

export const formRowStyle: React.CSSProperties = { paddingBlock: 20, display: 'flex', gap: 32, alignItems: 'flex-start' };

export const formLabelColumnStyle: React.CSSProperties = {
  minWidth: 180,
  maxWidth: 180,
  display: 'flex',
  flexDirection: 'column',
};

export const formFieldColumnStyle: React.CSSProperties = { flex: 1, maxWidth: 480 };

export const tagsContainerStyle: React.CSSProperties = { maxWidth: 600 };

export const infoRowStyle: React.CSSProperties = { paddingBlock: 12, display: 'flex', gap: 32, alignItems: 'baseline' };

export const infoLabelStyle: React.CSSProperties = { minWidth: 140 };

export const sidenavColumnStyle: React.CSSProperties = { height: '100%' };

export const headerTitleStyle: React.CSSProperties = { flex: 1, marginLeft: 2 };

export const clusterInfoColumnStyle: React.CSSProperties = { minWidth: 0, flex: 1 };

export const sectionWrapperStackStyle: React.CSSProperties = { width: '100%', height: '100%' };

export const mainPanelStyle: React.CSSProperties = { padding: 24, overflow: 'auto' };

export const formHintStyle: React.CSSProperties = { marginTop: 2 };

export type SectionId = 'identity' | 'tags' | 'cluster-info' | 'connection' | 'metrics' | 'node-shell';

export const SECTIONS: NavSection[] = [
  {
    title: 'General',
    items: [
      { id: 'identity', label: 'Identity' },
      { id: 'tags', label: 'Tags' },
      { id: 'cluster-info', label: 'Cluster Info' },
      { id: 'connection', label: 'Connection' },
    ],
  },
  {
    title: 'Configuration',
    items: [
      { id: 'metrics', label: 'Metrics' },
      { id: 'node-shell', label: 'Node Shell' },
    ],
  },
];
