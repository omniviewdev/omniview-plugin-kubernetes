import Box from '@mui/material/Box';
import Divider from '@mui/material/Divider';
import { FormField, TextField, TextArea } from '@omniviewdev/ui/inputs';
import { Stack } from '@omniviewdev/ui/layout';
import { Text } from '@omniviewdev/ui/typography';
import AvatarEditor from '../../components/connections/AvatarEditor';

import { formRowSx, formLabelColumnSx, formFieldColumnSx, formHintSx } from './constants';
import SectionWrapper from './SectionWrapper';

function IdentitySection({
  displayName,
  description,
  avatarUrl,
  avatarColor,
  connName,
  onDisplayNameChange,
  onDescriptionChange,
  onAvatarUrlChange,
  onAvatarColorChange,
}: {
  displayName: string;
  description: string;
  avatarUrl: string;
  avatarColor: string;
  connName: string;
  onDisplayNameChange: (v: string) => void;
  onDescriptionChange: (v: string) => void;
  onAvatarUrlChange: (v: string) => void;
  onAvatarColorChange: (v: string) => void;
}) {
  return (
    <SectionWrapper
      title="Identity"
      description="Customize how this cluster appears in the sidebar and connection list."
    >
      <Stack direction="column" gap={0}>
        {/* Avatar row */}
        <Box sx={formRowSx}>
          <Box sx={formLabelColumnSx}>
            <Text size="sm" weight="medium">
              Avatar
            </Text>
            <Text size="xs" sx={formHintSx}>
              Upload an image or pick a color
            </Text>
          </Box>
          <AvatarEditor
            name={displayName || connName}
            avatarUrl={avatarUrl}
            avatarColor={avatarColor}
            onAvatarUrlChange={onAvatarUrlChange}
            onAvatarColorChange={onAvatarColorChange}
          />
        </Box>
        <Divider />

        {/* Display name row */}
        <Box sx={formRowSx}>
          <Box sx={formLabelColumnSx}>
            <Text size="sm" weight="medium">
              Display Name
            </Text>
            <Text size="xs" sx={formHintSx}>
              Override the default context name
            </Text>
          </Box>
          <Box sx={formFieldColumnSx}>
            <FormField>
              <TextField
                size="sm"
                placeholder={connName}
                value={displayName}
                onChange={(e) => onDisplayNameChange(e)}
                fullWidth
              />
            </FormField>
          </Box>
        </Box>
        <Divider />

        {/* Description row */}
        <Box sx={formRowSx}>
          <Box sx={formLabelColumnSx}>
            <Text size="sm" weight="medium">
              Description
            </Text>
            <Text size="xs" sx={formHintSx}>
              Optional note for this cluster
            </Text>
          </Box>
          <Box sx={formFieldColumnSx}>
            <FormField>
              <TextArea
                size="sm"
                minRows={2}
                maxRows={4}
                placeholder="Optional description for this cluster"
                value={description}
                onChange={(e) => onDescriptionChange(e)}
                fullWidth
              />
            </FormField>
          </Box>
        </Box>
      </Stack>
    </SectionWrapper>
  );
}

export default IdentitySection;
