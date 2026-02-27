import { WarningRounded } from '@mui/icons-material';
import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import Divider from '@mui/material/Divider';
import { useResource } from '@omniviewdev/runtime';
import { Button } from '@omniviewdev/ui/buttons';
import { Alert } from '@omniviewdev/ui/feedback';
import { Stack } from '@omniviewdev/ui/layout';
import { Modal } from '@omniviewdev/ui/overlays';
import { Text } from '@omniviewdev/ui/typography';
import * as React from 'react';
import { LuCircleAlert, LuTrash } from 'react-icons/lu';

// ---------------------------------------------------------------------------
// Static styles
// ---------------------------------------------------------------------------

const listItemSx = { listStyle: 'none' } as const;
const deleteRowStackSx = { flex: 1, px: 1, alignItems: 'center', justifyContent: 'flex-start' } as const;
const deleteLabelSx = { pl: 0.5 } as const;
const modalBodySx = { p: 2, minWidth: 360 } as const;
const confirmHeaderSx = { mb: 1 } as const;
const confirmBodySx = { py: 2, display: 'flex', flexDirection: 'column', gap: 2 } as const;
const alertWrapperSx = { display: 'flex', gap: 2, width: '100%', flexDirection: 'column' } as const;
const alertSx = { alignItems: 'flex-start' } as const;
const alertTextSx = { color: 'danger.main' } as const;

type Props = {
  plugin: string;
  connection: string;
  resource: string;
  namespace: string;
  id: string;
  handleSelect: () => void;
  handleDeselect: () => void;
  handleDismiss: () => void;
};

export const DeleteAction: React.FC<Props> = ({
  id,
  resource,
  plugin,
  connection,
  namespace,
  handleSelect,
  handleDeselect,
  handleDismiss,
}) => {
  const [open, setOpen] = React.useState<boolean>(false);
  const [pending, setPending] = React.useState<boolean>(false);
  const [alert, setAlert] = React.useState<string>('');

  const { remove } = useResource({
    pluginID: plugin,
    connectionID: connection,
    resourceKey: resource,
    resourceID: id,
    namespace,
  });

  return (
    <React.Fragment>
      <Box component="li" sx={listItemSx}>
        <Box
          component="button"
          onMouseEnter={handleSelect}
          onMouseLeave={handleDeselect}
          onClick={() => {
            setOpen(true);
          }}
          sx={{
            display: 'flex',
            borderRadius: '2px',
            flex: 1,
            width: '100%',
            border: 'none',
            background: 'none',
            cursor: 'pointer',
            bgcolor: open ? 'action.hover' : undefined,
            '&:focus-visible': {
              bgcolor: 'action.hover',
            },
            p: 0,
          }}
        >
          <Stack
            direction="row"
            gap={1}
            sx={deleteRowStackSx}
          >
            <LuTrash />
            <Text sx={deleteLabelSx} size="sm">
              Delete
            </Text>
          </Stack>
        </Box>
      </Box>
      <Modal
        open={open}
        onClose={() => {
          setOpen(false);
        }}
      >
        <Box sx={modalBodySx}>
          <Stack direction="row" alignItems="center" gap={1} sx={confirmHeaderSx}>
            <WarningRounded />
            <Text weight="semibold">Confirmation</Text>
          </Stack>
          <Divider />
          <Box sx={confirmBodySx}>
            <Text size="sm">
              Are you sure you want to delete {resource} &apos;{id}&apos;?
            </Text>
            {alert && (
              <Box sx={alertWrapperSx}>
                <Alert
                  sx={alertSx}
                  startAdornment={<LuCircleAlert />}
                  emphasis="soft"
                  color="danger"
                >
                  <div>
                    <div>Error</div>
                    <Text size="sm" sx={alertTextSx}>
                      {alert}
                    </Text>
                  </div>
                </Alert>
              </Box>
            )}
          </Box>
          <Stack direction="row" justifyContent="flex-end" gap={1}>
            <Button
              emphasis="solid"
              color="danger"
              onClick={() => {
                setPending(true);
                remove({})
                  .then(() => {
                    setOpen(false);
                    handleDismiss();
                  })
                  .catch((e) => {
                    if (e instanceof Error) {
                      setAlert(e.message);
                    }
                  })
                  .finally(() => {
                    setPending(false);
                  });
              }}
            >
              {pending ? <CircularProgress size={16} /> : 'Delete'}
            </Button>
            <Button
              emphasis="ghost"
              color="neutral"
              onClick={() => {
                setOpen(false);
                handleDismiss();
              }}
            >
              Cancel
            </Button>
          </Stack>
        </Box>
      </Modal>
    </React.Fragment>
  );
};

export default DeleteAction;
