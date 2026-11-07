import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import ResourceTableErrorState from './ResourceTableErrorState';

describe('ResourceTableErrorState', () => {
  it('displays the detail from a structured resource error', () => {
    render(<ResourceTableErrorState resourceKey="k8s:apps/replicasets" error={{
      type: 'omniview:resource-limit', title: 'Resource limit', status: 429,
      detail: 'The resource response exceeds the limit.',
    }} />);

    expect(screen.getByText('The resource response exceeds the limit.')).toBeTruthy();
    expect(screen.queryByText('[object Object]')).toBeNull();
  });
});
