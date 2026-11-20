import type { Cell } from '../definition';
import { none } from '../display';
import { isObject, objects, text } from '../object';

// What the list reads of a RoleBinding or a ClusterRoleBinding, which are the same shape: the role they bind (`roleRef`) and the names of the subjects they bind it to. Both kinds' `object.ts` read here, and
// both draw the Role cell with `roleCell`, so that the two lists cannot come to disagree about what a binding says.

/** The role a binding names: the kind (`Role` or `ClusterRole`) and the name. */
export type RoleRef = {
  readonly kind: string;
  readonly name: string;
};

/** The `roleRef` of an object, kept only when it holds the kind and the name as texts; undefined otherwise. */
export function roleRefOf(value: unknown): RoleRef | undefined {
  if (!isObject(value)) {
    return undefined;
  }

  const kind = text(value.kind);
  const name = text(value.name);
  return kind === undefined || name === undefined ? undefined : { kind, name };
}

/**
 * The `name` of each subject, once each, in order of first appearance (the mock's `subject.name` over `subjects`: a ServiceAccount's namespace is not part of it). The API sends `"subjects": null` for a
 * binding without subjects, and may omit it: both are no subject. A value that is neither a list nor absent says nothing (undefined). A subject that has no name is skipped.
 */
export function subjectNamesOf(value: unknown): readonly string[] | undefined {
  if (value === undefined || value === null) {
    return [];
  }

  const subjects = objects(value);
  return subjects === undefined ? undefined : [...new Set(subjects.flatMap((subject) => text(subject.name) ?? []))];
}

/**
 * The Role cell as the mock draws it (`displayCell`, `'reference'`): a role of the kind the binding implies (`implied`: a RoleBinding's `Role`, a ClusterRoleBinding's `ClusterRole`) is the name alone, with
 * `Kind/name` in the tip; any other kind is `Kind/name` with no tip. A binding that names no role is a dash.
 */
export function roleCell(role: RoleRef | undefined, implied: 'Role' | 'ClusterRole'): Cell {
  if (role === undefined) {
    return none('The binding names no role.');
  }

  const whole = `${role.kind}/${role.name}`;
  return role.kind === implied ? { kind: 'text', text: role.name, tip: whole } : { kind: 'text', text: whole };
}
