import { Stack } from '@omniviewdev/ui/layout';
import { Condition } from 'kubernetes-types/meta/v1';

import ConditionChip from '../../../../shared/ConditionChip';

const conditionsStackSx = {
  scrollbarWidth: 'none',
  '&::-webkit-scrollbar': {
    display: 'none',
  },
} as const;

type Props = {
  conditions: Array<Condition> | undefined;

  /**
   * The default healthy color to use for all the conditions.
   * TODO: change so we can supply a map of status types
   */
  defaultHealthyColor?: 'success' | 'neutral';

  /**
   * The default healthy color to use for all the conditions.
   * TODO: change so we can supply a map of status types
   */
  defaultUnhealthyColor?: 'warning' | 'danger' | 'faded';
};

/**
 * Render a list of conditions for the table columns. The conditions here should
 * come from the status cell
 */
const ConditionsCell: React.FC<Props> = ({
  conditions,
  defaultHealthyColor,
  defaultUnhealthyColor,
}) => {
  if (!conditions) {
    return null;
  }

  return (
    <Stack
      direction={'row'}
      alignItems={'center'}
      justifyContent={'flex-start'}
      gap={0.5}
      overflow={'scroll'}
      sx={conditionsStackSx}
    >
      {conditions
        .filter((condition) => condition.status === 'True')
        .map((condition) => (
          <ConditionChip
            key={condition.type}
            condition={condition}
            healthyColor={defaultHealthyColor}
            unhealthyColor={defaultUnhealthyColor}
          />
        ))}
    </Stack>
  );
};

export default ConditionsCell;
