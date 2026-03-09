import type { Meta, StoryObj } from '@storybook/react-vite';
import SidebarSection from './SidebarSection';

const meta = {
  title: 'Shared/SidebarSection',
  component: SidebarSection,
  tags: ['autodocs'],
} satisfies Meta<typeof SidebarSection>;

export default meta;
type Story = StoryObj<typeof meta>;

export const SimpleTitle: Story = {
  args: {
    title: 'Configuration',
    children: <div style={{ padding: 8 }}>Body content goes here</div>,
  },
};

export const WithHeaderRight: Story = {
  args: {
    title: 'Status',
    headerRight: <span style={{ fontSize: 12, color: 'green' }}>3 conditions</span>,
    children: <div style={{ padding: 8 }}>Status details</div>,
  },
};

export const WithHeaderLeft: Story = {
  args: {
    title: 'Status',
    headerLeft: <span style={{ padding: '2px 6px', background: '#e8f5e9', borderRadius: 4, fontSize: 11 }}>Active</span>,
    children: <div style={{ padding: 8 }}>Namespace details</div>,
  },
};

export const CustomBodySx: Story = {
  args: {
    title: 'Conditions',
    bodySx: { display: 'flex', flexWrap: 'wrap', gap: 0.5 },
    children: (
      <>
        <span style={{ padding: '2px 8px', background: '#e8f5e9', borderRadius: 4, fontSize: 11 }}>Available</span>
        <span style={{ padding: '2px 8px', background: '#e8f5e9', borderRadius: 4, fontSize: 11 }}>Progressing</span>
      </>
    ),
  },
};
