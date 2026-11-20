import { openLogStream, type HostRecord } from '@omniviewdev/runtime/ui/v1';

import type { LogTargetV1, RouteV1 } from '../../contract/v1';
import { podDefinition } from '../../kinds/pods/definition';

// What the plugin hands the host to open the logs of one Pod: a target descriptor (the panel handle's `LogTargetV1`, owner decision A20) and nothing else. The host owns the tab, the card, the
// words of the state and the lifecycle of the stream; the plugin says what is read and how to start reading it. The descriptor is plain data and one function, so a registry and a picker can later
// list the very same descriptors (one per Pod, by `id`) and call the same `open` without a change here.
//
// One session follows ALL the Pod's containers (init, regular and debug): the plugin's source builder makes one source per container from the record's spec when the target is empty, and the stream
// carries each line's source (`pod/container`), so the stream supports several sources by itself. No container is chosen here: a choice belongs to the viewer's own controls (the mock's filter row
// owns Container, Previous and Since, and a later step builds them), and a record that names its containers is all the plugin needs (K8G-41: no Pod read).

/** The options the old actions passed when they opened a Pod's log (`filter_labels` names the label the viewer groups the sources by). */
const LOG_OPTIONS = { follow: true, tailLines: 1000, previous: false, params: { filter_labels: 'container' } } as const;

/** The plugin's key for the kind of resource a Pod is. */
const POD_KEY = podDefinition.type;

/**
 * What names a Pod's session: the connection, the namespace and the Pod, so it is the same each time that Pod is read and differs for any other. Each part is encoded, because the connection of a
 * cloud cluster holds slashes (`arn:aws:eks:eu-west-1:1:cluster/prod`) and two Pods must never share an id for being cut at the same place.
 */
export function podLogTargetId(connection: string, namespace: string, name: string): string {
  return ['pod', connection, namespace, name].map(encodeURIComponent).join('/');
}

export type PodLogTargetInputs = {
  /** The id the plugin is installed under, which the host tells a page. */
  readonly plugin: string;
  /** The Pod's record as the host holds it: its body, the reference it was admitted under and the connection it was admitted for are what the stream is opened from. */
  readonly record: HostRecord;
  /** The Pod's identity: the namespace and the name its page was asked for. */
  readonly namespace: string;
  readonly name: string;
  /** What the frame calls the connection (the scope lane's own text): the tab's muted qualifier. */
  readonly scope: string;
  /** The page the command was pressed on, which is the Pod's own: the link of the card goes back to it as it was opened. */
  readonly route: RouteV1;
};

/**
 * The descriptor of the logs of a Pod. Opening it starts nothing: `open` is the host's to call once, when it makes the session, and it opens the runtime's stream for the Pod and hands it over as it is.
 */
export function podLogTarget({ plugin, record, namespace, name, scope, route }: PodLogTargetInputs): LogTargetV1 {
  const connection = record.route.connection;
  return {
    id: podLogTargetId(connection, namespace, name),
    title: name,
    scope,
    resource: {
      label: `Pod ${name}`,
      kind: podDefinition.kind,
      icon: podDefinition.tile.icon,
      // The Pod's page as it was opened: its connection when the route named one and none when it did not, so a link finds the tab that is open and does not open a twin of it.
      route: { page: route.page, connection: route.connection, params: { namespace, name } },
    },
    open: () =>
      openLogStream({
        plugin,
        connection,
        resourceKey: POD_KEY,
        resourceId: name,
        resourceData: record.record.body,
        reference: record.record.reference,
        route: record.route,
        target: '',
        ...LOG_OPTIONS,
      }),
  };
}
