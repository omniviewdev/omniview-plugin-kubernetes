import { Link, MissingValue, Status, TagList, compactAge, useAge, type LinkTarget } from '@omniviewdev/kit';

import { spanSince } from '../fields';
import type { StateRole } from '../status';

import styles from './cells.module.css';
import type { DetailValue, ObjectRef } from './overview';
import { utcStamp } from './text';

// What the cells of an object's page draw, from the kit's atoms. `view.tsx` decides which cell a row has; this file decides how a cell is drawn, for every kind alike. It imports the kit and the kinds'
// own types only. (The Pod page draws the same cells from its own file, `pod/overview/cells.tsx`.)

/** A state with the glyph of its role and the platform's word. The tip is what the platform said about it (a message). */
export function StateCell({ state, name }: { readonly state: { readonly word: string; readonly role: StateRole; readonly tip?: string | undefined } | undefined; readonly name: string }) {
  if (state === undefined) {
    return <MissingValue name={name} />;
  }

  const { word, role, tip } = state;
  // Work that waits to start is drawn with the clock, work under way with the loader (design 13 SR1).
  const drawn = role === 'progress' ? <Status role="progress" queued={word === 'Pending'}>{word}</Status> : <Status role={role}>{word}</Status>;
  return tip === undefined ? drawn : <span data-ov-tip={tip}>{drawn}</span>;
}

/** A run of text that may be longer than its column: one line, whole in the tip. A missing one is the dash, named for what is missing. */
export function Run({ text, name, mono = false, tip = text }: { readonly text: string | undefined; readonly name: string; readonly mono?: boolean; readonly tip?: string | undefined }) {
  if (text === undefined) {
    return <MissingValue name={name} />;
  }

  return (
    <span className={mono ? `${styles.clip} ${styles.mono}` : styles.clip} data-ov-tip={tip}>
      {text}
    </span>
  );
}

/** How long ago an instant was, kept current by the page's one age clock; the instant is the tip. */
export function Since({ at }: { readonly at: number | undefined }) {
  const label = useAge(at, compactAge);
  if (at === undefined) {
    return <MissingValue name="No time" />;
  }

  return <span data-ov-tip={utcStamp(at)}>{label}</span>;
}

/** The time since a start that has not ended (a Job that is still running): `6 min 12 s`, kept current by the same clock. */
export function Running({ since }: { readonly since: number }) {
  return useAge(since, spanSince);
}

/**
 * The value of a row of the Details card. A reference to another object is a link when the plugin has a page for the kind it names (`resolve` says where it goes) and plain text when it has none, so a
 * link never leads nowhere. Chips are named by the row's label.
 */
export function DetailValueView({ value, label, resolve }: { readonly value: DetailValue; readonly label: string; readonly resolve: (ref: ObjectRef) => LinkTarget | undefined }) {
  switch (value.kind) {
    case 'text':
      return value.tip === undefined ? value.text : <span data-ov-tip={value.tip}>{value.text}</span>;
    case 'tags':
      return <TagList label={label} items={value.items} />;
    case 'ref': {
      const target = resolve(value.ref);
      return target === undefined ? value.text : <Link to={target}>{value.text}</Link>;
    }

    case 'moment':
      return <Since at={value.at} />;
    case 'running':
      return <Running since={value.since} />;
  }
}
