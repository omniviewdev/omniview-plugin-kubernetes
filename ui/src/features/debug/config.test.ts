import {
  BUILTIN_DEBUG_TEMPLATES,
  resolveDebugTemplate,
  saveDebugTemplate,
  setClusterDebugDefault,
  validateDebugTemplate,
} from './config';
import type { DebugConfig, DebugTemplate } from './config';

function template(overrides: Partial<DebugTemplate> = {}): DebugTemplate {
  return {
    id: 'custom-shell',
    name: 'Team shell',
    image: 'busybox:1.37.0',
    command: ['sh'],
    profile: 'restricted',
    imagePullPolicy: 'IfNotPresent',
    env: {},
    ...overrides,
  };
}

function config(overrides: Partial<DebugConfig> = {}): DebugConfig {
  return {
    customTemplates: [],
    defaultTemplateId: null,
    clusterDefaults: {},
    ...overrides,
  };
}

function shell() {
  return BUILTIN_DEBUG_TEMPLATES.find((entry) => entry.name === 'Shell')!;
}

function invalidFields(value: unknown, existing: readonly DebugTemplate[] = []) {
  return validateDebugTemplate(value, existing).map((issue) => issue.field);
}

describe('reusable debug templates', () => {
  it('ships immutable Shell and Network toolbox starters with a safe standard shell', () => {
    expect(BUILTIN_DEBUG_TEMPLATES.map((entry) => entry.name)).toEqual([
      'Shell',
      'Network toolbox',
    ]);
    expect(shell()).toMatchObject({
      image: 'busybox:1.37.0',
      command: ['sh'],
      profile: 'restricted',
      imagePullPolicy: 'IfNotPresent',
      env: {},
    });
    expect(Object.isFrozen(BUILTIN_DEBUG_TEMPLATES)).toBe(true);
    for (const entry of BUILTIN_DEBUG_TEMPLATES) {
      expect(Object.isFrozen(entry)).toBe(true);
      expect(Object.isFrozen(entry.command)).toBe(true);
      expect(Object.isFrozen(entry.env)).toBe(true);
    }
    expect(new Set(BUILTIN_DEBUG_TEMPLATES.map((entry) => entry.id)).size).toBe(2);
  });

  it('accepts explicit argv boundaries and non-secret environment configuration', () => {
    expect(
      validateDebugTemplate(
        template({
          command: ['sh', '-c', 'printf "%s" "$LABEL"'],
          env: { LABEL: 'two words' },
        }),
        [],
      ),
    ).toEqual([]);
    expect(validateDebugTemplate(template({ command: ['printf', ''] }), [])).toEqual([]);
  });

  it.each([
    ['id', { id: '' }],
    ['name', { name: '  ' }],
    ['image', { image: '\t' }],
    ['command', { command: [] }],
    ['command', { command: 'sh -c echo' }],
    ['command', { command: ['sh', 42] }],
    ['command', { command: [''] }],
    ['env', { env: { TOKEN: 42 } }],
    ['env', { env: ['TOKEN=value'] }],
    ['env', { env: { 'BAD=NAME': 'value' } }],
    ['profile', { profile: 'privileged' }],
    ['imagePullPolicy', { imagePullPolicy: 'Never' }],
  ])('rejects malformed %s before saving', (field, overrides) => {
    expect(invalidFields({ ...template(), ...overrides })).toContain(field);
  });

  it('rejects duplicate IDs and trimmed names, including built-in names', () => {
    expect(invalidFields(template(), [template()])).toContain('id');
    expect(invalidFields(template({ id: 'other', name: ' Team shell ' }), [template()])).toContain(
      'name',
    );
    expect(invalidFields(template({ name: ' Shell ' }), BUILTIN_DEBUG_TEMPLATES)).toContain('name');
  });

  it('never edits a built-in but permits saving a separately identified duplicate', () => {
    const original = config();
    expect(() => saveDebugTemplate(original, { ...shell(), image: 'other:1' })).toThrow();
    const duplicate = template({ ...shell(), id: 'my-shell', name: 'My shell' });
    const saved = saveDebugTemplate(original, duplicate);
    expect(saved.customTemplates).toEqual([duplicate]);
    expect(original.customTemplates).toEqual([]);
    expect(saved.defaultTemplateId).toBeNull();
    expect(shell().image).toBe('busybox:1.37.0');
  });

  it('saves custom edits without selecting defaults or mutating earlier launch snapshots', () => {
    const original = config({ customTemplates: [template()], defaultTemplateId: 'custom-shell' });
    const launch = resolveDebugTemplate(original, 'cluster-a');
    const draft = template({
      image: 'busybox:1.38.0',
      command: ['sh', '-l'],
      env: { LABEL: 'new' },
    });
    const saved = saveDebugTemplate(original, draft);
    draft.command.push('changed-after-save');
    draft.env.LABEL = 'changed-after-save';
    expect(original.customTemplates[0].image).toBe('busybox:1.37.0');
    expect(launch.template.image).toBe('busybox:1.37.0');
    expect(saved.customTemplates).toHaveLength(1);
    expect(saved.customTemplates[0]).toMatchObject({
      command: ['sh', '-l'],
      env: { LABEL: 'new' },
    });
    expect(saved.defaultTemplateId).toBe('custom-shell');
    expect(resolveDebugTemplate(saved, 'cluster-a').template.image).toBe('busybox:1.38.0');
  });

  it('discards an unsaved custom draft without changing the effective template', () => {
    const original = config({ customTemplates: [template()], defaultTemplateId: 'custom-shell' });
    const draft = {
      ...original.customTemplates[0],
      command: [...original.customTemplates[0].command],
      env: { ...original.customTemplates[0].env },
    };
    draft.image = 'discarded:1';
    draft.command.push('-l');
    draft.env.DRAFT = 'discarded';
    expect(resolveDebugTemplate(original, 'cluster-a').template).toEqual(template());
  });

  it('rejects invalid saves without changing saved templates or selection', () => {
    const original = config({ customTemplates: [template()], defaultTemplateId: 'custom-shell' });
    expect(() => saveDebugTemplate(original, template({ command: [] }))).toThrow();
    expect(original).toEqual(
      config({ customTemplates: [template()], defaultTemplateId: 'custom-shell' }),
    );
  });
});

