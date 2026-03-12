import React from 'react';
import Box from '@mui/material/Box';
import { MarkdownPreview } from '@omniviewdev/ui/editors';
import { TabPanel } from '@omniviewdev/ui/navigation';
import { Text } from '@omniviewdev/ui/typography';

interface Props {
  activeTab: string;
  readmeContent: string | undefined;
}

const readmeWrapperSx = {
  '& img': { maxWidth: '100%' },
  '& .wmde-markdown': { fontSize: '0.8125rem', lineHeight: 1.5 },
  '& .wmde-markdown h1': { fontSize: '1.25rem', mt: 1, mb: 0.5 },
  '& .wmde-markdown h2': { fontSize: '1.1rem', mt: 1, mb: 0.5 },
  '& .wmde-markdown h3': { fontSize: '0.95rem', mt: 0.75, mb: 0.25 },
  '& .wmde-markdown h4, & .wmde-markdown h5, & .wmde-markdown h6': {
    fontSize: '0.875rem',
    mt: 0.5,
    mb: 0.25,
  },
  '& .wmde-markdown p': { fontSize: '0.8125rem', mb: 0.75 },
  '& .wmde-markdown li': { fontSize: '0.8125rem' },
  '& .wmde-markdown code': { fontSize: '0.75rem' },
  '& .wmde-markdown pre': { fontSize: '0.75rem' },
  '& .wmde-markdown table': { fontSize: '0.8125rem' },
  '& .wmde-markdown blockquote': { fontSize: '0.8125rem' },
} as const;

const emptyTextSx = { color: 'neutral.400' } as const;

const ChartReadmeTab: React.FC<Props> = ({ activeTab, readmeContent }) => (
  <TabPanel value="readme" activeValue={activeTab}>
    {readmeContent ? (
      <Box
        sx={readmeWrapperSx}
      >
        <MarkdownPreview source={readmeContent} />
      </Box>
    ) : readmeContent === '' ? (
      <Text size="sm" sx={emptyTextSx}>
        No README available for this chart.
      </Text>
    ) : (
      <Text size="sm" sx={emptyTextSx}>
        Loading README...
      </Text>
    )}
  </TabPanel>
);

ChartReadmeTab.displayName = 'ChartReadmeTab';
export default ChartReadmeTab;
