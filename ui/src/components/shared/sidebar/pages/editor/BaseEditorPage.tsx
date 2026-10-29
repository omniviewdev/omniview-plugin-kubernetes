import { Button, Stack } from '@omniviewdev/base-ui';
import React from 'react';
import { LuFileCode, LuSave, LuX } from 'react-icons/lu';
import { stringify, parse } from 'yaml';

import { KubernetesResourceObject } from '../../../../../types/resource';
import CodeEditor from '../../../CodeEditor';

const outerStackStyle: React.CSSProperties = { flex: 1 };

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
  const original = React.useMemo(() => stringify(data), [data]);
  const scope = JSON.stringify([
    resourceKey,
    kind,
    data?.metadata?.uid,
    data?.metadata?.namespace,
    data?.metadata?.name,
  ]);
  const [draft, setDraft] = React.useState<{ scope: string; value?: string }>({ scope });
  const [usingDiff, setUsingDiff] = React.useState<boolean>(false);

  if (draft.scope !== scope) {
    setDraft({ scope });
  }
  const changed = draft.scope === scope && draft.value !== undefined;
  const value = draft.scope === scope ? draft.value ?? original : original;

  const filename = kind
    ? `${kind}/${data?.metadata?.uid}/spec.yaml`
    : `${data?.metadata?.uid}/spec.yaml`;
  // Use the resource key to construct a path that matches the schema fileMatch pattern
  // e.g. "file:///core::v1::Pod/spec.yaml" matches fileMatch "**/core::v1::Pod/*.yaml"
  const editorPath = resourceKey ? `file:///${resourceKey}/spec.yaml` : undefined;

  const onChange = (value: string) => {
    setDraft({ scope, value });
  };

  const handleSubmit = () => {
    if (onSubmit) {
      const val = parse(value) as Record<string, unknown>;
      onSubmit(val);
    }
  };

  const toggleDiff = () => setUsingDiff((prev) => !prev);

  const resetValue = () => {
    setDraft({ scope });
  };

  if (!data) {
    console.warn('BaseEditorPage: no data provided');
    return null;
  }

  // compose your component here
  return (
    <Stack style={outerStackStyle} spacing={2} direction="column">
      <CodeEditor
        diff={usingDiff}
        original={original}
        value={value}
        onChange={onChange}
        language="yaml"
        filename={filename}
        path={editorPath}
      />
      <Stack direction="row" justify="between">
        <Button
          size="sm"
          variant="soft"
          color="neutral"
          startDecorator={<LuFileCode />}
          onClick={toggleDiff}
        >
          {usingDiff ? 'Show Editor' : 'Show Diff'}
        </Button>

        <Stack direction="row" spacing={1}>
          <Button
            startDecorator={<LuX />}
            color="neutral"
            disabled={!changed}
            size="sm"
            variant="soft"
            onClick={resetValue}
          >
            Reset
          </Button>
          <Button
            startDecorator={<LuSave />}
            color="brand"
            disabled={!changed}
            size="sm"
            variant="soft"
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
