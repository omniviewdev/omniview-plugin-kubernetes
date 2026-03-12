import type { NavSection } from '@omniviewdev/ui/sidebars';

export const sidenavHeaderSx = { px: 1, py: 1, borderBottom: '1px solid', borderColor: 'divider' } as const;

export const clusterCardWrapperSx = { px: 1, py: 1 } as const;

export const clusterCardSx = {
  bgcolor: 'background.level1',
  border: '1px solid',
  borderColor: 'divider',
  borderRadius: 1,
  p: 1.25,
  display: 'flex',
  alignItems: 'center',
  gap: 1.25,
} as const;

export const avatarImgSx = { width: 40, height: 40, borderRadius: 1, '--Avatar-size': '40px' } as const;

export const clusterNameSx = { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } as const;

export const navMenuSx = { py: 0.5 } as const;

export const sectionWrapperHeaderSx = {
  display: 'flex',
  alignItems: 'center',
  gap: 1.5,
  pb: 2,
  borderBottom: '1px solid',
  borderColor: 'divider',
} as const;

export const sectionWrapperBodySx = { flex: 1, overflow: 'auto', minHeight: 0, pt: 2 } as const;

export const formRowSx = { py: 2.5, display: 'flex', gap: 4, alignItems: 'flex-start' } as const;

export const formLabelColumnSx = { minWidth: 180, maxWidth: 180, display: 'flex', flexDirection: 'column' } as const;

export const formFieldColumnSx = { flex: 1, maxWidth: 480 } as const;

export const tagsContainerSx = { maxWidth: 600 } as const;

export const infoRowSx = { py: 1.5, display: 'flex', gap: 4, alignItems: 'baseline' } as const;

export const infoLabelSx = { color: 'text.secondary', minWidth: 140 } as const;

export const sidenavColumnSx = { height: '100%' } as const;

export const headerTitleSx = { flex: 1, ml: 0.25 } as const;

export const clusterInfoColumnSx = { minWidth: 0, flex: 1 } as const;

export const sectionWrapperStackSx = { width: '100%', height: '100%' } as const;

export const mainPanelSx = { p: 3, overflow: 'auto' } as const;

export const formHintSx = { color: 'text.secondary', mt: 0.25 } as const;

export const sectionDescriptionSx = { color: 'text.secondary' } as const;

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
