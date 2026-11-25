import type { PageHeaderMenuItem, PageOperation } from '@omniviewdev/kit';
import type { HostRecord } from '@omniviewdev/runtime/ui/v1';
import { useState } from 'react';

import type { PanelHostV1 } from '../../contract/v1';
import { podDefinition } from '../../kinds/pods/definition';
import type { PodDetail } from '../data/object';

// The Forward port entries of a Pod's header (PF3). The mock puts `port-forward` in the menu of a Pod's header (MOCK k8s-resource.js:560, `LAYOUT.Pod`: menu ['port-forward', 'debug', 'events', 'copy'], labelled 'Forward port…'
// at :528) and opens a dialog from it (k8s-forwards.js:280-295): a Remote port to choose among the Pod's declared ports (`declaredPorts`, :27-36: `spec.containers[].ports[]`, { name, containerPort, protocol }), a Local port to
// type ("Leave empty for a free port."), "Start forward" and the errors in the dialog. A page of this plugin has no place to mount a dialog from a header command: the header is the host's and is drawn from data
// (`DetailView.commands`, whose menu entries are `{ id, label, onSelect, disabled }`), and the page is given no surface of its own. So THIS slice takes the dialog's choice into the menu: there is one entry for each declared TCP
// port of a regular container (the mock lists the TCP ports, :217, of `spec.containers` only, :65 "Forwarding needs a port that a regular container declares.", and the Pod must be running, :52 "<name> isn't running."), and pressing
// it asks the host to forward that port. Left out, for a later slice that needs a host mount slot: the Remote port Select, the Local port field (the host takes a free local port and its Ports tool says which) and the errors in the
// dialog, which are said in the header's operation slot instead (`DetailView.operation`, the kit's `PageOperation`) in the host's own words: it says it is forwarding while the host works, says what the host refused with and can
// be dismissed, and is at rest once the host has answered (the host then shows its Ports tool).
//
// The call to the host is made IN THE PRESS, before anything is awaited: the host starts a forward only from a user action (a click, a key press) and reads it at the call, and the action that made a press lasts a few seconds.
// An entry has no reason when it cannot be pressed (the kit's overflow entry is `disabled: boolean`, with no place for a reason, and the identity line prints the reasons of labelled commands only), so a Pod with no TCP port to
// forward, a Pod that is not running and a host that gave the page no `ctx.panel.ports` have no entry at all, and the menu keeps its unavailable `Forward port…` (`../overview/commands.ts`).

type Ports = NonNullable<PanelHostV1['ports']>;

/** A port a Pod declares and the host can forward: a TCP port of a regular container, as the spec words it. */
export type DeclaredPort = {
  readonly container: string;
  readonly port: number;
  /** The port's name, when it has one. */
  readonly name: string | undefined;
};

/**
 * The TCP ports the regular containers of a Pod declare, in the spec's order. A port with no protocol is TCP, as the API defaults it. UDP and SCTP ports are left out (the host forwards TCP: the mock says "Only TCP ports can
 * be forwarded."), and so are the ports of init and debug containers, which the mock does not offer, and a port with no number.
 */
export function declaredTcpPorts({ spec }: PodDetail): readonly DeclaredPort[] {
  return (spec.containers ?? []).flatMap(({ name: container, ports }) =>
    ports.flatMap(({ name, containerPort, protocol }) => (containerPort === undefined || (protocol !== undefined && protocol !== 'TCP') ? [] : [{ container, port: containerPort, name }])),
  );
}

/** What the page says when the host's refusal has no words of its own that a person can read: the page's own, and no guess at the cause. */
const COULD_NOT_START = 'The host could not start the forward.';

/** The words of a refusal: the host's own when it refused (a page tells the host's typed error by its name, `PortForwardError`, because it cannot import its class), and the page's own for any other rejection, whose text is not for a person. */
function wordsOf(error: unknown): string {
  return error instanceof Error && error.name === 'PortForwardError' && error.message.trim() !== '' ? error.message : COULD_NOT_START;
}

