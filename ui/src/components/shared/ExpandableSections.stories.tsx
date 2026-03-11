import type { Meta, StoryObj } from '@storybook/react-vite';
import ExpandableSections from './ExpandableSections';

const meta = {
  title: 'Shared/ExpandableSections',
  component: ExpandableSections,
  tags: ['autodocs'],
} satisfies Meta<typeof ExpandableSections>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Single: Story = {
  args: {
    sections: [
      { title: 'Details', children: <div style={{ padding: 8 }}>Section content here</div> },
    ],
  },
};

export const Multiple: Story = {
  args: {
    sections: [
      { title: 'Section A', children: <div style={{ padding: 8 }}>Content A</div> },
      { title: 'Section B', children: <div style={{ padding: 8 }}>Content B</div> },
      { title: 'Section C', children: <div style={{ padding: 8 }}>Content C</div> },
    ],
  },
};

export const Exclusive: Story = {
  args: {
    sections: [
      { title: 'Tab 1', children: <div style={{ padding: 8 }}>Only one at a time</div> },
      { title: 'Tab 2', children: <div style={{ padding: 8 }}>Exclusive mode</div> },
    ],
    exclusive: true,
  },
};

export const DefaultExpanded: Story = {
  args: {
    sections: [
      { title: 'Collapsed', children: <div style={{ padding: 8 }}>Not expanded</div> },
      { title: 'Open', defaultExpanded: true, children: <div style={{ padding: 8 }}>Already open</div> },
    ],
  },
};
