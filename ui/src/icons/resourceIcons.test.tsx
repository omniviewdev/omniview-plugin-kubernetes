// @vitest-environment jsdom
import React from 'react';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { kubernetesResourceIconSet as icons } from './resourceIcons';

const artwork = import.meta.glob('./kubernetes/*.svg', { eager: true, query: '?raw', import: 'default' }) as Record<string, string>;

afterEach(cleanup);
describe('Kubernetes resource icon set', () => {
  it('renders distinct inline artwork while preserving API-version and group aliases', () => {
    const markup = (key: string) => {
      const Icon = icons.resolve(key)!;
      const view = render(<Icon />);
      const body = view.container.querySelector('svg')!.innerHTML;
      view.unmount();
      return body;
    };
    const deployment = markup('apps::v1::Deployment');
    expect(markup('apps::v1beta1::Deployment')).toBe(deployment);
    expect(markup('core::v1::Pod')).not.toBe(deployment);
    expect(markup('rbac.authorization.k8s.io::v1::Role')).toBe(markup('rbac::v1beta1::Role'));
    expect(markup('networking.k8s.io::v1::Ingress')).toBe(markup('networking::v1beta1::Ingress'));
    expect(markup('storage.k8s.io::v1::StorageClass')).toBe(markup('storage::v1::StorageClass'));
  });

  it('inherits theme color without image requests and preserves icon sizing and accessibility', () => {
    const Icon = icons.resolve('core::v1::Pod')!;
    const { container } = render(<span style={{ color: 'rebeccapurple' }}><Icon size={20} className="native" aria-hidden={false} /></span>);
    const svg = container.querySelector('svg')!;
    expect(container.querySelector('img')).toBeNull();
    expect(svg.getAttribute('width')).toBe('20');
    expect(svg.getAttribute('height')).toBe('20');
    expect(svg.getAttribute('class')).toBe('native');
    expect(svg.getAttribute('aria-hidden')).toBe('false');
    expect(svg.getAttribute('focusable')).toBe('false');
    expect(svg.querySelector('[fill="currentColor"]')).not.toBeNull();
    expect(svg.querySelector('[fill="#326ce5"]')).toBeNull();
    expect(svg.hasAttribute('color')).toBe(false);
  });

  it('keeps every bundled inline asset restricted to inert monochrome geometry', () => {
    const tags: Record<string, true> = { svg: true, g: true, path: true, rect: true, circle: true, ellipse: true, polygon: true, polyline: true, line: true };
    const attributes: Record<string, true> = {
      xmlns: true, viewBox: true, d: true, transform: true, x: true, y: true, x1: true, x2: true, y1: true, y2: true,
      cx: true, cy: true, r: true, rx: true, ry: true, width: true, height: true, points: true,
      fill: true, 'fill-rule': true, 'fill-opacity': true, stroke: true, 'stroke-width': true,
      'stroke-linecap': true, 'stroke-linejoin': true, 'stroke-miterlimit': true, 'stroke-dasharray': true,
      'stroke-dashoffset': true, 'stroke-opacity': true, opacity: true,
    };
    expect(Object.keys(artwork)).toHaveLength(28);
    for (const [name, source] of Object.entries(artwork)) {
      const document = new DOMParser().parseFromString(source, 'image/svg+xml');
      expect(document.querySelector('parsererror'), name).toBeNull();
      expect(source, name).not.toMatch(/url\s*\(|javascript:|<!DOCTYPE|<!ENTITY/i);
      const viewBox = document.documentElement.getAttribute('viewBox')!.split(' ').map(Number);
      expect(viewBox.every(Number.isFinite), name).toBe(true);
      expect(viewBox[2], name).toBeGreaterThan(0);
      expect(viewBox[3], name).toBeGreaterThan(0);
      expect(document.querySelector('[fill="currentColor"], [stroke="currentColor"]'), name).not.toBeNull();
      for (const element of document.querySelectorAll('*')) {
        expect(Object.hasOwn(tags, element.localName), name).toBe(true);
        for (const attribute of element.attributes) {
          expect(Object.hasOwn(attributes, attribute.name), `${name}: ${attribute.name}`).toBe(true);
          if (attribute.name === 'fill' || attribute.name === 'stroke') {
            expect(['none', 'currentColor'], name).toContain(attribute.value);
          }
        }
      }
    }
  });

  it('leaves unknown and custom resources to the host fallback', () => {
    for (const key of ['example.io::v1::Pod', 'example.k8s.io::v1::Pod', 'core::v1::ReplicationController', 'core::v1::Unknown', 'Pod']) {
      expect(icons.resolve(key)).toBeUndefined();
    }
  });
});
