import { WarningRounded } from '@mui/icons-material';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Divider from '@mui/material/Divider';
import MuiIconButton from '@mui/material/IconButton';
import Modal from '@mui/material/Modal';
import { useResource } from '@omniviewdev/runtime';
import { ListItem } from '@omniviewdev/ui';
import { Button } from '@omniviewdev/ui/buttons';
import { Stack } from '@omniviewdev/ui/layout';
import { Text } from '@omniviewdev/ui/typography';
import * as React from 'react';
import { LuCircleAlert, LuTrash } from 'react-icons/lu';

const deleteTextSx = { pl: 0.5 } as const;

const modalBoxSx = {
  position: 'absolute',
  top: '50%',
  left: '50%',
  transform: 'translate(-50%, -50%)',
  bgcolor: 'background.paper',
  borderRadius: 2,
  p: 3,
} as const;

const dialogContentSx = { gap: 2 } as const;

const alertContainerSx = { display: 'flex', gap: 2, width: '100%', flexDirection: 'column' } as const;

const alertSx = { alignItems: 'flex-start' } as const;

type Props = {
  connectionID: string;
  resourceKey: string;
  resourceID: string;
  namespace: string;
  handleSelect?: () => void;
  handleDeselect?: () => void;
  handleDismiss?: () => void;
};

export const DeleteAction: React.FC<Props> = ({
  resourceID,
  resourceKey,
  connectionID,
  namespace,
  handleSelect,
  handleDeselect,
  handleDismiss,
}) => {
  const [open, setOpen] = React.useState<boolean>(false);
  const [pending, setPending] = React.useState<boolean>(false);
  const [alert, setAlert] = React.useState<string>('');

  const { remove } = useResource({
    pluginID: 'kubernetes',
    connectionID,
    resourceKey,
    resourceID,
    namespace,
  });

  return (
    <React.Fragment>
      <ListItem>
        <MuiIconButton
          color="default"
          onMouseEnter={handleSelect}
          onMouseLeave={handleDeselect}
          onClick={() => {
            setOpen(true);
          }}
          sx={{
            display: 'flex',
            borderRadius: '2px',
            flex: 1,
            bgcolor: open ? 'neutral.plainHoverBg' : undefined,
            '&:focus-visible': {
              bgcolor: 'neutral.plainHoverBg',
            },
          }}
        >
          <Stack
            direction="row"
            spacing={1}
            flex={1}
            px={1}
            alignItems={'center'}
            justifyContent="flex-start"
          >
            <LuTrash />
            <Text sx={deleteTextSx} size="sm">
              Delete
            </Text>
          </Stack>
        </MuiIconButton>
      </ListItem>
      <Modal
        open={open}
        onClose={() => {
          setOpen(false);
        }}
      >
        <Box
          sx={modalBoxSx}
        >
          <DialogTitle>
            <WarningRounded />
            Confirmation
          </DialogTitle>
          <Divider />
          <DialogContent sx={dialogContentSx}>
            <Text size="sm">Are you sure you want to delete &apos;{resourceID}&apos;?</Text>
            {alert && (
              <Box sx={alertContainerSx}>
                <Alert sx={alertSx} icon={<LuCircleAlert />} severity="error">
                  <div>
                    <div>Error</div>
                    <Text size="sm" color={'danger'}>
                      {alert}
                    </Text>
                  </div>
                </Alert>
              </Box>
            )}
          </DialogContent>
          <DialogActions>
            <Button
              emphasis="solid"
              color="danger"
              onClick={() => {
                setPending(true);
                remove({})
                  .then(() => {
                    setOpen(false);
                    handleDismiss?.();
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
              {pending ? <CircularProgress size="small" /> : 'Delete'}
            </Button>
            <Button
              emphasis="ghost"
              color="neutral"
              onClick={() => {
                setOpen(false);
                handleDismiss?.();
              }}
            >
              Cancel
            </Button>
          </DialogActions>
        </Box>
      </Modal>
    </React.Fragment>
  );
};

export default DeleteAction;