/** What the forward is at, for the header's operation slot: at rest, under way for a port, or refused for a port in the host's words. */
type Forwarding =
  | { readonly kind: 'idle' }
  | { readonly kind: 'running'; readonly port: number }
  | { readonly kind: 'refused'; readonly port: number; readonly words: string };

const IDLE: Forwarding = { kind: 'idle' };

export type PodForwardInputs = {
  /** What the host gave the page to ask of the bottom panel; absent on a host that predates it, and its `ports` member is absent on a host that predates the forwarding of ports. */
  readonly panel: PanelHostV1 | undefined;
  /** The Pod's record as the host holds it, and the decoded Pod the page reads from it: both are absent while the Pod is read. The forwarder takes the Pod's name and namespace from the record's reference. */
  readonly record: HostRecord | undefined;
  readonly pod: PodDetail | undefined;
  /** The Pod's name, as its page was asked for. */
  readonly name: string;
};

/** What the page gives the header for forwarding a port: the menu's entries (none when no port can be forwarded) and the operation the header's slot shows (none at rest). */
export type PodForwardCommand = {
  readonly entries: readonly PageHeaderMenuItem[];
  readonly operation?: PageOperation | undefined;
};

/** The label of one entry: the port, its name when it has one, and the container only when the Pod has several. An entry acts when it is pressed, so it has no ellipsis. */
function labelOf({ container, port, name }: DeclaredPort, several: boolean): string {
  return `Forward port ${String(port)}${name === undefined || name === '' ? '' : ` (${name})`}${several ? ` in ${container}` : ''}`;
}

/**
 * The Forward port entries of one Pod's header and the state of the forward they start. An entry asks the host, through the panel handle (`ctx.panel.ports.forward`), to forward one declared port of the Pod: the Pod is named by the
 * reference the host holds of it (the Pod forwarder reads its name and namespace from it, and the host takes the plugin, the connection and the route from the page), and the body is not sent (the host bounds it, and a Pod's
 * can pass the bound). Only one forward is under way at a time: the entries cannot be pressed while the host works.
 */
export function usePodForward({ panel, record, pod, name }: PodForwardInputs): PodForwardCommand {
  const [forwarding, setForwarding] = useState<Forwarding>(IDLE);
  const ports = panel?.ports;

  async function start(host: Ports, target: HostRecord, { port }: DeclaredPort) {
    try {
      // The call comes first, in the press itself: the host reads the user action that made it at the call, and nothing is awaited before it.
      const answer = host.forward({ resourceId: name, resourceKey: podDefinition.type, reference: target.record.reference, remotePort: port, protocol: 'TCP' });
      setForwarding({ kind: 'running', port });
      await answer;
      // The host has started the forward and shows its Ports tool: what is left to say is nothing.
      setForwarding(IDLE);
    } catch (error: unknown) {
      setForwarding({ kind: 'refused', port, words: wordsOf(error) });
    }
  }

  const declared = pod === undefined || pod.status.phase !== 'Running' ? [] : declaredTcpPorts(pod);
  const several = (pod?.spec.containers?.length ?? 0) > 1;
  const entries: readonly PageHeaderMenuItem[] =
    ports === undefined || record === undefined
      ? []
      : declared.map((port, index) => ({
        id: `forward-port:${String(index)}`,
        label: labelOf(port, several),
        onSelect: () => {
          void start(ports, record, port);
        },
        disabled: forwarding.kind === 'running',
      }));

  if (forwarding.kind === 'idle') {
    return { entries };
  }

  const title = `Forward port ${String(forwarding.port)} of ${name}`;
  const operation: PageOperation =
    forwarding.kind === 'running'
      ? { title, state: 'running', text: `Forwarding port ${String(forwarding.port)} of ${name}`, progress: 'indeterminate' }
      : {
        title,
        state: 'failed',
        text: `Port ${String(forwarding.port)} could not be forwarded. ${forwarding.words}`,
        onDismiss: () => {
          setForwarding(IDLE);
        },
      };
  return { entries, operation };
}
