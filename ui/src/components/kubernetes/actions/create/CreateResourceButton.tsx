import { Button } from '@omniviewdev/base-ui';
import { useResourceMutations } from '@omniviewdev/runtime';
import React from 'react';
import { LuPlus } from 'react-icons/lu';
import { parse } from 'yaml';

import { PLUGIN_ID } from '@/pluginId';

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
  const { create } = useResourceMutations({ pluginID: PLUGIN_ID });

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
        size="sm"
        variant="outline"
        color="neutral"
        startDecorator={<LuPlus size={13} />}
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
