import { Chip } from '@omniviewdev/base-ui';
import type { Node } from 'kubernetes-types/core/v1';
import type { Condition } from 'kubernetes-types/meta/v1';

import ConditionChip from '../../../../shared/ConditionChip';
import styles from '../../shared/cells/cells.module.css';

const NodeConditionsCell: React.FC<{ node: Node }> = ({ node }) => (
  <div className={styles.scrollRow} style={{ justifyContent: 'flex-start', gap: 4 }}>
    {(node.status?.conditions as Condition[] | undefined)
      ?.filter((condition) => condition.type === 'Ready' || condition.status === 'True')
      .map((condition) => (
        <ConditionChip
          key={condition.type}
          condition={
            condition.type === 'Ready' && condition.status !== 'True'
              ? {
                  ...condition,
                  type: condition.status === 'False' ? 'Not Ready' : 'Ready Unknown',
                }
              : condition
          }
          flipped={condition.type.endsWith('Pressure') || condition.type === 'NetworkUnavailable'}
          unhealthyColor={
            condition.type === 'Ready'
              ? 'danger'
              : condition.type.endsWith('Pressure') || condition.type === 'NetworkUnavailable'
                ? 'warning'
                : undefined
          }
        />
      ))}
    {node.spec?.unschedulable && (
      <Chip size="xs" color="warning" variant="soft" style={{ borderRadius: 4 }}>
        Cordoned
      </Chip>
    )}
  </div>
);

export default NodeConditionsCell;
