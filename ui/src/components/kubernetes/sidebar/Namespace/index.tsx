import { DrawerContext } from '@omniviewdev/runtime';
import { Namespace } from 'kubernetes-types/core/v1';
import React from 'react';

// types

// project-imports
import BaseOverviewPage from '../../../shared/sidebar/pages/overview/BaseOverviewPage';

interface Props {
  ctx: DrawerContext<Namespace>;
}

/**
 * Renders a sidebar for a Namespace resource
 */
export const NamespaceSidebar: React.FC<Props> = ({ ctx }) => {
  if (!ctx.data) {
    return null;
  }

  const obj = ctx.data;

  // compose your component here
  return <BaseOverviewPage data={obj} />;
};

NamespaceSidebar.displayName = 'NamespaceSidebar';
export default NamespaceSidebar;
