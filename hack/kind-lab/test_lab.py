import argparse
import base64
import contextlib
import io
import json
import pathlib
import subprocess
import tempfile
import unittest
from unittest.mock import patch

import lab


class FakeRun:
    """Stands in for lab.run: records commands, reports kind clusters, and writes the kubeconfig kind would."""

    def __init__(self, clusters=(), fail_create=None, partial=False):
        self.clusters = list(clusters)
        self.fail_create = fail_create
        self.partial = partial
        self.calls = []

    def __call__(self, args, data=None, capture=False, timeout=360):
        self.calls.append(list(args))
        if args[:3] == ['kind', 'get', 'clusters']:
            return ''.join(name + '\n' for name in self.clusters)
        if args[:3] == ['kind', 'create', 'cluster']:
            if self.partial:
                self.clusters.append(args[args.index('--name') + 1])
            if self.fail_create:
                raise self.fail_create
            pathlib.Path(args[args.index('--kubeconfig') + 1]).write_text('private')
        return ''


class StateCase(unittest.TestCase):
    """Runs against a temporary STATE so no test reads or writes the real private state."""

    def setUp(self):
        scratch = tempfile.TemporaryDirectory()
        self.addCleanup(scratch.cleanup)
        self.state = pathlib.Path(scratch.name) / '.state'
        patcher = patch.object(lab, 'STATE', self.state)
        patcher.start()
        self.addCleanup(patcher.stop)

    def run_lab(self, *argv, fake):
        """Run lab.main() against a fake kind runner with every worker Ready."""
        with patch.object(lab, 'run', fake), patch.object(lab, 'ready_workers', return_value=10), \
                patch('sys.argv', ['lab.py', *argv]), patch('builtins.print'), \
                contextlib.redirect_stderr(io.StringIO()):
            lab.main()

    def named_state(self, name, **files):
        directory = self.state / 'clusters' / name
        directory.mkdir(parents=True)
        for filename, content in files.items():
            (directory / filename).write_text(content)
        return directory


class NameTests(unittest.TestCase):
    def test_accepts_dns_safe_names(self):
        for name in ('omniview-load-lab', 'omniview-bench', 'a', 'a1', 'bench-10', 'x' * 40):
            with self.subTest(name=name):
                self.assertEqual(lab.cluster_name(name), name)

    def test_rejects_names_that_are_not_dns_safe_or_could_escape_state(self):
        for name in ('', '-bench', 'bench-', 'Bench', 'bench_1', 'bench.1', '../escape', 'a/b', 'a b',
                     'bench\n', '\u00e9', 'x' * 41):
            with self.subTest(name=name):
                with self.assertRaises(argparse.ArgumentTypeError):
                    lab.cluster_name(name)
                with self.assertRaises(ValueError):
                    lab.state_dir(name)


class StateIsolationTests(StateCase):
    def test_default_lab_keeps_its_original_flat_state(self):
        self.assertEqual(lab.state_dir(lab.DEFAULT_NAME), self.state)
        self.assertEqual(lab.kubeconfig_path(lab.DEFAULT_NAME), self.state / 'kubeconfig')

    def test_named_labs_get_distinct_directories_that_never_touch_default_files(self):
        names = ['bench', 'bench-2', 'kubeconfig', 'clusters', 'kind', 'omniview-load-lab-2']
        directories = [lab.state_dir(name) for name in names]
        self.assertEqual(len(set(directories)), len(names))
        for name, directory in zip(names, directories):
            with self.subTest(name=name):
                self.assertEqual(directory, self.state / 'clusters' / name)
                self.assertNotIn(directory, (self.state, self.state / 'kubeconfig', self.state / 'kind.json'))
                self.assertEqual(lab.kubeconfig_path(name), directory / 'kubeconfig')

    def test_kubectl_selects_the_clusters_own_kubeconfig_and_context(self):
        directory = self.named_state('bench', kubeconfig='private')
        with patch.object(lab, 'run') as run:
            lab.kubectl('bench', 'get', 'nodes')
        self.assertEqual(run.call_args[0][0][:5], [
            'kubectl', '--kubeconfig', str(directory / 'kubeconfig'), '--context', 'kind-bench'])

    def test_missing_private_kubeconfig_is_reported_without_running_kubectl(self):
        with patch.object(lab, 'run') as run, self.assertRaises(SystemExit):
            lab.kubectl('bench', 'get', 'nodes')
        run.assert_not_called()

    def test_forget_state_never_removes_the_default_state_and_keeps_foreign_files(self):
        with self.assertRaises(ValueError):
            lab.forget_state(lab.DEFAULT_NAME)
        directory = self.named_state('bench', kubeconfig='private', **{'notes.txt': 'mine'})
        with patch('builtins.print') as output:
            lab.forget_state('bench')
        self.assertEqual([path.name for path in directory.iterdir()], ['notes.txt'])
        output.assert_called_once()

    def test_render_labels_every_object_for_the_selected_cluster_without_contacting_anything(self):
        output = io.StringIO()
        with patch.object(lab, 'run') as run, \
                patch('sys.argv', ['lab.py', 'render', '--name', 'bench', '--preset', 'smoke']), \
                contextlib.redirect_stdout(output):
            lab.main()
        run.assert_not_called()
        items = json.loads(output.getvalue())['items']
        self.assertTrue(items)
        self.assertEqual({item['metadata']['labels']['app.kubernetes.io/part-of'] for item in items}, {'bench'})


