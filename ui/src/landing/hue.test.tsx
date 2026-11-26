import { Avatar } from '@omniviewdev/kit';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { hueOf } from './hue';

// A connection is one colour wherever it is drawn: the tile on the pages is the kit's Avatar, which takes its hue from the name, and the sidebar's row takes `hueOf`, the kit's rule written once. The kit does not export
// its rule, so this draws the Avatar itself and holds the two to each other: a change of the kit's rule is a failure here and not two colours for one connection.

afterEach(cleanup);

const NAMES = ['kind-k8s-landing-a', 'orders-prod', 'prod · config', 'prod · .kube/config', 'staging-eu', 'dev-sandbox', 'minikube', 'docker-desktop', 'ml-cmb-prd', 'Ünïcode · 日本語', '', '  padded  '];

describe('the hue of a connection', () => {
  it('is the hue of the Avatar the kit draws for its name, for every name, and one of the four hues the kit gives a name (never the colour of a state)', () => {
    for (const name of NAMES) {
      const { container, unmount } = render(<Avatar name={name} icon="server" />);
      const drawn = container.firstElementChild?.getAttribute('data-ov-color');
      expect(hueOf(name), `the hue of "${name}"`).toBe(drawn);
      expect(['blue', 'purple', 'cyan', 'gray']).toContain(drawn);
      unmount();
    }

    expect(new Set(NAMES.map(hueOf)).size).toBeGreaterThan(1);
  });
});
