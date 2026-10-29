import type { Meta, StoryObj } from '@storybook/react-vite';
import { useMemo, useState } from 'react';

import EventsTable from './EventsTable';

const now = new Date().toISOString();

const events = Array.from({ length: 30 }, (_, i) => ({
  type: i % 3 === 0 ? 'Warning' : 'Normal',
  reason: i % 3 === 0 ? 'BackOff' : 'Pulled',
  message:
    i % 2 === 0
      ? 'Back-off restarting failed container manager in pod controller-manager-7d9f8c6b5-x2k4p_kube-system(1a2b3c4d-5e6f-7a8b-9c0d-1e2f3a4b5c6d)'
      : 'Successfully pulled image "registry.k8s.io/ingress-nginx/controller:v1.11.2" in 1.2s',
  count: i % 4,
  lastTimestamp: now,
  involvedObject: {
    kind: 'Pod',
    name: `a-very-long-pod-name-that-keeps-going-and-going-${i}-7d9f8c6b5-x2k4p`,
    namespace: 'kube-system',
  },
  metadata: { namespace: 'kube-system', creationTimestamp: now },
}));

const meta: Meta<typeof EventsTable> = {
  title: 'Dashboard/EventsTable',
  component: EventsTable,
  decorators: [
    (Story, ctx) => (
      <div style={{ width: (ctx.parameters.panelWidth as number | undefined) ?? 560, height: (ctx.parameters.panelHeight as number | undefined) ?? 'clamp(300px, 40vh, 600px)', overflow: 'hidden', display: 'flex', flexDirection: 'column', border: '1px solid var(--ov-color-border-default)' }}>
        <Story />
      </div>
    ),
  ],
};

export default meta;

export const LongContent: StoryObj<typeof EventsTable> = {
  args: { events, loading: false, connectionID: 'c1' },
};

export const Narrow: StoryObj<typeof EventsTable> = {
  args: { events, loading: false, connectionID: 'c1' },
  parameters: { panelWidth: 380 },
};

export const Wide: StoryObj<typeof EventsTable> = {
  args: { events, loading: false, connectionID: 'c1' },
  parameters: { panelWidth: 1100 },
};

// Real component fixture: use the Events list's listitem count to inspect mounted
// work, then scroll to the end or search "search-only-final-event". These are
// synthetic events, not a cluster transport or native CPU benchmark.
function ViewportFixture({ size }: { size: number }) {
  const [loading, setLoading] = useState(false);
  const [empty, setEmpty] = useState(false);
  const [generation, setGeneration] = useState(0);
  const [width, setWidth] = useState(560);
  const fixtureEvents = useMemo(() => Array.from({ length: size }, (_, index) => {
    const i = (index + generation) % size;
    const timestamp = new Date(Date.UTC(2026, 9, 29) - index * 1000).toISOString();
    return {
      type: i % 3 === 0 ? 'Warning' : 'Normal',
      reason: i === size - 1 ? 'search-only-final-event' : 'Pulled',
      message: i % 7 === 0 ? 'Long event message '.repeat(30) : `Event ${i}`,
      count: 1,
      lastTimestamp: timestamp,
      involvedObject: {
        kind: 'Pod',
        // Wrapping links produce genuinely different measured row heights.
        name: i % 5 === 0 ? `pod-${i}-${'long-name-'.repeat(18)}` : `pod-${i}`,
        namespace: 'default',
      },
    };
  }), [size, generation]);

  return (
    <div style={{ width, maxWidth: '100%', height: 500, display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <button type="button" onClick={() => setLoading((value) => !value)}>Toggle loading</button>
        <button type="button" onClick={() => setEmpty((value) => !value)}>Toggle empty</button>
        <button type="button" onClick={() => setGeneration((value) => value + 1)}>Reorder events</button>
        <button type="button" onClick={() => setWidth((value) => value === 560 ? 320 : 560)}>Resize panel</button>
        <span>{size.toLocaleString()} source events</span>
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
        <EventsTable events={empty ? [] : fixtureEvents} loading={loading} connectionID="c1" />
      </div>
    </div>
  );
}

export const Viewport300: StoryObj<typeof EventsTable> = {
  parameters: { panelWidth: 600, panelHeight: 520 },
  render: () => <ViewportFixture size={300} />,
};

export const Viewport3000: StoryObj<typeof EventsTable> = {
  parameters: { panelWidth: 600, panelHeight: 520 },
  render: () => <ViewportFixture size={3000} />,
};

export const Viewport30000: StoryObj<typeof EventsTable> = {
  parameters: { panelWidth: 600, panelHeight: 520 },
  render: () => <ViewportFixture size={30000} />,
};
