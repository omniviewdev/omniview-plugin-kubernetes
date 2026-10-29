import { Button, Grid, IconButton, Input, Stack, Text, TextArea } from '@omniviewdev/base-ui';
import { useSnackbar, DrawerContext } from '@omniviewdev/runtime';
import { Secret } from 'kubernetes-types/core/v1';
import React from 'react';
import {
  LuClipboardCheck,
  LuClipboardCopy,
  LuEye,
  LuEyeOff,
  LuKey,
  LuPlus,
  LuRotate3D,
  LuSave,
  LuX,
  LuCircleX,
} from 'react-icons/lu';

import { isMultiLine } from '../../../utils/text';
import ObjectMetaSection from '../../shared/ObjectMetaSection';

const gridAlignCenterStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  alignContent: 'center',
};

const fullWidthStyle: React.CSSProperties = { width: '100%' };

const multilineRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  gap: 4,
  width: '100%',
};

const decodeEntries = (data?: Record<string, string>) => {
  if (!data) {
    return {};
  }
  // return a new data map with the decoded values
  return Object.fromEntries(
    Object.entries(data).map(([key, value]) => [key, atob(value)]),
  );
};

interface Props {
  ctx: DrawerContext<Secret>;
}

/**
 * Renders a sidebar for a Secret resource
 */
