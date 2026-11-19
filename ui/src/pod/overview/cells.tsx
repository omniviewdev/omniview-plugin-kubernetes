import { MiddleEllipsis, MissingValue, Status, compactAge, useAge } from '@omniviewdev/kit';

import styles from './cells.module.css';
import { utcStamp, type ContainerRow, type ContainerState } from './model';

// What the cells of a Pod's tables draw, from the kit's atoms. `view.tsx` decides which cell a column has; this file decides how a cell is drawn. It imports the kit and the model only.

/** A state with the glyph of its role and the platform's word. The tip is what the platform said about it (a message, an exit code). */
export function StateCell({ state, name }: { readonly state: ContainerState | undefined; readonly name: string }) {
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

/** How long ago a condition changed, kept current by the page's one age clock; the instant is the tip. */
export function Since({ at }: { readonly at: number | undefined }) {
  const label = useAge(at, compactAge);
  if (at === undefined) {
    return <MissingValue name="No change time" />;
  }

  return <span data-ov-tip={utcStamp(new Date(at).toISOString())}>{label}</span>;
}

/** The image in the code face, cut in the middle: its name and tag stay whole, the registry and the path give way first. */
export function ImageCell({ row }: { readonly row: ContainerRow }) {
  if (row.image === undefined) {
    return <MissingValue name="No image" />;
  }

  return (
    <div className={styles.mono}>
      <MiddleEllipsis tail={row.imageTail}>{row.image}</MiddleEllipsis>
    </div>
  );
}

export function ReadyCell({ ready }: { readonly ready: boolean | undefined }) {
  // A bare Yes or No is a plain word, never a state (design 13 SR2).
  return ready === undefined ? <MissingValue name="No readiness" /> : ready ? 'Yes' : 'No';
}
