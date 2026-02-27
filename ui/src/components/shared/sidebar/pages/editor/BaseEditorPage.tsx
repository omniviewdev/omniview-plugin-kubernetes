import { Button } from '@omniviewdev/ui/buttons';
import { Stack } from '@omniviewdev/ui/layout';
import React from 'react';
import { LuFileCode, LuSave, LuX } from 'react-icons/lu';
import { stringify, parse } from 'yaml';

import { KubernetesResourceObject } from '../../../../../types/resource';
import CodeEditor from '../../../CodeEditor';

const outerStackSx = { flex: 1 } as const;

interface Props {
  kind?: string;
  resourceKey?: string;
  data?: KubernetesResourceObject;
  children?: React.ReactNode;
  onSubmit?: (value: Record<string, unknown>) => void;
}

/**
 * Displays the baseline editor for the monaco editor
 */
export const BaseEditorPage: React.FC<Props> = ({ data, kind, resourceKey, onSubmit }) => {
  const [value, setValue] = React.useState<string>(stringify(data));
  const [usingDiff, setUsingDiff] = React.useState<boolean>(false);
  const [changed, setChanged] = React.useState<boolean>(false);

  const filename = kind
    ? `${kind}/${data?.metadata?.uid}/spec.yaml`
    : `${data?.metadata?.uid}/spec.yaml`;
  // Use the resource key to construct a path that matches the schema fileMatch pattern
  // e.g. "file:///core::v1::Pod/spec.yaml" matches fileMatch "**/core::v1::Pod/*.yaml"
  const editorPath = resourceKey ? `file:///${resourceKey}/spec.yaml` : undefined;

  const onChange = (value: string) => {
    if (!changed) {
      setChanged(true);
    }
    setValue(value);
  };

  const handleSubmit = () => {
    if (onSubmit) {
      const val = parse(value) as Record<string, unknown>;
      onSubmit(val);
    }
  };

  /**
   * Make sure we update whenever the input data changes
   */
  React.useEffect(() => {
    setValue(stringify(data));
  }, [data]);

  const toggleDiff = () => setUsingDiff((prev) => !prev);

  const resetValue = () => {
    setChanged(false);
    setValue(stringify(data));
  };

  if (!data) {
    console.warn('BaseEditorPage: no data provided');
    return null;
  }

  // compose your component here
  return (
    <Stack sx={outerStackSx} gap={1} direction="column">
      <CodeEditor
        diff={usingDiff}
        original={stringify(data)}
        value={value}
        onChange={onChange}
        language="yaml"
        filename={filename}
        path={editorPath}
      />
      <Stack direction="row" justifyContent="space-between">
        <Button
          size="sm"
          emphasis="soft"
          color="neutral"
          startAdornment={<LuFileCode />}
          onClick={toggleDiff}
        >
          {usingDiff ? 'Show Editor' : 'Show Diff'}
        </Button>

        <Stack direction="row" gap={0.5}>
          <Button
            startAdornment={<LuX />}
            color="neutral"
            disabled={!changed}
            size="sm"
            emphasis="soft"
            onClick={resetValue}
          >
            Reset
          </Button>
          <Button
            startAdornment={<LuSave />}
            color="primary"
            disabled={!changed}
            size="sm"
            emphasis="soft"
            onClick={handleSubmit}
          >
            Submit
          </Button>
        </Stack>
      </Stack>
    </Stack>
  );
};

BaseEditorPage.displayName = 'BaseEditorPage';
export default BaseEditorPage;
