import Box from '@mui/material/Box';
import Divider from '@mui/material/Divider';
import { Button } from '@omniviewdev/ui/buttons';
import { Stack } from '@omniviewdev/ui/layout';
import { Modal } from '@omniviewdev/ui/overlays';
import { Text } from '@omniviewdev/ui/typography';
import React from 'react';
import { LuTriangleAlert } from 'react-icons/lu';

const modalBodySx = { p: 2, minWidth: 360 } as const;

const headerSx = { mb: 1 } as const;

const contentSx = { py: 2 } as const;

type Props = {
  open: boolean;
  connectionName: string;
  onConfirm: () => void;
  onCancel: () => void;
};

const DeleteConfirmationModal: React.FC<Props> = ({
  open,
  connectionName,
  onConfirm,
  onCancel,
}) => (
  <Modal open={open} onClose={onCancel}>
    <Box sx={modalBodySx}>
      <Stack direction="row" alignItems="center" gap={1} sx={headerSx}>
        <LuTriangleAlert size={20} />
        <Text weight="semibold">Delete Connection</Text>
      </Stack>
      <Divider />
      <Box sx={contentSx}>
        <Text>
          Are you sure you want to delete <strong>{connectionName}</strong>? This action cannot be
          undone.
        </Text>
      </Box>
      <Stack direction="row" justifyContent="flex-end" gap={1}>
        <Button emphasis="solid" color="danger" onClick={onConfirm}>
          Delete
        </Button>
        <Button emphasis="ghost" color="neutral" onClick={onCancel}>
          Cancel
        </Button>
      </Stack>
    </Box>
  </Modal>
);

export default DeleteConfirmationModal;