class StageTests(unittest.TestCase):
    def kinds(self, preset, cluster='bench'):
        counts = {}
        for item in lab.inventory(preset, cluster):
            counts[item['kind']] = counts.get(item['kind'], 0) + 1
        return counts

    def test_benchmark_stages_have_exact_real_pod_counts(self):
        for preset, pods, namespaces in (('baseline', 300, 10), ('medium', 600, 20), ('large', 1000, 20)):
            with self.subTest(preset=preset):
                self.assertEqual(lab.pod_count(preset), pods)
                counts = self.kinds(preset)
                self.assertEqual(counts['Namespace'], namespaces)
                for kind in ('Deployment', 'Service', 'ConfigMap', 'Secret'):
                    self.assertEqual(counts[kind], pods)
                self.assertEqual(counts['Event'], pods * 3)

    def test_every_application_is_one_deployment_with_one_pod(self):
        deployments = [item for item in lab.inventory('smoke', 'bench') if item['kind'] == 'Deployment']
        self.assertEqual(len(deployments), lab.pod_count('smoke'))
        for deployment in deployments:
            self.assertEqual(deployment['spec']['replicas'], 1)
            template = deployment['spec']['template']['metadata']['labels']
            self.assertEqual(template['app.kubernetes.io/part-of'], 'bench')

    def test_each_stage_contains_the_previous_stage(self):
        def deployments(preset):
            return {(item['metadata']['namespace'], item['metadata']['name'])
                    for item in lab.inventory(preset, 'bench') if item['kind'] == 'Deployment'}
        baseline, medium, large = deployments('baseline'), deployments('medium'), deployments('large')
        self.assertLess(baseline, medium)
        self.assertLess(medium, large)

    def test_secrets_stay_labeled_synthetic_filler(self):
        secrets = [item for item in lab.inventory('smoke', 'bench') if item['kind'] == 'Secret']
        self.assertEqual(len(secrets), lab.pod_count('smoke'))
        for secret in secrets:
            self.assertEqual(secret['metadata']['labels'], {'app.kubernetes.io/part-of': 'bench'})
            self.assertEqual(secret['type'], 'Opaque')
            self.assertEqual(list(secret['data']), ['synthetic'])
            self.assertEqual(base64.b64decode(secret['data']['synthetic']), b'x' * 1024)

    def test_default_lab_objects_keep_the_original_label_value(self):
        for item in lab.inventory('smoke', lab.DEFAULT_NAME):
            self.assertEqual(item['metadata']['labels'], {'app.kubernetes.io/part-of': 'omniview-load-lab'})


class OwnershipTests(StateCase):
    def test_default_lab_needs_no_receipt(self):
        lab.require_owned(lab.DEFAULT_NAME)

    def test_named_lab_needs_a_receipt_naming_that_cluster(self):
        directory = self.named_state('bench')
        with self.assertRaises(SystemExit):
            lab.require_owned('bench')
        for content in ('not json', 'null', '[]', json.dumps({'name': 'other'})):
            with self.subTest(content=content):
                (directory / 'owner.json').write_text(content)
                with self.assertRaises(SystemExit):
                    lab.require_owned('bench')
        (directory / 'owner.json').write_text(json.dumps({'name': 'bench'}))
        lab.require_owned('bench')


