import { Banner, Button, Dialog, Spinner, Stack, Text } from '@omniviewdev/base-ui';
import { useResource } from '@omniviewdev/runtime';
import * as React from 'react';
import { LuCircleAlert, LuTrash, LuTriangleAlert } from 'react-icons/lu';

import { PLUGIN_ID } from '@/pluginId';
const triggerWrapperStyle: React.CSSProperties = { display: 'flex' };

const deleteTextStyle = { paddingLeft: 4 } as const;

const triggerStyle: React.CSSProperties = {
  display: 'flex',
  flex: 1,
  borderRadius: 2,
  justifyContent: 'flex-start',
};

const triggerContentStyle = { flex: 1, paddingInline: 8 } as const;

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
    pluginID: PLUGIN_ID,
    connectionID,
    resourceKey,
    resourceID,
    namespace,
  });

  const close = () => {
    setOpen(false);
    handleDismiss?.();
  };

  return (
    <React.Fragment>
      <div style={triggerWrapperStyle}>
        <Button
          variant="ghost"
          color="neutral"
          onMouseEnter={handleSelect}
          onMouseLeave={handleDeselect}
          onClick={() => {
            setOpen(true);
          }}
          style={triggerStyle}
        >
          <Stack direction="row" spacing={2} align="center" justify="start" style={triggerContentStyle}>
            <LuTrash />
            <Text style={deleteTextStyle} size="sm">
              Delete
            </Text>
          </Stack>
        </Button>
      </div>
      <Dialog
        open={open}
        onClose={() => {
          setOpen(false);
        }}
        size="sm"
      >
        <Dialog.Title icon={<LuTriangleAlert />}>Confirmation</Dialog.Title>
        <Dialog.Body>
          <Stack direction="column" spacing={4}>
            <Text size="sm">Are you sure you want to delete &apos;{resourceID}&apos;?</Text>
            {alert && (
              <Banner color="danger">
                <Banner.Icon>
                  <LuCircleAlert />
                </Banner.Icon>
                <Banner.Content>
                  <Banner.Title>Error</Banner.Title>
                  <Text size="sm" tone="danger">
                    {alert}
                  </Text>
                </Banner.Content>
              </Banner>
            )}
          </Stack>
        </Dialog.Body>
        <Dialog.Footer>
          <Button
            variant="solid"
            color="danger"
            disabled={pending}
            onClick={() => {
              setPending(true);
              remove({})
                .then(() => {
                  close();
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
            {pending ? <Spinner size="sm" /> : 'Delete'}
          </Button>
          <Button variant="ghost" color="neutral" onClick={close}>
            Cancel
          </Button>
        </Dialog.Footer>
      </Dialog>
    </React.Fragment>
  );
};

export default DeleteAction;
