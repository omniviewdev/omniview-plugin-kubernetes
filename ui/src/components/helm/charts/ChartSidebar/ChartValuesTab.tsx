import React from 'react';
import Box from '@mui/material/Box';
import { IconButton } from '@omniviewdev/ui/buttons';
import { TabPanel } from '@omniviewdev/ui/navigation';
import { LuClipboardCopy, LuCheck } from 'react-icons/lu';

import CodeEditor from '../../../shared/CodeEditor';

interface Props {
  activeTab: string;
  valuesContent: string | undefined;
  copied: boolean;
  onCopy: () => void;
}

const VALUES_PANEL_HEIGHT = 500;

const valuesContainerSx = {
  position: 'relative',
  height: VALUES_PANEL_HEIGHT,
  border: '1px solid',
  borderColor: 'neutral.700',
  borderRadius: 'sm',
  overflow: 'hidden',
} as const;

const copyButtonSx = {
  position: 'absolute',
  top: 6,
  right: 6,
  zIndex: 10,
  bgcolor: 'rgba(0,0,0,0.5)',
  backdropFilter: 'blur(4px)',
  '&:hover': { bgcolor: 'rgba(0,0,0,0.7)' },
} as const;

const ChartValuesTab: React.FC<Props> = ({ activeTab, valuesContent, copied, onCopy }) => (
  <TabPanel value="values" activeValue={activeTab}>
    <Box
      sx={valuesContainerSx}
    >
      <CodeEditor
        filename="values.yaml"
        language="yaml"
        value={valuesContent ?? '# Loading...'}
        readOnly
        height={VALUES_PANEL_HEIGHT}
      />
      {/* Copy button overlay */}
      <IconButton
        size="xs"
        emphasis="ghost"
        color="neutral"
        onClick={onCopy}
        title={copied ? 'Copied!' : 'Copy values'}
        disabled={!valuesContent}
        sx={copyButtonSx}
      >
        {copied ? <LuCheck size={12} /> : <LuClipboardCopy size={12} />}
      </IconButton>
    </Box>
  </TabPanel>
);

ChartValuesTab.displayName = 'ChartValuesTab';
export default ChartValuesTab;
