import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { getTemplate } from './templates';

describe('native create templates', () => {
  it('uses an explicit selected native group/version/kind without schema', () => {
    const identity = { apiVersion: 'example.test/v7', kind: 'Widget', namespaced: true };
    expect(parse(getTemplate(identity))).toEqual({
      apiVersion: 'example.test/v7', kind: 'Widget', metadata: { name: 'my-widget', namespace: 'default' },
    });
  });

  it('keeps useful native examples but replaces version and respects catalog scope', () => {
    const body = parse(getTemplate({ apiVersion: 'apps/v9', kind: 'Deployment', namespaced: false }));
    expect(body.apiVersion).toBe('apps/v9');
    expect(body.kind).toBe('Deployment');
    expect(body.spec.template.spec.containers[0].image).toBe('nginx:latest');
    expect(body.metadata.namespace).toBeUndefined();
  });

  it('does not invent identity when no selected native target is known', () => {
    expect(parse(getTemplate())).toBeNull();
    expect(getTemplate()).toContain('Paste a complete Kubernetes YAML manifest');
  });
});
