import type { Meta, StoryObj } from '@storybook/react-vite';

import ResourceDrawerContainer from '../../../../../../stories/containers/SidebarContainer';

import data from './mock.json';

import { IngressSidebar } from '.';

const meta = {
  title: 'Kubernetes/Sidebars/networkingv1/IngressSidebar',
  component: IngressSidebar,
  tags: ['autodocs'],
} satisfies Meta<typeof IngressSidebar>;

export default meta;
type Story = StoryObj<typeof meta>;

function withDrawer(title: string) {
  return [
    (Story: React.FC) => (
      <ResourceDrawerContainer
        type="networking::v1::Ingress"
        icon="LuGlobe"
        title={title}
        open
        onClose={() => {}}
      >
        <Story />
      </ResourceDrawerContainer>
    ),
  ];
}

export const Default: Story = {
  args: {
    ctx: {
      data: data as Record<string, unknown>,
      resource: { connectionID: 'ctx-1', id: 'web-ingress', key: 'networking::v1::Ingress', pluginID: 'kubernetes' },
    },
  },
  decorators: withDrawer(data.metadata.name),
};
