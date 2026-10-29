import { Banner, Button, Dialog, Input, Slider } from '@omniviewdev/base-ui';
import React from 'react';
import { LuScaling } from 'react-icons/lu';

const dialogStyle = { maxWidth: 400 } as const;
const bodyStyle = { display: 'flex', flexDirection: 'column', gap: 16 } as const;
const resourceNameStyle = {
  fontSize: '0.8125rem',
  fontFamily: 'var(--ov-font-mono, monospace)',
  color: 'var(--ov-color-fg-default)',
  fontWeight: 600,
} as const;
const compareRowStyle = { display: 'flex', gap: 24 } as const;
const columnCenterStyle = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  flex: 1,
} as const;
const replicaLabelStyle = {
  fontSize: '0.6875rem',
  color: 'var(--ov-color-fg-subtle)',
  marginBottom: 4,
} as const;
const valueBaseStyle = {
  fontSize: '1.5rem',
  fontWeight: 700,
  fontFamily: 'var(--ov-font-mono, monospace)',
} as const;
const currentValueStyle = { ...valueBaseStyle, color: 'var(--ov-color-fg-muted)' } as const;
const desiredChangedStyle = { ...valueBaseStyle, color: 'var(--ov-color-brand-500)' } as const;
const desiredSameStyle = { ...valueBaseStyle, color: 'var(--ov-color-fg-default)' } as const;
const arrowStyle = {
  display: 'flex',
  alignItems: 'center',
  color: 'var(--ov-color-fg-subtle)',
} as const;
const sliderRowStyle = { display: 'flex', alignItems: 'center', gap: 16 } as const;
const sliderStyle = { flex: 1 } as const;
const inputRootStyle = { width: 64 } as const;
const inputControlStyle = { textAlign: 'center' } as const;

type ScaleModalProps = {
  open: boolean;
  onClose: () => void;
  onConfirm: (replicas: number) => void;
  resourceType: string;
  resourceName: string;
  currentReplicas: number;
  isExecuting?: boolean;
};

const ScaleModal: React.FC<ScaleModalProps> = (props) =>
  props.open ? <ScaleForm key={JSON.stringify([props.resourceType, props.resourceName])} {...props} /> : null;

// Each open resource owns its draft. Live replica updates never overwrite an edit.
const ScaleForm: React.FC<ScaleModalProps> = ({
  open,
  onClose,
  onConfirm,
  resourceType,
  resourceName,
  currentReplicas,
  isExecuting,
}) => {
  const [replicaDraft, setReplicas] = React.useState<number>();
  const replicas = replicaDraft ?? currentReplicas;

  const maxSlider = Math.max(currentReplicas * 3, 10);

  const handleSliderChange = (value: number | readonly number[]) => {
    setReplicas(Array.isArray(value) ? (value[0] as number) : (value as number));
  };

  const changed = replicas !== currentReplicas;

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseInt(e.target.value, 10);
    if (!isNaN(val) && val >= 0) setReplicas(val);
  };

  return (
    <Dialog open={open} onClose={onClose} size="sm" style={dialogStyle}>
      <Dialog.Close aria-label="Close" />
      <Dialog.Title icon={<LuScaling size={16} color="var(--ov-color-brand-500)" />}>
        Scale {resourceType}
      </Dialog.Title>

      <Dialog.Body>
        <div style={bodyStyle}>
          <div style={resourceNameStyle}>{resourceName}</div>

          {/* Current vs Desired */}
          <div style={compareRowStyle}>
            <div style={columnCenterStyle}>
              <div style={replicaLabelStyle}>Current</div>
              <div style={currentValueStyle}>{currentReplicas}</div>
            </div>
            <div style={arrowStyle}>→</div>
            <div style={columnCenterStyle}>
              <div style={replicaLabelStyle}>Desired</div>
              <div style={changed ? desiredChangedStyle : desiredSameStyle}>{replicas}</div>
            </div>
          </div>

          {/* Slider + Input */}
          <div style={sliderRowStyle}>
            <Slider.Root
              value={replicas}
              onValueChange={handleSliderChange}
              min={0}
              max={maxSlider}
              step={1}
              color="brand"
              size="sm"
              style={sliderStyle}
              aria-label="Desired replicas"
            >
              <Slider.Control>
                <Slider.Track>
                  <Slider.Indicator />
                  <Slider.Thumb />
                </Slider.Track>
              </Slider.Control>
            </Slider.Root>
            <Input.Root size="sm" style={inputRootStyle}>
              <Input.Control
                type="number"
                min={0}
                step={1}
                mono
                value={replicas}
                onChange={handleInputChange}
                style={inputControlStyle}
                aria-label="Desired replicas count"
              />
            </Input.Root>
          </div>

          {replicas === 0 && (
            <Banner color="warning" size="sm">
              <Banner.Content>
                Scaling to 0 will stop all pods in this {resourceType.toLowerCase()}.
              </Banner.Content>
            </Banner>
          )}
        </div>
      </Dialog.Body>

      <Dialog.Footer>
        <Button size="sm" variant="outline" color="neutral" onClick={onClose}>
          Cancel
        </Button>
        <Button
          size="sm"
          variant="solid"
          color="success"
          disabled={!changed || isExecuting}
          onClick={() => onConfirm(replicas)}
        >
          {isExecuting ? 'Scaling...' : 'Scale'}
        </Button>
      </Dialog.Footer>
    </Dialog>
  );
};

export default ScaleModal;