class CreateTests(StateCase):
    def test_invalid_name_is_rejected_before_any_command_runs(self):
        for name in ('../escape', 'Bench', 'a_b'):
            with self.subTest(name=name):
                fake = FakeRun()
                with self.assertRaises(SystemExit):
                    self.run_lab('create', '--name', name, fake=fake)
                self.assertEqual(fake.calls, [])
                self.assertFalse(self.state.exists())

    def test_existing_default_cluster_is_refused_without_touching_its_state(self):
        self.state.mkdir(mode=0o700)
        (self.state / 'kubeconfig').write_text('original kubeconfig')
        (self.state / 'kind.json').write_text('original kind.json')
        fake = FakeRun(clusters=[lab.DEFAULT_NAME])
        with self.assertRaises(SystemExit):
            self.run_lab('create', fake=fake)
        self.assertEqual(fake.calls, [['kind', 'get', 'clusters']])
        self.assertEqual((self.state / 'kubeconfig').read_text(), 'original kubeconfig')
        self.assertEqual((self.state / 'kind.json').read_text(), 'original kind.json')

    def test_existing_named_cluster_is_refused_before_any_state_is_written(self):
        fake = FakeRun(clusters=['kind', 'bench'])
        with self.assertRaises(SystemExit):
            self.run_lab('create', '--name', 'bench', fake=fake)
        self.assertEqual(fake.calls, [['kind', 'get', 'clusters']])
        self.assertFalse(self.state.exists())

    def test_existing_named_state_is_refused_without_overwriting_it(self):
        directory = self.named_state('bench', kubeconfig='original')
        fake = FakeRun()
        with self.assertRaises(SystemExit):
            self.run_lab('create', '--name', 'bench', fake=fake)
        self.assertEqual(fake.calls, [['kind', 'get', 'clusters']])
        self.assertEqual([path.name for path in directory.iterdir()], ['kubeconfig'])
        self.assertEqual((directory / 'kubeconfig').read_text(), 'original')

    def test_named_create_keeps_everything_inside_its_own_state(self):
        self.state.mkdir(mode=0o700)
        (self.state / 'kubeconfig').write_text('default private')
        fake = FakeRun(clusters=['kind', lab.DEFAULT_NAME])
        self.run_lab('create', '--name', 'bench', '--workers', '10', fake=fake)
        directory = self.state / 'clusters' / 'bench'
        command = next(call for call in fake.calls if call[:3] == ['kind', 'create', 'cluster'])
        self.assertEqual(command[command.index('--name') + 1], 'bench')
        self.assertEqual(command[command.index('--config') + 1], str(directory / 'kind.json'))
        self.assertEqual(command[command.index('--kubeconfig') + 1], str(directory / 'kubeconfig'))
        config = json.loads((directory / 'kind.json').read_text())
        self.assertEqual([node['role'] for node in config['nodes']], ['control-plane'] + ['worker'] * 10)
        self.assertEqual(json.loads((directory / 'owner.json').read_text())['name'], 'bench')
        self.assertEqual((self.state / 'kubeconfig').read_text(), 'default private')
        self.assertEqual(sorted(path.name for path in self.state.iterdir()), ['clusters', 'kubeconfig'])

    def test_default_create_keeps_the_original_flat_layout_without_a_receipt(self):
        fake = FakeRun()
        self.run_lab('create', '--workers', '3', fake=fake)
        command = next(call for call in fake.calls if call[:3] == ['kind', 'create', 'cluster'])
        self.assertEqual(command[command.index('--name') + 1], 'omniview-load-lab')
        self.assertEqual(command[command.index('--kubeconfig') + 1], str(self.state / 'kubeconfig'))
        self.assertEqual(sorted(path.name for path in self.state.iterdir()), ['kind.json', 'kubeconfig'])

    def test_failed_create_discards_only_its_own_state_when_kind_left_no_cluster(self):
        other = self.named_state('other', kubeconfig='other private')
        fake = FakeRun(fail_create=subprocess.CalledProcessError(1, 'kind'))
        with self.assertRaises(subprocess.CalledProcessError):
            self.run_lab('create', '--name', 'bench', fake=fake)
        self.assertFalse((self.state / 'clusters' / 'bench').exists())
        self.assertEqual((other / 'kubeconfig').read_text(), 'other private')

    def test_partially_created_cluster_keeps_its_state_for_inspection(self):
        fake = FakeRun(fail_create=subprocess.CalledProcessError(1, 'kind'), partial=True)
        with self.assertRaises(subprocess.CalledProcessError):
            self.run_lab('create', '--name', 'bench', fake=fake)
        directory = self.state / 'clusters' / 'bench'
        self.assertTrue((directory / 'kind.json').is_file())
        self.assertTrue((directory / 'owner.json').is_file())