export const SecretSidebar: React.FC<Props> = ({ ctx }) => {
  const secret = ctx.data;

  // eslint-disable-next-line @typescript-eslint/unbound-method
  const { showSnackbar } = useSnackbar();
  const [shown, setShown] = React.useState<Record<string, boolean>>({});
  const [copied, setCopied] = React.useState<string | undefined>(undefined);

  const originalValues = decodeEntries(secret?.data);
  const [values, setValues] = React.useState<Record<string, string>>(originalValues);
  const [newValues, setNewValues] = React.useState<Array<Record<string, string>>>([]);
  const [edited, setEdited] = React.useState<boolean>(false);
  const [newErrors, setNewErrors] = React.useState<Record<number, string>>({});

  if (!secret) {
    return null;
  }

  // assert this is in fact a secret
  if (secret.kind !== 'Secret') {
    throw new Error('Invalid resource kind');
  }

  const checkNewForErrors = (index: number, key: string, value: string) => {
    if (values[key]) {
      setNewErrors((prev) => ({ ...prev, [index]: 'Key already exists' }));
    } else if (key === '') {
      setNewErrors((prev) => ({ ...prev, [index]: 'Key cannot be empty' }));
    } else if (key.match(/\s/)) {
      setNewErrors((prev) => ({
        ...prev,
        [index]: 'Key cannot contain whitespace',
      }));
    } else if (value === '' && newValues[index]?.value !== '') {
      setNewErrors((prev) => ({ ...prev, [index]: 'Value cannot be empty' }));
    } else if (newValues.some((val, idx) => val.key === key && idx !== index)) {
      setNewErrors((prev) => ({ ...prev, [index]: 'Key already exists' }));
    } else {
      setNewErrors((prev) => {
        // delete the error if it exists
        const newErrors = { ...prev };
        delete newErrors[index];
        return newErrors;
      });
    }
  };

  /**
   * Handle changing a secret value.
   * NOTE: The value should come in as an already decoded string to prevent extra overhead
   * at form edit time.
   */
  const handleChange = (key: string, value: string) => {
    // check first if the value is visible
    if (!shown[key]) {
      return;
    }

    setEdited(true);
    setValues((prev) => ({ ...prev, [key]: value }));
  };

  const handleAddKey = () => {
    setEdited(true);
    setNewValues([...newValues, { key: '', value: '' }]);
  };

  const handleEditNewKey = (index: number, key: string, value: string) => {
    setEdited(true);
    checkNewForErrors(index, key, value);
    setNewValues((newVals) => newVals.map((val, i) => (i === index ? { key, value } : val)));
  };

  const handleRemoveKey = (index: number) => {
    setEdited(true);
    setNewValues((newVals) => newVals.filter((_, i) => i !== index));
    setNewErrors((prev) => {
      const newErrors = { ...prev };
      delete newErrors[index];
      return newErrors;
    });
  };

  const handleClear = () => {
    setEdited(false);
    setValues(originalValues);
    setNewValues([]);
  };

  const handleSubmit = () => {
    // we decoded our values upfront to save on rerender performance, so re-encode them here
    const encodedExisting = Object.fromEntries(
      Object.entries(values).map(([key, value]) => [key, btoa(value)]),
    );

    // add our new values
    const encodedNew = Object.fromEntries(
      newValues.map((entry) => [entry.key, btoa(entry.value)]),
    );

    // Mutate the original secret's data in-place (expected by the drawer context)
    // eslint-disable-next-line react-hooks/immutability
    secret.data = { ...encodedExisting, ...encodedNew };

    try {
      setEdited(false);
      setNewValues([]);
    } catch (e) {
      console.error(e);
    }
  };

  const toggleShowSecret = (key: string) => {
    setShown((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  };

  const handleCopyToClipboard = (key: string, value: string) => {
    void navigator.clipboard.writeText(atob(value));
    setCopied(key);
    showSnackbar({
      message: 'Copied value to clipboard',
      status: 'success',
    });
  };

  const renderValueActions = (key: string, value: string) => (
    <Stack direction="row" spacing={0}>
      <IconButton
        aria-label="Copy value"
        variant="ghost"
        disabled={value === ''}
        onClick={() => handleCopyToClipboard(key, value)}
        size="sm"
      >
        {copied === key ? <LuClipboardCheck /> : <LuClipboardCopy />}
      </IconButton>
      <IconButton
        aria-label={shown[key] ? 'Hide value' : 'Show value'}
        variant="ghost"
        onClick={() => toggleShowSecret(key)}
        size="sm"
      >
        {shown[key] ? <LuEyeOff /> : <LuEye />}
      </IconButton>
    </Stack>
  );

  // compose your component here
  return (
    <Stack direction="column" spacing={2} style={fullWidthStyle}>
      <ObjectMetaSection data={secret.metadata} connectionID={ctx.resource?.connectionID} />
      <Stack
        direction="row"
        spacing={2}
        justify="between"
        align="center"
        style={{ paddingTop: 8, paddingLeft: 8 }}
      >
        <Stack direction="row" align="center" spacing={1}>
          <LuKey />
          <Text weight="semibold">Secrets</Text>
        </Stack>
        <Button variant="outline" startDecorator={<LuPlus />} size="sm" onClick={handleAddKey}>
          Add Entry
        </Button>
      </Stack>
      <Stack direction="column" spacing={0} style={{ gap: 2, paddingInline: 2 }}>
        {values !== undefined && (
          <Grid columns={12} spacing={1}>
            {Object.entries(values).map(([key, value]) => (
              <React.Fragment key={key}>
                <Grid.Item span={4} style={gridAlignCenterStyle}>
                  <Text size="sm">{key}</Text>
                </Grid.Item>
                <Grid.Item span={8}>
                  {shown[key] && isMultiLine(value) ? (
                    <div style={multilineRowStyle}>
                      {renderValueActions(key, value)}
                      <TextArea.Root style={{ flex: 1 }}>
                        <TextArea.Control
                          size="sm"
                          readOnly
                          value={shown[key] ? values[key] : '********'}
                        />
                      </TextArea.Root>
                    </div>
                  ) : (
                    <Input.Root style={fullWidthStyle}>
                      <Input.Control
                        size="sm"
                        endDecorator={renderValueActions(key, value)}
                        onChange={(e) => handleChange(key, e.target.value)}
                        value={shown[key] ? values[key] : '********'}
                      />
                    </Input.Root>
                  )}
                </Grid.Item>
              </React.Fragment>
            ))}
          </Grid>
        )}
        {/* Index keys are correct here: entries are user-editable form inputs with mutable keys */}
        {newValues.map((entry, index) => (
          // eslint-disable-next-line @eslint-react/no-array-index-key
          <Grid columns={12} spacing={1} key={index}>
            <Grid.Item span={4}>
              <Input.Root invalid={!!newErrors[index]} style={fullWidthStyle}>
                <Input.Control
                  size="sm"
                  aria-invalid={!!newErrors[index]}
                  onChange={(e) => handleEditNewKey(index, e.target.value, entry.value)}
                  endDecorator={
                    <IconButton
                      aria-label="Remove entry"
                      onClick={() => handleRemoveKey(index)}
                      size="xs"
                      variant="soft"
                    >
                      <LuX size={16} />
                    </IconButton>
                  }
                  value={newValues[index].key}
                />
                {!!newErrors[index] && (
                  <Text as="div" size="xs" tone="danger" style={{ marginTop: 4 }}>
                    {newErrors[index]}
                  </Text>
                )}
              </Input.Root>
            </Grid.Item>
            <Grid.Item span={8}>
              <Input.Root style={fullWidthStyle}>
                <Input.Control
                  size="sm"
                  onChange={(e) => handleEditNewKey(index, entry.key, e.target.value)}
                  value={newValues[index].value}
                />
              </Input.Root>
            </Grid.Item>
          </Grid>
        ))}
      </Stack>
      {edited && (
        <Stack direction="row" justify="between" spacing={2}>
          <Stack direction="row" spacing={2}>
            <Button
              variant="soft"
              startDecorator={<LuSave />}
              size="sm"
              onClick={handleSubmit}
              disabled={Object.keys(newErrors).length > 0}
            >
              Save
            </Button>
            <Button
              variant="soft"
              startDecorator={<LuRotate3D />}
              size="sm"
              onClick={() => { /* TODO: implement reload save */ }}
              disabled={Object.keys(newErrors).length > 0}
            >
              Save & Reload Resources
            </Button>
          </Stack>
          <Button
            variant="outline"
            color="neutral"
            startDecorator={<LuCircleX />}
            size="sm"
            onClick={handleClear}
          >
            Clear
          </Button>
        </Stack>
      )}
    </Stack>
  );
};

SecretSidebar.displayName = 'SecretSidebar';
export default SecretSidebar;
