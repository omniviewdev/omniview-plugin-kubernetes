import type React from 'react';

/**
 * Shared inline styles for the bordered "section card" layout used across the
 * kubernetes resource sidebars (status / config / topology sections, etc.).
 */

/** Quiet passive enclosure, matching the shared outlined Card. */
export const sectionBorderStyle: React.CSSProperties = {
  borderRadius: 4,
  border: '1px solid var(--ov-color-border-default)',
  backgroundColor: 'var(--ov-color-bg-surface)',
};

/** Header row with title on the left and extra content on the right. */
export const sectionHeaderStyle: React.CSSProperties = {
  padding: '4px 8px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 8,
};

/** Plain padded title area. */
export const sectionTitleStyle: React.CSSProperties = { padding: '4px 8px' };

/** Padded body area. */
export const sectionBodyStyle: React.CSSProperties = { padding: '4px 8px' };

/** A single label/value row inside a section body. */
export const entryRowStyle: React.CSSProperties = { minHeight: 22, alignItems: 'center' };

/** Bold small value text used by label/value rows. */
export const entryValueStyle: React.CSSProperties = { fontWeight: 600, fontSize: 12 };

/** Small rounded chip (MUI `borderRadius: 1`). */
export const roundedChipStyle: React.CSSProperties = { borderRadius: 4 };

/** Uppercase subsection label (e.g. "Security Context"). */
export const subsectionLabelStyle: React.CSSProperties = {
  fontSize: 10,
  textTransform: 'uppercase',
  letterSpacing: 0.5,
};
