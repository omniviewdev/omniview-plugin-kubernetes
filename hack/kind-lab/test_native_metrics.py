import contextlib
import io
import json
import pathlib
import tempfile
import unittest
from unittest.mock import patch

import lab
import native_metrics as native

from native_metrics import decode_manifest_objects


class ManifestOutputTests(unittest.TestCase):
    def test_preserves_all_concatenated_objects_and_list_members(self):
        service = {'apiVersion': 'v1', 'kind': 'Service', 'metadata': {'name': 'metrics-server'}}
        deployment = {'apiVersion': 'apps/v1', 'kind': 'Deployment', 'metadata': {'name': 'metrics-server'}}
        role = {'apiVersion': 'rbac.authorization.k8s.io/v1', 'kind': 'ClusterRole'}
        output = json.dumps(service) + '\n\n' + json.dumps({'kind': 'List', 'items': [deployment, role]})
        self.assertEqual(decode_manifest_objects(output), [service, deployment, role])

    def test_rejects_empty_or_non_object_manifest_output(self):
        for output in ('  \n', 'null', '[]', '{"kind":"List","items":[42]}'):
            with self.subTest(output=output):
                with self.assertRaises(RuntimeError):
                    decode_manifest_objects(output)

    def test_does_not_silently_accept_trailing_malformed_object(self):
        with self.assertRaises(json.JSONDecodeError):
            decode_manifest_objects('{"kind":"Service"}\n{"kind":')


class VerificationBoundaryTests(unittest.TestCase):
    def route(self):
        return {
            'deployment': {'metadata': {'uid': 'deployment'},
                           'spec': {'template': {'spec': {'containers': [{'image': native.IMAGE}]}}}},
            'apiservice': {'spec': {'service': {'namespace': 'kube-system', 'name': 'metrics-server'}},
                           'status': {'conditions': [{'type': 'Available', 'status': 'True'}]}},
            'service': {'spec': {'ports': [{'port': 443, 'name': 'https'}]}},
            'endpoints': {'subsets': [{'ports': [{'name': 'https', 'port': 10250}],
                                      'addresses': [{'ip': '10.0.0.1', 'targetRef': {
                                          'kind': 'Pod', 'namespace': 'kube-system',
                                          'name': 'metrics-pod', 'uid': 'pod'}}]}]},
            'pod': {'metadata': {'uid': 'pod', 'ownerReferences': [{
                'controller': True, 'kind': 'ReplicaSet', 'name': 'metrics-rs', 'uid': 'rs'}]},
                    'spec': {'containers': [{'image': native.IMAGE}]},
                    'status': {'podIPs': [{'ip': '10.0.0.1'}]}},
            'replicaset': {'metadata': {'uid': 'rs', 'ownerReferences': [{
                'controller': True, 'kind': 'Deployment', 'uid': 'deployment'}]}},
        }

    def test_route_requires_serving_pods_owned_by_pinned_deployment(self):
        objects = self.route()
        native.verify_route(lambda kind, *args: objects[kind])
        objects['replicaset']['metadata']['ownerReferences'][0]['uid'] = 'other'
        with self.assertRaises(ValueError):
            native.verify_route(lambda kind, *args: objects[kind])

    def test_route_rejects_different_api_service_and_unpinned_serving_image(self):
        objects = self.route()
        objects['apiservice']['spec']['service']['name'] = 'other'
        with self.assertRaises(ValueError):
            native.verify_route(lambda kind, *args: objects[kind])
        objects = self.route()
        objects['pod']['spec']['containers'][0]['image'] = 'other'
        with self.assertRaises(ValueError):
            native.verify_route(lambda kind, *args: objects[kind])

    def test_route_rejects_empty_endpoints_and_reused_pod_name(self):
        objects = self.route()
        objects['endpoints']['subsets'] = []
        with self.assertRaises(ValueError):
            native.verify_route(lambda kind, *args: objects[kind])
        objects = self.route()
        objects['pod']['metadata']['uid'] = 'replacement'
        with self.assertRaises(ValueError):
            native.verify_route(lambda kind, *args: objects[kind])

    def test_partial_container_sample_cannot_become_pod_total(self):
        pod = {'status': {
            'containerStatuses': [{'name': 'app', 'state': {'running': {}}}],
            'initContainerStatuses': [{'name': 'sidecar', 'state': {'running': {}}},
                                      {'name': 'finished', 'state': {'terminated': {}}}]}}
        with self.assertRaises(ValueError):
            native.require_container_coverage(pod, [{'name': 'app'}])
        native.require_container_coverage(pod, [{'name': 'app'}, {'name': 'sidecar'}])

    def test_expired_identity_check_cannot_start_api_checks(self):
        clock = [10]
        def identity(deadline):
            self.assertEqual(deadline, 11)
            clock[0] = 12
        with patch.object(native.time, 'monotonic', side_effect=lambda: clock[0]), \
                patch.object(native, 'require_owned_kind', side_effect=identity), \
                patch.object(native, 'kubectl') as kubectl:
            with self.assertRaises(RuntimeError):
                native.verify('load-000', 1)
            kubectl.assert_not_called()

    def test_request_result_after_deadline_is_rejected(self):
        clock = [10]
        def request(*args, **kwargs):
            self.assertEqual(kwargs['timeout'], 1)
            clock[0] = 12
            return '{}'
        with patch.object(native.time, 'monotonic', side_effect=lambda: clock[0]), \
                patch.object(native.time, 'sleep'), \
                patch.object(native, 'require_owned_kind'), \
                patch.object(native, 'kubectl', side_effect=request), \
                patch('builtins.print') as output:
            with self.assertRaises(RuntimeError):
                native.verify('load-000', 1)
            output.assert_not_called()

    def test_install_requires_creator_permission_before_cluster_access(self):
        with patch('sys.argv', ['native_metrics.py', 'install', '--confirm-install']), \
                patch.object(native, 'require_owned_kind') as identity, \
                patch.object(native, 'install') as install:
            with self.assertRaises(SystemExit):
                native.main()
            identity.assert_not_called()
            install.assert_not_called()


