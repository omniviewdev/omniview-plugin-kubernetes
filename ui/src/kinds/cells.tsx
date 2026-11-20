import { KindTile, Link, MiddleEllipsis, MissingValue, Status, compactAge, useAge } from '@omniviewdev/kit';
import { useState } from 'react';

import styles from './cells.module.css';
import type { Cell, KindDefinition, KindField, KindRow } from './definition';
import { spanSince } from './fields';

// What a row draws in its cells, from the closed vocabulary of cells a kind's definition answers (`text`, `status`, `age`, `elapsed`, `none`) and kit atoms. The definition decides what a
// field says; this file decides how it is drawn, for every kind alike. It imports the kit and the definition's types only.

/**
 * The Name column: the kind's tile, the name, and the namespace under it. When the kind has a page of one object, the name is a link to it (the kit's `Link`: the host says where it goes
 * and where it opens: a click or Enter here, Command or Control, or a middle click, in a background tab). A generated name keeps its distinguishing end when it is cut; the kit part reads and
 * copies it once, whole. A row with no object to open (no namespace) has plain text for a name. The test ids are the kind's: `pod-name`, `deployment-namespace`; the second line is the namespace of
 * a namespaced kind, so its test id says `namespace`, and a Node's address under its name says `address` (`node-address`).
 */
export function IdentityCell<TRow extends KindRow>({ kind, row }: { readonly kind: KindDefinition<TRow>; readonly row: TRow }) {
  const { second, tail, line = 'namespace' } = kind.list.identity;
  const under = second(row);
  const id = kind.kind.toLowerCase();
  const name = (
    <MiddleEllipsis data-testid={`${id}-name`} tail={tail(row)}>
      {row.name}
    </MiddleEllipsis>
  );
  const params = kind.detail?.params(row);
  return (
    <div className={styles.identity}>
      <KindTile icon={kind.tile.icon} tone={kind.tile.tone} />
      <div className={styles.lines}>
        {kind.detail === undefined || params === undefined ? name : <Link to={{ page: kind.detail.page, params }}>{name}</Link>}
        {under === null ? null : (
          <small className={styles.second} data-testid={`${id}-${line}`}>
            {under}
          </small>
        )}
      </div>
    </div>
  );
}

/** A cell that does not read the clock. A cell that keeps time and comes here is drawn as the definition words it, still. */
function Plain({ cell }: { readonly cell: Cell }) {
  switch (cell.kind) {
    case 'text':
      return cell.mono === true || cell.tip !== undefined ? (
        <span className={cell.mono === true ? styles.mono : undefined} data-ov-tip={cell.tip}>
          {cell.text}
        </span>
      ) : (
        cell.text
      );
    case 'status':
      // Work that waits to start is drawn with the clock, work under way with the loader (design 13 SR1; plan E8).
      return cell.role === 'progress' ? (
        <Status role="progress" queued={cell.raw === 'Pending'} data-ov-tip={cell.tip}>
          {cell.label}
        </Status>
      ) : (
        <Status role={cell.role} data-ov-tip={cell.tip}>
          {cell.label}
        </Status>
      );
    case 'none':
      return <MissingValue reason={cell.reason} />;
    case 'age':
    case 'elapsed':
      return cell.text;
  }
}

/**
 * The Age column: one unit, floored (`17d`), kept current by the page's one age clock; the instant and the span in words are the tip. The
 * tip is read at the moment the cell mounts: it is a reading aid, and the label beside it is the live one.
 */
function AgeCell<TRow extends KindRow>({ field, row, createdAt }: { readonly field: KindField<TRow>; readonly row: TRow; readonly createdAt: number }) {
  const label = useAge(createdAt, compactAge);
  const [now] = useState(() => Date.now());
  const cell = field.display(row, now);
  return <span data-ov-tip={cell.kind === 'age' ? cell.long : undefined}>{label}</span>;
}

/** The time since a start that has not ended (a Job that is still running): `6 min 12 s`, kept current by the same clock. */
function ElapsedCell({ since }: { readonly since: number }) {
  return useAge(since, spanSince);
}

/**
 * One field of a row: what the kind's definition says of it, drawn. The row is read once without a clock; a cell that keeps time is handed to the one that does, so the cells that do
 * not (Ready, Status, Restarts) subscribe to nothing.
 */
export function FieldCell<TRow extends KindRow>({ field, row }: { readonly field: KindField<TRow>; readonly row: TRow }) {
  const cell = field.display(row, 0);
  switch (cell.kind) {
    case 'age':
      return <AgeCell field={field} row={row} createdAt={cell.createdAt} />;
    case 'elapsed':
      return <ElapsedCell since={cell.since} />;
    default:
      return <Plain cell={cell} />;
  }
}
