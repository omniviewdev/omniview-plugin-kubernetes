import { Chip } from '@omniviewdev/ui';
import { Stack } from '@omniviewdev/ui/layout';

const chipListStackSx = {
  scrollbarWidth: 'none',
  '&::-webkit-scrollbar': {
    display: 'none',
  },
} as const;

const chipSx = { borderRadius: '2px' } as const;

type Props = {
  values: string[];
};

export const ChipListCell = ({ getValue }: { getValue: () => unknown }) => {
  const val = getValue() as string[] | undefined;
  if (!val) {
    return null;
  }

  return <ChipList values={val} />;
};

const ChipList: React.FC<Props> = ({ values }) => {
  return (
    <Stack
      direction={'row'}
      overflow={'scroll'}
      gap={0.25}
      sx={chipListStackSx}
    >
      {values.map((value) => (
        <Chip key={value} size={'sm'} sx={chipSx} emphasis="outline" label={value} />
      ))}
    </Stack>
  );
};

export default ChipList;