class ClusterSelectionTests(unittest.TestCase):
    def setUp(self):
        # main() and select() rebind the module's target; restore it so test order never matters.
        patcher = patch.multiple(native, NAME=native.NAME, KUBE=native.KUBE, CONTEXT=native.CONTEXT)
        patcher.start()
        self.addCleanup(patcher.stop)

    def install_argv(self):
        return ['native_metrics.py', 'install', '--name', 'bench-1',
                '--confirm-install', '--confirm-owner-permission']

    def test_default_target_keeps_the_original_private_state(self):
        native.select(lab.DEFAULT_NAME)
        self.assertEqual(native.NAME, 'omniview-load-lab')
        self.assertEqual(native.KUBE, lab.ROOT / '.state' / 'kubeconfig')
        self.assertEqual(native.CONTEXT, 'kind-omniview-load-lab')

    def test_named_target_uses_only_its_own_kubeconfig_and_context(self):
        native.select('bench-1')
        self.assertEqual(native.NAME, 'bench-1')
        self.assertEqual(native.KUBE, lab.ROOT / '.state' / 'clusters' / 'bench-1' / 'kubeconfig')
        self.assertEqual(native.CONTEXT, 'kind-bench-1')
        with patch.object(native, 'run') as run:
            native.kubectl('get', 'nodes')
        self.assertEqual(run.call_args[0][0][:5],
                         ['kubectl', '--kubeconfig', str(native.KUBE), '--context', 'kind-bench-1'])

    def test_verify_runs_against_the_requested_cluster(self):
        argv = ['native_metrics.py', 'verify', '--name', 'bench-1', '--namespace', 'load-001', '--timeout', '5']
        with patch('sys.argv', argv), patch.object(native, 'verify') as verify:
            native.main()
        verify.assert_called_once_with('load-001', 5)
        self.assertEqual(native.CONTEXT, 'kind-bench-1')

    def test_invalid_cluster_names_are_rejected_before_any_lookup(self):
        for name in ('../escape', 'Bench', 'x' * 41):
            with self.subTest(name=name):
                argv = ['native_metrics.py', 'verify', '--name', name]
                with patch('sys.argv', argv), patch.object(native, 'verify') as verify, \
                        patch.object(native, 'require_owned_kind') as identity, \
                        contextlib.redirect_stderr(io.StringIO()):
                    with self.assertRaises(SystemExit):
                        native.main()
                verify.assert_not_called()
                identity.assert_not_called()

    def test_named_install_requires_this_checkouts_receipt_before_cluster_access(self):
        with tempfile.TemporaryDirectory() as scratch, \
                patch.object(lab, 'STATE', pathlib.Path(scratch) / '.state'), \
                patch('sys.argv', self.install_argv()), \
                patch.object(native, 'require_owned_kind') as identity, \
                patch.object(native, 'install') as install:
            with self.assertRaises(SystemExit):
                native.main()
        identity.assert_not_called()
        install.assert_not_called()

    def test_named_install_proceeds_with_the_receipt(self):
        with tempfile.TemporaryDirectory() as scratch:
            state = pathlib.Path(scratch) / '.state'
            (state / 'clusters' / 'bench-1').mkdir(parents=True)
            (state / 'clusters' / 'bench-1' / 'owner.json').write_text(json.dumps({'name': 'bench-1'}))
            with patch.object(lab, 'STATE', state), patch('sys.argv', self.install_argv()), \
                    patch.object(native, 'require_owned_kind') as identity, \
                    patch.object(native, 'install') as install:
                native.main()
        identity.assert_called_once_with()
        install.assert_called_once_with()


if __name__ == '__main__':
    unittest.main()
