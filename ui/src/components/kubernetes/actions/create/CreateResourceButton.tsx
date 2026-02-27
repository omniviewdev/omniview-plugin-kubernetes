import { useResourceMutations } from '@omniviewdev/runtime';
import { Button } from '@omniviewdev/ui/buttons';
import React from 'react';
import { LuPlus } from 'react-icons/lu';
import { parse } from 'yaml';

import { parseResourceKey } from '../../../../utils/resourceKey';

import CreateResourceModal from './CreateResourceModal';

interface Props {
  connectionID: string;
  resourceKey: string;
}

const CreateResourceButton: React.FC<Props> = ({ connectionID, resourceKey }) => {
  const [open, setOpen] = React.useState(false);
  const [isCreating, setIsCreating] = React.useState(false);

  const { kind } = parseResourceKey(resourceKey);
  const { create } = useResourceMutations({ pluginID: 'kubernetes' });

  const handleCreate = async (yaml: string, namespace: string) => {
    setIsCreating(true);
    try {
      const parsed = parse(yaml) as Record<string, unknown>;
      const metadata = parsed.metadata as Record<string, unknown> | undefined;
      await create({
        opts: {
          connectionID,
          resourceKey,
          resourceID: (metadata?.name as string) ?? '',
          namespace,
        },
        input: {
          input: parsed,
          namespace,
        },
      });
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <>
      <Button
        size="xs"
        emphasis="outline"
        color="neutral"
        startAdornment={<LuPlus size={13} />}
        onClick={() => setOpen(true)}
      >
        Create {kind}
      </Button>
      <CreateResourceModal
        open={open}
        onClose={() => setOpen(false)}
        resourceKey={resourceKey}
        onCreate={handleCreate}
        isCreating={isCreating}
      />
    </>
  );
};

export default CreateResourceButton;
