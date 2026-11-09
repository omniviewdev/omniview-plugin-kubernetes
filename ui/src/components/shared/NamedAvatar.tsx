import { Avatar } from '@omniviewdev/base-ui';
import React from 'react';

import { stringToColor } from '../../utils/color';

type Props = {
  value?: string;
  color?: string;
};

/**
 * Calculates the initials and background colour for the avatar
 * to get a deterministic naming and color.
 */
function stringAvatar(name: string): { bg: string; initials: string } {
  if (!name) {
    return { bg: 'var(--ov-color-fg-subtle)', initials: 'NA' };
  }

  if (name.length === 1) {
    return { bg: stringToColor(name), initials: name.toUpperCase() };
  }

  // Try splitting on space, then dash
  let parts = name.split(' ');
  if (parts.length === 1) parts = name.split('-');

  const initials =
    parts.length > 1
      ? `${parts[0][0].toUpperCase()}${parts[1][0].toUpperCase()}`
      : `${name[0].toUpperCase()}${name[1].toUpperCase()}`;

  return { bg: stringToColor(name), initials };
}

/**
 * Renders an avatar with deterministic initials and color derived from the name.
 */
const NamedAvatar: React.FC<Props> = ({ value = '', color }) => {
  const { bg, initials } = stringAvatar(value);
  return (
    <Avatar
      size="sm"
      shape="rounded"
      alt={value || 'NA'}
      fallback={initials}
      deterministic={false}
      fallbackProps={{ style: { backgroundColor: color ?? bg, color: '#fff' } }}
    />
  );
};

export default NamedAvatar;