describe('debug default resolution', () => {
  const plugin = template({ id: 'plugin', name: 'Plugin shell' });
  const cluster = template({ id: 'cluster', name: 'Cluster shell' });

  it('resolves connection ID override before plugin choice before built-in Shell', () => {
    const saved = config({
      customTemplates: [plugin, cluster],
      defaultTemplateId: plugin.id,
      clusterDefaults: { 'connection-123': cluster.id },
    });
    expect(resolveDebugTemplate(saved, 'connection-123')).toMatchObject({
      template: cluster,
      source: 'cluster',
      issues: [],
    });
    expect(resolveDebugTemplate(saved, 'same-display-name-other-id')).toMatchObject({
      template: plugin,
      source: 'plugin',
      issues: [],
    });
    expect(resolveDebugTemplate(config(), 'connection-123')).toMatchObject({
      template: shell(),
      source: 'builtin',
      issues: [],
    });
  });

  it('resets to live inheritance, not a copy of the current plugin choice', () => {
    const original = config({
      customTemplates: [plugin, cluster],
      defaultTemplateId: plugin.id,
      clusterDefaults: { a: cluster.id, b: cluster.id },
    });
    const inherited = setClusterDebugDefault(original, 'a', null);
    expect(resolveDebugTemplate(inherited, 'a').template.id).toBe(plugin.id);
    const changedParent = { ...inherited, defaultTemplateId: shell().id };
    expect(resolveDebugTemplate(changedParent, 'a').template.id).toBe(shell().id);
    expect(resolveDebugTemplate(changedParent, 'b').template.id).toBe(cluster.id);
    expect(original.clusterDefaults.a).toBe(cluster.id);
  });

  it('isolates connection overrides and independent plugin settings snapshots', () => {
    const original = config({ customTemplates: [plugin, cluster], defaultTemplateId: plugin.id });
    const changed = setClusterDebugDefault(original, 'a', cluster.id);
    expect(resolveDebugTemplate(changed, 'a').template.id).toBe(cluster.id);
    expect(resolveDebugTemplate(changed, 'b').template.id).toBe(plugin.id);
    expect(resolveDebugTemplate(original, 'a').template.id).toBe(plugin.id);
    expect(resolveDebugTemplate(config(), 'a').template.id).toBe(shell().id);
  });

  it.each(['deleted-template', '', 42, { id: 'cluster' }])(
    'surfaces invalid persisted override %j with restricted fallback',
    (invalidId) => {
      const elevated = template({ id: 'elevated', name: 'Admin', profile: 'sysadmin' });
      const saved = config({ customTemplates: [elevated], defaultTemplateId: elevated.id });
      const malformed = { ...saved, clusterDefaults: { a: invalidId } } as unknown as DebugConfig;
      const resolved = resolveDebugTemplate(malformed, 'a');
      expect(resolved.template).toEqual(shell());
      expect(resolved.source).toBe('builtin');
      expect(resolved.issues.length).toBeGreaterThan(0);
      expect(resolved.requiresElevationConfirmation).toBe(false);
    },
  );

  it('surfaces deleted plugin defaults and invalid template contents instead of silently launching them', () => {
    for (const saved of [
      config({ defaultTemplateId: 'deleted' }),
      config({ customTemplates: [template({ image: '' })], defaultTemplateId: 'custom-shell' }),
    ]) {
      const resolved = resolveDebugTemplate(saved, 'a');
      expect(resolved.template).toEqual(shell());
      expect(resolved.issues.length).toBeGreaterThan(0);
    }
  });

  it.each(['netadmin', 'sysadmin'] as const)(
    'requires fresh elevation review for saved %s defaults on every resolution',
    (profile) => {
      const elevated = template({ profile });
      const saved = config({ customTemplates: [elevated], defaultTemplateId: elevated.id });
      for (const connectionId of ['a', 'a', 'b']) {
        const resolved = resolveDebugTemplate(saved, connectionId);
        expect(resolved.template.profile).toBe(profile);
        expect(resolved.requiresElevationConfirmation).toBe(true);
        expect(resolved.template).not.toHaveProperty('elevatedAcknowledged');
        expect(resolved.template).not.toHaveProperty('podUID');
        expect(resolved.template).not.toHaveProperty('targetContainerName');
        expect(resolved.template).not.toHaveProperty('volumeMounts');
      }
      expect(resolveDebugTemplate(config(), 'a').requiresElevationConfirmation).toBe(false);
    },
  );
});
