// material-ui
import Box from '@mui/material/Box';
import Divider from '@mui/material/Divider';
import Modal from '@mui/material/Modal';
import { Button, IconButton } from '@omniviewdev/ui/buttons';
import { Stack } from '@omniviewdev/ui/layout';
import { Text } from '@omniviewdev/ui/typography';
import React from 'react';
import { LuPlus, LuX } from 'react-icons/lu';

// project-imports
import { parseResourceKey } from '../../../../utils/resourceKey';
import CodeEditor from '../../../shared/CodeEditor';

import { getTemplate } from './templates';

interface Props {
  open: boolean;
  onClose: () => void;
  resourceKey: string;
  onCreate: (yaml: string, namespace: string) => Promise<void>;
  isCreating?: boolean;
}

const modalStyle = {
  position: 'absolute' as const,
  top: '50%',
  left: '50%',
  transform: 'translate(-50%, -50%)',
  width: '90%',
  maxWidth: 1000,
  maxHeight: '90vh',
  bgcolor: 'background.paper',
  borderRadius: '6px',
  boxShadow: 24,
  p: 0,
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
};

const CreateResourceModal: React.FC<Props> = ({
  open,
  onClose,
  resourceKey,
  onCreate,
  isCreating,
}) => {
  const { kind } = parseResourceKey(resourceKey);
  const [value, setValue] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);

  // Reset template each time modal opens
  React.useEffect(() => {
    if (open) {
      setValue(getTemplate(resourceKey));
      setError(null);
    }
  }, [open, resourceKey]);

  const handleSubmit = async () => {
    setError(null);

    // Parse YAML
    let parsed: Record<string, any>;
    try {
      // Dynamic import to keep bundle lean — yaml is already installed
      const { parse } = await import('yaml');
      parsed = parse(value);
    } catch (err: any) {
      setError(`YAML syntax error: ${err?.message ?? 'Invalid YAML'}`);
      return;
    }

    if (!parsed || typeof parsed !== 'object') {
      setError('YAML must be a valid Kubernetes resource object');
      return;
    }

    // Validate required fields
    if (!parsed.metadata?.name) {
      setError('metadata.name is required');
      return;
    }

    const namespace = parsed.metadata?.namespace ?? '';

    try {
      await onCreate(value, namespace);
      onClose();
    } catch (err: any) {
      setError(err?.message ?? 'Failed to create resource');
    }
  };

  return (
    <Modal open={open} onClose={onClose}>
      <Box sx={modalStyle}>
        {/* Header */}
        <Stack
          direction="row"
          justifyContent="space-between"
          alignItems="center"
          sx={{ px: 2.5, pt: 2, pb: 1.5 }}
        >
          <Stack direction="row" alignItems="center" spacing={1}>
            <LuPlus size={16} />
            <Text weight="semibold" size="md">
              Create {kind}
            </Text>
          </Stack>
          <IconButton size="xs" emphasis="ghost" color="neutral" onClick={onClose}>
            <LuX size={14} />
          </IconButton>
        </Stack>
        <Divider />

        {/* Content — editor */}
        <Box sx={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <Box sx={{ height: 'calc(80vh - 120px)', overflow: 'hidden' }}>
            <CodeEditor
              filename={`${kind}.yaml`}
              language="yaml"
              value={value}
              onChange={(v) => setValue(v)}
              path={`file:///${resourceKey}/create.yaml`}
              height="100%"
            />
          </Box>

          {/* Inline error */}
          {error && (
            <Box
              sx={{
                px: 2.5,
                py: 1,
                bgcolor: 'rgba(248, 81, 73, 0.1)',
                borderTop: '1px solid rgba(248, 81, 73, 0.3)',
              }}
            >
              <Text size="xs" sx={{ color: '#f85149' }}>
                {error}
              </Text>
            </Box>
          )}
        </Box>

        {/* Footer */}
        <Divider />
        <Stack direction="row" spacing={1} justifyContent="flex-end" sx={{ px: 2.5, py: 1.5 }}>
          <Button size="xs" emphasis="ghost" color="neutral" onClick={onClose}>
            Cancel
          </Button>
          <Button
            size="xs"
            emphasis="solid"
            color="primary"
            disabled={isCreating}
            onClick={() => void handleSubmit()}
          >
            {isCreating ? 'Creating...' : 'Create'}
          </Button>
        </Stack>
      </Box>
    </Modal>
  );
};

export default CreateResourceModal;