class DeleteTests(StateCase):
    def test_delete_requires_explicit_confirmation(self):
        self.named_state('bench', **{'owner.json': json.dumps({'name': 'bench'})})
        fake = FakeRun(clusters=['bench'])
        with self.assertRaises(SystemExit):
            self.run_lab('delete', '--name', 'bench', fake=fake)
        self.assertEqual(fake.calls, [])

    def test_named_delete_requires_this_checkouts_ownership_receipt(self):
        fake = FakeRun(clusters=['bench'])
        with self.assertRaises(SystemExit):
            self.run_lab('delete', '--name', 'bench', '--confirm-delete', fake=fake)
        self.assertEqual(fake.calls, [])

    def test_named_delete_removes_only_its_cluster_and_state(self):
        bench = self.named_state('bench', kubeconfig='private', **{'owner.json': json.dumps({'name': 'bench'})})
        other = self.named_state('other', kubeconfig='other private')
        (self.state / 'kubeconfig').write_text('default private')
        fake = FakeRun(clusters=['bench'])
        self.run_lab('delete', '--name', 'bench', '--confirm-delete', fake=fake)
        self.assertEqual(fake.calls, [
            ['kind', 'delete', 'cluster', '--name', 'bench', '--kubeconfig', str(bench / 'kubeconfig')]])
        self.assertFalse(bench.exists())
        self.assertEqual((other / 'kubeconfig').read_text(), 'other private')
        self.assertEqual((self.state / 'kubeconfig').read_text(), 'default private')

    def test_default_delete_targets_only_the_default_cluster_and_keeps_its_files(self):
        self.state.mkdir(mode=0o700)
        (self.state / 'kubeconfig').write_text('default private')
        fake = FakeRun(clusters=[lab.DEFAULT_NAME, 'kind'])
        self.run_lab('delete', '--confirm-delete', fake=fake)
        self.assertEqual(fake.calls, [
            ['kind', 'delete', 'cluster', '--name', 'omniview-load-lab',
             '--kubeconfig', str(self.state / 'kubeconfig')]])
        self.assertEqual((self.state / 'kubeconfig').read_text(), 'default private')


class SeedTests(StateCase):
    def fake_kubectl(self, ready, unready=0):
        """Fake lab.kubectl: serves a node list and records every other call."""
        def node(is_ready):
            return {'status': {'conditions': [{'type': 'Ready', 'status': 'True' if is_ready else 'False'}]}}
        nodes = json.dumps({'items': [node(True) for _ in range(ready)] + [node(False) for _ in range(unready)]})
        calls = []

        def kubectl(cluster, *args, data=None, capture=False):
            calls.append((cluster, args, data))
            return nodes if args[:2] == ('get', 'nodes') else ''
        kubectl.calls = calls
        return kubectl

    def seed(self, name, preset, kubectl):
        with patch.object(lab, 'kubectl', kubectl), \
                patch('sys.argv', ['lab.py', 'seed', '--name', name, '--preset', preset]):
            lab.main()

    def test_capacity_counts_one_hundred_pods_per_ready_worker(self):
        cases = (('baseline', 3, 0, True), ('baseline', 2, 5, False), ('medium', 6, 0, True),
                 ('medium', 5, 0, False), ('large', 10, 0, True), ('large', 9, 1, False),
                 ('large', 3, 0, False), ('xl', 10, 0, False))
        for preset, ready, unready, allowed in cases:
            with self.subTest(preset=preset, ready=ready, unready=unready):
                with patch.object(lab, 'kubectl', self.fake_kubectl(ready, unready)):
                    if allowed:
                        lab.require_capacity('bench', preset)
                    else:
                        with self.assertRaises(SystemExit):
                            lab.require_capacity('bench', preset)

    def test_each_stage_applies_exactly_its_inventory_and_waits_for_every_namespace(self):
        self.named_state('bench', **{'owner.json': json.dumps({'name': 'bench'})})
        for preset, pods, namespaces in (('baseline', 300, 10), ('medium', 600, 20), ('large', 1000, 20)):
            with self.subTest(preset=preset):
                kubectl = self.fake_kubectl(10)
                self.seed('bench', preset, kubectl)
                applied = [item for _, args, data in kubectl.calls if args[0] == 'apply' for item in data['items']]
                self.assertEqual(sum(item['kind'] == 'Deployment' for item in applied), pods)
                self.assertEqual(len(applied), namespaces + pods * 7)
                waits = [args[args.index('-n') + 1] for _, args, _ in kubectl.calls if args[0] == 'wait']
                self.assertEqual(waits, [f'load-{n:03}' for n in range(namespaces)])

    def test_named_seed_without_receipt_makes_no_cluster_call(self):
        kubectl = self.fake_kubectl(10)
        with self.assertRaises(SystemExit):
            self.seed('bench', 'baseline', kubectl)
        self.assertEqual(kubectl.calls, [])

    def test_default_lab_refuses_a_preset_beyond_its_workers_before_applying_anything(self):
        kubectl = self.fake_kubectl(3)
        with self.assertRaises(SystemExit):
            self.seed(lab.DEFAULT_NAME, 'large', kubectl)
        self.assertEqual([args[0] for _, args, _ in kubectl.calls], ['get'])


if __name__ == '__main__':
    unittest.main()
