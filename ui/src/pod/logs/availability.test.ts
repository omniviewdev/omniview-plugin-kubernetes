import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { hostRecord } from '../../kinds/testing';
import { podDetail } from '../data/object';

import { logsUnavailable, NOT_STARTED } from './availability';

// When a Pod cannot have logs. The oracle is the cluster: each Pod below is an object a real API server (kube-apiserver v1.35.0 on kind v0.30.0) served, from the Pods list's fixtures
// (`../../kinds/pods/fixtures/pods-table.json`, the slice fixture and the extra states). A container that never ran has no log to read: the API answers a read of it with "waiting to start", so
// the command says so instead of opening a session that can only fail. A container that ran once, even one that is waiting again (a crash loop) or has finished, has one.

type Capture = { readonly rows: ReadonlyArray<{ readonly object: { readonly metadata: { readonly name: string } } }> };

const pods: { readonly captures: readonly Capture[] } = JSON.parse(readFileSync(path.join(import.meta.dirname, '../../kinds/pods/fixtures/pods-table.json'), 'utf8'));

const served = (name: string) => {
  const found = pods.captures[1]?.rows.find(({ object }) => object.metadata.name === name);
  if (found === undefined) {
    throw new Error(`no ${name} in the fixtures`);
  }

  return podDetail(hostRecord(found.object));
};

describe('logsUnavailable: a Pod no container of which ever ran has no logs', () => {
  it.each([
    ['unschedulable', 'Pending, never placed on a node: no container status at all'],
    ['gated', 'Pending, held back by a scheduling gate: no container status at all'],
    ['bad-image', 'Pending, ImagePullBackOff: its one container is waiting and never ran'],
  ])('says so for %s (%s)', (name) => {
    expect(logsUnavailable(served(name))).toBe(NOT_STARTED);
  });

  it('says so for an object that holds no status, and for one that is not a Pod at all', () => {
    expect(logsUnavailable(podDetail(hostRecord({ metadata: { name: 'bare', namespace: 'n' }, spec: { containers: [{ name: 'app' }] } })))).toBe(NOT_STARTED);
    expect(logsUnavailable(podDetail(hostRecord('not a pod')))).toBe(NOT_STARTED);
  });

  it('says it in one sentence that tells the person to wait: the identity line prints the first reason a command has', () => {
    expect(NOT_STARTED).toBe('No container of this Pod has started, so it has no logs yet.');
  });
});

describe('logsUnavailable: a Pod one container of which ran has logs', () => {
  it.each([
    ['cart-api-86bf766589-78whc', 'Running, two containers running'],
    ['nightly-report-mdxcg', 'Succeeded: its container finished'],
    ['broken-migration-tkqz2', 'Failed: its container exited with an error'],
    ['oom', 'its container was killed for memory and ran'],
    ['terminating', 'being deleted, and its containers still hold what they wrote'],
    ['crashloop', 'CrashLoopBackOff: the container is waiting again, and its last run is what a read gives'],
    ['init-wait', 'Init:0/1: the init container is running, the app container has not started'],
    ['init-fail', 'Init:Error: the init container ran and failed, the app container has not started'],
    ['sidecar', 'Running with a sidecar'],
    ['mixed', 'one container ready, one not'],
  ])('has none of the reason for %s (%s)', (name) => {
    expect(logsUnavailable(served(name))).toBeUndefined();
  });

  it('counts an ephemeral (debug) container that runs, whatever the others say', () => {
    const pod = podDetail(
      hostRecord({
        metadata: { name: 'debugged', namespace: 'n' },
        spec: { containers: [{ name: 'app' }], ephemeralContainers: [{ name: 'debugger' }] },
        status: { containerStatuses: [{ name: 'app', state: { waiting: { reason: 'ImagePullBackOff' } } }], ephemeralContainerStatuses: [{ name: 'debugger', state: { running: { startedAt: '2026-11-19T10:00:00Z' } } }] },
      }),
    );
    expect(logsUnavailable(pod)).toBeUndefined();
  });

  it('counts a container that is only known by the run before the present one (restarted, and not running now)', () => {
    const pod = podDetail(
      hostRecord({
        metadata: { name: 'restarted', namespace: 'n' },
        spec: { containers: [{ name: 'app' }] },
        status: { containerStatuses: [{ name: 'app', state: { waiting: { reason: 'ContainerCreating' } }, lastState: { terminated: { exitCode: 1 } } }] },
      }),
    );
    expect(logsUnavailable(pod)).toBeUndefined();
  });
});
