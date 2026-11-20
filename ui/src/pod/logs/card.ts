import type { PanelCardV1, PanelSessionV1 } from '../../contract/v1';

// What the plugin says on the card of a Logs session it opened (`contributionV1.panel.sessions.logs.card`): where the Pod is. The host draws the kind, the resource as a link back to the Pod's page, and
// the state in the words of a log; a member the plugin leaves out stays the host's, and one it gives replaces the host's whole (`facts` is one list: what the host would say of the sources, and of
// a pause, goes when this gives rows). The rows are the mock's for a session of a Kubernetes target (`defaultFacts`: Connection, Namespace, Container). The session says the connection as its scope
// and the Pod as its resource's route, so the card needs nothing but the session the host hands it.

/** The one session this plugin opens follows every container of its Pod, as the mock words a Logs session that names none. */
const CONTAINERS = 'All containers';

export function podLogsCard({ scope, route }: PanelSessionV1): PanelCardV1 {
  const facts = [
    ['Connection', scope],
    ['Namespace', route?.params.namespace ?? ''],
    ['Container', CONTAINERS],
  ] as const;
  // A fact with no text is left out by the host as well; a row that says nothing is not written.
  return { facts: facts.filter(([, text]) => text !== '') };
}
