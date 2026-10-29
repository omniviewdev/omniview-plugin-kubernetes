export interface DebugTemplate {
  id: string;
  name: string;
  image: string;
  command: string[];
  profile: 'restricted' | 'netadmin' | 'sysadmin';
  imagePullPolicy: 'IfNotPresent' | 'Always';
  env: Record<string, string>;
}

export interface DebugConfig {
  customTemplates: DebugTemplate[];
  defaultTemplateId: string | null;
  clusterDefaults: Record<string, string | null>;
}

export interface DebugConfigIssue {
  field: string;
  message: string;
}

function clone(template: DebugTemplate): DebugTemplate {
  return {
    id: template.id,
    name: template.name.trim(),
    image: template.image.trim(),
    command: [...template.command],
    profile: template.profile,
    imagePullPolicy: template.imagePullPolicy,
    env: { ...template.env },
  };
}

function builtin(id: string, name: string, image: string): DebugTemplate {
  const value = {
    id,
    name,
    image,
    command: ['sh'],
    profile: 'restricted' as const,
    imagePullPolicy: 'IfNotPresent' as const,
    env: {},
  };
  Object.freeze(value.command);
  Object.freeze(value.env);
  return Object.freeze(value);
}

export const BUILTIN_DEBUG_TEMPLATES: readonly DebugTemplate[] = Object.freeze([
  builtin('builtin-shell', 'Shell', 'busybox:1.37.0'),
  builtin('builtin-network', 'Network toolbox', 'nicolaka/netshoot:v0.14'),
]);

export function validateDebugTemplate(
  value: unknown,
  existing: readonly DebugTemplate[] = [],
): DebugConfigIssue[] {
  const issues: DebugConfigIssue[] = [];
  const issue = (field: string, message: string) => issues.push({ field, message });
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return [{ field: 'template', message: 'Invalid template.' }];
  const t = value as Record<string, unknown>;
  for (const field of ['id', 'name', 'image']) {
    if (typeof t[field] !== 'string' || !(t[field] as string).trim())
      issue(field, `${field} is required.`);
  }
  if (existing.some((entry) => entry?.id === t.id)) issue('id', 'Template ID already exists.');
  if (
    typeof t.name === 'string' &&
    existing.some(
      (entry) =>
        typeof entry?.name === 'string' &&
        entry.name.trim().toLowerCase() === (t.name as string).trim().toLowerCase(),
    )
  )
    issue('name', 'Template name already exists.');
  if (
    !Array.isArray(t.command) ||
    !t.command.length ||
    t.command.some((arg) => typeof arg !== 'string' || arg.includes('\0')) ||
    typeof t.command[0] !== 'string' ||
    !t.command[0].trim()
  )
    issue('command', 'Command must be a nonempty argv array.');
  if (typeof t.profile !== 'string' || !['restricted', 'netadmin', 'sysadmin'].includes(t.profile))
    issue('profile', 'Choose a supported access profile.');
  if (
    typeof t.imagePullPolicy !== 'string' ||
    !['IfNotPresent', 'Always'].includes(t.imagePullPolicy)
  )
    issue('imagePullPolicy', 'Choose a supported pull policy.');
  if (
    !t.env ||
    typeof t.env !== 'object' ||
    Array.isArray(t.env) ||
    Object.entries(t.env).some(
      ([key, val]) =>
        !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || typeof val !== 'string' || val.includes('\0'),
    )
  )
    issue('env', 'Environment must map valid variable names to string values.');
  return issues;
}

export function saveDebugTemplate(config: DebugConfig, template: DebugTemplate): DebugConfig {
  if (BUILTIN_DEBUG_TEMPLATES.some((entry) => entry.id === template.id))
    throw new Error('Built-in templates are immutable. Duplicate instead.');
  const others = [
    ...BUILTIN_DEBUG_TEMPLATES,
    ...config.customTemplates.filter((entry) => entry.id !== template.id),
  ];
  const issues = validateDebugTemplate(template, others);
  if (issues.length) throw new Error(issues.map((issue) => issue.message).join(' '));
  const saved = clone(template);
  const exists = config.customTemplates.some((entry) => entry.id === template.id);
  return {
    ...config,
    customTemplates: exists
      ? config.customTemplates.map((entry) => (entry.id === template.id ? saved : clone(entry)))
      : [...config.customTemplates.map(clone), saved],
  };
}

export function setClusterDebugDefault(
  config: DebugConfig,
  connectionID: string,
  templateId: string | null,
): DebugConfig {
  if (
    templateId !== null &&
    ![...BUILTIN_DEBUG_TEMPLATES, ...config.customTemplates].some(
      (entry) => entry.id === templateId,
    )
  )
    throw new Error('Unknown debug template.');
  return { ...config, clusterDefaults: { ...config.clusterDefaults, [connectionID]: templateId } };
}

export function resolveDebugTemplate(config: DebugConfig, connectionID: string) {
  const override = config.clusterDefaults[connectionID];
  const source =
    override !== undefined && override !== null
      ? 'cluster'
      : config.defaultTemplateId !== null && config.defaultTemplateId !== undefined
        ? 'plugin'
        : 'builtin';
  const id =
    source === 'cluster'
      ? override
      : source === 'plugin'
        ? config.defaultTemplateId
        : BUILTIN_DEBUG_TEMPLATES[0].id;
  const templates = [...BUILTIN_DEBUG_TEMPLATES, ...config.customTemplates];
  const matches = templates.filter((entry) => entry && entry.id === id);
  const candidate = matches[0];
  const issues =
    candidate && matches.length === 1
      ? validateDebugTemplate(
          candidate,
          templates.filter((entry) => entry !== candidate),
        )
      : [
          {
            field: 'defaultTemplateId',
            message: 'Saved debug template is missing or invalid. Using Shell.',
          },
        ];
  const template = clone(issues.length ? BUILTIN_DEBUG_TEMPLATES[0] : candidate);
  return {
    template,
    source: issues.length ? ('builtin' as const) : source,
    issues,
    requiresElevationConfirmation: template.profile !== 'restricted',
  };
}
