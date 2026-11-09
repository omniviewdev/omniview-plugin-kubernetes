import { IconButton } from '@omniviewdev/base-ui';
import React from 'react';
import { LuStar } from 'react-icons/lu';

type Props = {
  isFavorite: boolean;
  onToggle: () => void;
};

const FavoriteButton: React.FC<Props> = ({ isFavorite, onToggle }) => {
  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onToggle();
  };

  return (
    <IconButton
      size="sm"
      variant="ghost"
      color={isFavorite ? 'warning' : 'neutral'}
      onClick={handleClick}
      aria-label={isFavorite ? 'Unfavorite' : 'Favorite'}
      aria-pressed={isFavorite}
    >
      <LuStar fill={isFavorite ? 'currentColor' : 'none'} />
    </IconButton>
  );
};

export default FavoriteButton;
