/** The seven roles a state is drawn with (ch13 SR1). The role fixes the glyph and the tone; the word keeps its spelling. */
export type StateRole = 'healthy' | 'running' | 'progress' | 'attention' | 'error' | 'stopped' | 'info';

/** A state as a row holds it: the platform's own word, spelled as the platform spells it, and the role the table has for it. */
export type KindStatus = {
  readonly word: string;
  /** Undefined when the table has no role for the word: it is drawn as plain text. */
  readonly role: StateRole | undefined;
};

// The platform's own words, one role each: the words of the mock's table (MOCK k8s-resource-definitions.js STATES, K61.3) that the kinds of this plugin can say. The table is ONE for
// every kind (a word has one role wherever it is said, and the mock has no second table): a kind that can say a word the table lacks adds it here, in the role K61.3 gives it. A word that
// is not here has no role and is drawn as plain text: it is never guessed from its spelling (SR1).
const WORDS: Readonly<Record<StateRole, readonly string[]>> = {
  healthy: ['Succeeded', 'Completed', 'Available', 'Complete'],
  running: ['Running'],
  progress: ['Pending', 'ContainerCreating', 'PodInitializing', 'Terminating', 'Progressing'],
  attention: ['Unknown', 'Partially ready'],
  error: [
    'CrashLoopBackOff', 'Error', 'Failed', 'ImagePullBackOff', 'ErrImagePull', 'ErrImageNeverPull', 'OOMKilled', 'Evicted', 'NotReady',
    'CreateContainerConfigError', 'CreateContainerError', 'RunContainerError', 'InvalidImageName', 'ContainerCannotRun', 'DeadlineExceeded', 'Unavailable',
  ],
  stopped: ['Terminated', 'Suspended', 'Scaled to zero', 'Paused'],
  info: [],
};

const ROLE_OF = new Map<string, StateRole>(Object.entries(WORDS).flatMap(([role, words]) => words.map((word): [string, StateRole] => [word, role as StateRole])));

/** The role of a status word, or undefined when the table has none. `Init:` words take the role of what follows, and an unknown init failure is an error. */
export function stateRole(word: string | undefined): StateRole | undefined {
  if (word === undefined) {
    return undefined;
  }

  const known = ROLE_OF.get(word);
  if (known !== undefined) {
    return known;
  }

  if (/^Init:\d+\/\d+$/.test(word)) {
    return 'progress';
  }

  if (word.startsWith('Init:')) {
    return stateRole(word.slice('Init:'.length)) ?? 'error';
  }

  return /^(?:Signal|ExitCode):/.test(word) ? 'error' : undefined;
}

/** The status a row holds for a word: the word and its role. No word, no status. */
export function statusOf(word: string | undefined): KindStatus | undefined {
  return word === undefined ? undefined : { word, role: stateRole(word) };
}
