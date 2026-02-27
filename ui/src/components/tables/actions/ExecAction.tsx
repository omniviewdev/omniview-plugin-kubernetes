import Box from '@mui/material/Box';
import { exec } from '@omniviewdev/runtime/models';
import { Text } from '@omniviewdev/ui/typography';
import jsonpath from 'jsonpath';
import React from 'react';
import { LuSquareTerminal } from 'react-icons/lu';

import ActionMenuListItem from './ActionMenuListItem';

// ---------------------------------------------------------------------------
// Static styles
// ---------------------------------------------------------------------------

const listItemSx = { listStyle: 'none' } as const;
const submenuSx = {
  listStyle: 'none',
  p: 0.5,
  m: 0,
  bgcolor: 'background.surface',
  border: '1px solid',
  borderColor: 'divider',
  borderRadius: 'sm',
  boxShadow: 'md',
  minWidth: 100,
} as const;
const targetItemSx = {
  px: 1,
  py: 0.5,
  cursor: 'pointer',
  borderRadius: 'sm',
  '&:hover': { bgcolor: 'action.hover' },
} as const;

/** Command to detect the shell */
const DefaultShellCmd = ['/bin/sh', '-c', 'stty -echo && /bin/sh'];

type Props = {
  selected: boolean;
  handleSelect: () => void;
  handleDeselect: () => void;
  handleLeaveMenu: (getIsOnButton: () => boolean) => void;
  handleDismiss: () => void;
  itemProps: Record<string, unknown>;
  action: exec.Handler;
  plugin: string;
  connection: string;
  resource: string;
  data: Record<string, unknown>;
};

type ExecTarget = {
  label: string;
  params: Record<string, string>;
};

const calcTargets = (action: exec.Handler, data: Record<string, unknown>): ExecTarget[] => {
  const targets = [] as ExecTarget[];

  const datas = action.target_builder.paths.reduce<Array<Record<string, unknown>>>((acc, path) => {
    const values = jsonpath.query(data, path);
    if (Array.isArray(values)) {
      Array.prototype.push.apply(acc, values);
    } else {
      acc.push(values);
    }
    return acc;
  }, []);

  datas.forEach((data) => {
    const params: Record<string, string> = {};
    Object.entries(action.target_builder.selectors).forEach(([key, selector]) => {
      params[key] = jsonpath.query(data, selector)[0] as string;
    });

    targets.push({
      params,
      label: action.target_builder.label_selector
        ? params[action.target_builder.label_selector]
        : action.target_builder.label,
    });
  });

  return targets;
};

const ExecAction: React.FC<Props> = ({
  selected,
  handleSelect,
  handleDeselect,
  handleLeaveMenu,
  action,
  plugin,
  connection: _connection,
  resource,
  data,
  itemProps,
  handleDismiss,
}) => {
  const targets = calcTargets(action, data);

  const handlePerformExec = (_label: string, params: Record<string, string>) => {
    // TODO: use the created session options to launch exec
    void exec.SessionOptions.createFrom({
      params,
      resource_plugin: plugin,
      resource_key: resource,
      resource_data: data,
      command: DefaultShellCmd,
      tty: true,
    });
  };

  return (
    <Box component="li" sx={listItemSx}>
      <ActionMenuListItem
        label="Exec"
        icon={<LuSquareTerminal />}
        open={selected}
        onOpen={handleSelect}
        onLeaveMenu={handleLeaveMenu}
        menu={
          <Box
            component="ul"
            sx={submenuSx}
          >
            {targets.map((target) => (
              <Box
                component="li"
                key={target.label}
                sx={targetItemSx}
                onClick={() => {
                  handlePerformExec(target.label, target.params);
                  handleDeselect();
                  if (typeof itemProps.onClick === 'function') {
                    (itemProps.onClick as () => void)();
                  }
                  handleDismiss();
                }}
              >
                <Text size="sm">{target.label}</Text>
              </Box>
            ))}
          </Box>
        }
      >
        Exec
      </ActionMenuListItem>
    </Box>
  );
};

export default ExecAction;
