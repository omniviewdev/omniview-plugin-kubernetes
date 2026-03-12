import Box from '@mui/material/Box';
import TagInput from '../../components/connections/TagInput';

import { tagsContainerSx } from './constants';
import SectionWrapper from './SectionWrapper';

function TagsSection({
  tags,
  availableTags,
  onChange,
}: {
  tags: string[];
  availableTags: string[];
  onChange: (tags: string[]) => void;
}) {
  return (
    <SectionWrapper
      title="Tags"
      description="Organize clusters by environment, team, or any custom category."
    >
      <Box sx={tagsContainerSx}>
        <TagInput tags={tags} availableTags={availableTags} onChange={onChange} />
      </Box>
    </SectionWrapper>
  );
}

export default TagsSection;
