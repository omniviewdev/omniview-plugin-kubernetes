import { Icon, Link, MissingValue, Status, useAge, type AgeFormatter } from '@omniviewdev/kit';

import { spanSince } from '../kinds/fields';
import type { StateRole } from '../kinds/status';

import type { Severity } from './assess';
import type { Figure, Value, Words } from './model';

// What the overview's cells draw, from the kit's atoms. `view.tsx` decides which cell a row has; this file decides how a cell is drawn. It imports the kit and the plugin's own types only.

/** `4 min ago`: the time since an instant as the plugin says a span (`spanSince`), for the page's one age clock. */
const agoSince: AgeFormatter = (date, now) => {
  const { text, changesAt } = spanSince(date, now);
  return { text: `${text} ago`, changesAt };
};

/** When a fact that is not current was last read, kept current by the page's one age clock. A time that is not known says so. */
function LastRead({ at }: { readonly at: number | undefined }) {
  const ago = useAge(at, agoSince);
  return at === undefined ? 'last read at an unknown time' : `last read ${ago}`;
}

/** A state with the glyph of its role and the platform's word. Work that is on its way (a read that has not answered) is drawn with the loader. */
export function StateCell({ role, label }: { readonly role: StateRole; readonly label: string }) {
  return role === 'progress' ? <Status role="progress">{label}</Status> : <Status role={role}>{label}</Status>;
}

/** A number or a state in a cell: text, a link, or the dash that says what is missing. */
export function FigureCell({ figure }: { readonly figure: Figure }) {
  switch (figure.kind) {
    case 'text':
      return figure.text;
    case 'link':
      return <Link to={figure.to}>{figure.text}</Link>;
    case 'missing':
      return <MissingValue name={figure.name} />;
  }
}

/** Text that may be a short form of something longer: the whole is in the tip, as the kinds' cells say it. */
function Tipped({ text, tip }: { readonly text: string; readonly tip: string | undefined }) {
  return tip === undefined ? text : <span data-ov-tip={tip}>{text}</span>;
}

/** The value of a row of the Cluster section. A fact that is not current says so and when it was last read; one that is not known says why; a count that could not be refreshed says so after it. */
export function ValueCell({ value }: { readonly value: Value }) {
  switch (value.kind) {
    case 'text':
      return <Tipped text={value.text} tip={value.tip} />;
    case 'link':
      return value.note === undefined ? (
        <Link to={value.to}>{value.text}</Link>
      ) : (
        <>
          <Link to={value.to}>{value.text}</Link>
          {' · '}
          {value.note}
        </>
      );
    case 'stale':
      return (
        <>
          <Tipped text={value.text} tip={value.tip} />
          {' · '}
          <LastRead at={value.at} />
        </>
      );
    case 'loading':
      return <Status role="progress">Loading</Status>;
    case 'words':
      return value.text;
  }
}

/** The line under a row's title: what it says, and for a fact that is not current when it was last read. */
export function WordsCell({ words }: { readonly words: Words }) {
  if (words.stale === undefined) {
    return words.text;
  }

  return (
    <>
      {words.text === '' ? null : `${words.text} · `}
      <LastRead at={words.stale.at} />
    </>
  );
}

/** The glyph before a row's title: the kit's own for the two roles that put an object on the page. Decorative: the title says what is wrong. */
export function SeverityGlyph({ severity }: { readonly severity: Severity }) {
  return <Icon name={severity === 'error' ? 'status-error' : 'status-warning'} />;
}
