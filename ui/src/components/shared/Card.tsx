// @omniviewdev/ui
import Box from '@mui/material/Box';
import Divider from '@mui/material/Divider';
import { Card as UiCard, Avatar, Chip } from '@omniviewdev/ui';
import { Stack } from '@omniviewdev/ui/layout';
import { Text } from '@omniviewdev/ui/typography';
import React from 'react';

// project imports
import Icon from './Icon';

const outerCardSx = { p: 0, gap: 0 } as const;

const headerStackSx = { p: 1 } as const;

const avatarSx = { maxHeight: 16, maxWidth: 16, borderRadius: 4 } as const;

const chipSx = { borderRadius: '4px' } as const;

const bodyBoxSx = { p: 1 } as const;

export interface Props {
  title: string;
  icon?: string | React.ReactNode;
  titleDecorator?: string | number | React.ReactNode;
  children?: React.ReactNode;
}

/**
 * Renders a card for showing a key-value pairs of details
 */
export const Card: React.FC<Props> = ({ title, titleDecorator, icon, children }) => {
  return (
    <UiCard variant="outlined" sx={outerCardSx}>
      <Stack
        direction="row"
        gap={1}
        sx={headerStackSx}
        alignItems="center"
        justifyContent="space-between"
      >
        <Stack direction="row" alignItems="center" gap={1}>
          {icon &&
            (typeof icon === 'string' ? (
              icon.startsWith('http') ? (
                <Avatar
                  src={icon}
                  size="sm"
                  sx={avatarSx}
                />
              ) : (
                <Icon name={icon} size={14} />
              )
            ) : (
              icon
            ))}
          <Text weight="semibold" size="sm">
            {title}
          </Text>
        </Stack>
        {titleDecorator &&
          (typeof titleDecorator === 'string' || typeof titleDecorator === 'number' ? (
            <Chip
              sx={chipSx}
              size="sm"
              color="primary"
              emphasis="outline"
              label={String(titleDecorator)}
            />
          ) : (
            titleDecorator
          ))}
      </Stack>
      <Divider />
      <Box sx={bodyBoxSx}>{children}</Box>
    </UiCard>
  );
};

Card.displayName = 'Card';

export default Card;
