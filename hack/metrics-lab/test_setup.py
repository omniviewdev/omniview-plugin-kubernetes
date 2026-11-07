"""Offline setup safety checks; no cluster, Docker daemon, or real credentials required."""
import importlib.util
import copy
import json
import os
from pathlib import Path
import stat
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('metrics_lab_setup', Path(__file__).with_name('setup.py'))
lab = importlib.util.module_from_spec(spec)
spec.loader.exec_module(lab)


class CredentialPathSafety(unittest.TestCase):
    def test_symlinked_state_cannot_change_external_credentials_or_permissions(self):
        with tempfile.TemporaryDirectory() as scratch:
            root = Path(scratch)
            unrelated = root / 'unrelated'
            unrelated.mkdir(mode=0o755)
            credentials = unrelated / 'kubeconfig'
            credentials.write_text('keep-existing-credentials')
            original_mode = stat.S_IMODE(unrelated.stat().st_mode)
            state = root / '.state'
            state.symlink_to(unrelated, target_is_directory=True)
            with patch.multiple(lab, STATE=state, KUBE=state / 'kubeconfig'):
                with self.assertRaises(OSError):
                    lab.write_kubeconfig('new-private-config')
            self.assertEqual(credentials.read_text(), 'keep-existing-credentials')
            self.assertEqual(stat.S_IMODE(unrelated.stat().st_mode), original_mode)

    def test_private_replacement_does_not_overwrite_a_hardlinked_external_file(self):
        with tempfile.TemporaryDirectory() as scratch:
            root = Path(scratch)
            unrelated = root / 'existing-credentials'
            unrelated.write_text('keep-existing-credentials')
            original_mode = stat.S_IMODE(unrelated.stat().st_mode)
            state = root / '.state'
            state.mkdir(mode=0o755)
            config = state / 'kubeconfig'
            os.link(unrelated, config)
            with patch.multiple(lab, STATE=state, KUBE=config):
                lab.write_kubeconfig('new-private-config')
            self.assertEqual(unrelated.read_text(), 'keep-existing-credentials')
            self.assertEqual(stat.S_IMODE(unrelated.stat().st_mode), original_mode)
            self.assertNotEqual(config.stat().st_ino, unrelated.stat().st_ino)
            self.assertEqual(stat.S_IMODE(state.stat().st_mode), 0o700)
            self.assertEqual(stat.S_IMODE(config.stat().st_mode), 0o600)
            self.assertEqual(config.read_text(), 'new-private-config')


class SetupSafety(unittest.TestCase):
    def test_remote_docker_is_rejected_before_kind_access(self):
        with patch.dict(os.environ, {'DOCKER_HOST': 'ssh://remote', 'DOCKER_CONTEXT': ''}, clear=True):
            with patch.object(lab, 'run') as run:
                with self.assertRaises(SystemExit):
                    lab.local_config()
                run.assert_not_called()

    def test_context_override_cannot_hide_remote_docker(self):
        with patch.dict(os.environ, {'DOCKER_HOST': 'unix:///local', 'DOCKER_CONTEXT': 'remote'}, clear=True):
            with patch.object(lab, 'run', return_value=json.dumps([
                    {'Endpoints': {'docker': {'Host': 'tcp://remote:2376'}}}])):
                with self.assertRaises(SystemExit):
                    lab.local_docker()

    def test_source_changes_roll_pods_but_identical_source_is_stable(self):
        objects = [
            {'kind': 'ConfigMap', 'data': {'workload.py': 'first'}},
            {'kind': 'Deployment', 'spec': {'template': {'metadata': {}}}},
        ]
        with patch.object(lab, 'kubectl') as kubectl:
            lab.apply_workloads(copy.deepcopy(objects))
            first = json.loads(kubectl.call_args.kwargs['data'])
            lab.apply_workloads(copy.deepcopy(objects))
            same = json.loads(kubectl.call_args.kwargs['data'])
            objects[0]['data']['workload.py'] = 'second'
            lab.apply_workloads(objects)
            changed = json.loads(kubectl.call_args.kwargs['data'])
        template = lambda payload: payload['items'][1]['spec']['template']
        self.assertEqual(template(first), template(same))
        self.assertNotEqual(template(first), template(changed))

    def test_chart_rejects_prometheus_owned_by_another_release(self):
        resource = {'apiVersion': 'monitoring.coreos.com/v1', 'kind': 'Prometheus',
                    'metadata': {'name': 'omniview-metrics-prometheus', 'namespace': 'observability'}}
        live = {'metadata': {'labels': {lab.OWNER_KEY: lab.OWNER,
                                       'app.kubernetes.io/managed-by': 'Helm'},
                             'annotations': {'meta.helm.sh/release-name': 'other',
                                             'meta.helm.sh/release-namespace': lab.NAMESPACE}}}
        discovery = json.dumps({'resources': [
            {'kind': 'Prometheus', 'name': 'prometheuses', 'namespaced': True}]})
        with patch.object(lab, 'chart_objects', return_value=[resource]):
            with patch.object(lab, 'helm', return_value='rendered'):
                with patch.object(lab, 'kubectl', side_effect=['monitoring.coreos.com/v1\n', discovery]):
                    with patch.object(lab, 'existing', return_value=live):
                        with self.assertRaises(SystemExit):
                            lab.chart_preflight(True)

    def test_owned_subchart_without_fixture_label_is_allowed_only_for_owned_release(self):
        resource = {'apiVersion': 'v1', 'kind': 'ServiceAccount',
                    'metadata': {'name': 'omniview-metrics-grafana'}}
        live = {'metadata': {'labels': {'app.kubernetes.io/managed-by': 'Helm'},
                             'annotations': {'meta.helm.sh/release-name': lab.RELEASE,
                                             'meta.helm.sh/release-namespace': lab.NAMESPACE}}}
        discovery = json.dumps({'resources': [
            {'kind': 'ServiceAccount', 'name': 'serviceaccounts', 'namespaced': True}]})
        for owned in (True, False):
            with self.subTest(owned=owned), patch.object(lab, 'chart_objects', return_value=[resource]):
                with patch.object(lab, 'helm', return_value='rendered'):
                    with patch.object(lab, 'kubectl', side_effect=['v1\n', discovery]):
                        with patch.object(lab, 'existing', return_value=live) as existing:
                            if owned:
                                lab.chart_preflight(True)
                            else:
                                with self.assertRaises(SystemExit):
                                    lab.chart_preflight(False)
                            existing.assert_called_once_with(
                                'serviceaccounts', 'omniview-metrics-grafana', lab.NAMESPACE)

    def test_shared_crd_is_only_read_and_incompatible_versions_are_rejected(self):
        resource = {'apiVersion': 'apiextensions.k8s.io/v1', 'kind': 'CustomResourceDefinition',
                    'metadata': {'name': 'prometheuses.monitoring.coreos.com'},
                    'spec': {'versions': [{'name': 'v1', 'served': True}]}}
        for version in ('v1', 'v1beta1'):
            with self.subTest(version=version), patch.object(lab, 'chart_objects', return_value=[resource]):
                with patch.object(lab, 'helm', return_value='rendered') as helm:
                    with patch.object(lab, 'kubectl', return_value='apiextensions.k8s.io/v1\n') as kubectl:
                        live = {'spec': {'versions': [{'name': version, 'served': True}]}}
                        with patch.object(lab, 'existing', return_value=live) as existing:
                            if version == 'v1':
                                lab.chart_preflight(True)
                            else:
                                with self.assertRaises(SystemExit):
                                    lab.chart_preflight(True)
                            existing.assert_called_once_with(
                                'customresourcedefinition', 'prometheuses.monitoring.coreos.com')
                        kubectl.assert_called_once_with('api-versions', capture=True)
                        self.assertIn('--include-crds', helm.call_args.args)

    def test_real_crd_yaml_value_enum_preserves_strings_and_booleans(self):
        rendered = """apiVersion: apiextensions.k8s.io/v1
kind: CustomResourceDefinition
metadata:
  name: samples.example.com
spec:
  versions:
    - name: v1
      served: true
      storage: false
      schema:
        openAPIV3Schema:
          type: string
          enum:
            - =
            - '!='
"""
        item, = lab.chart_objects(rendered)
        version = item['spec']['versions'][0]
        self.assertIs(version['served'], True)
        self.assertIs(version['storage'], False)
        self.assertEqual(version['schema']['openAPIV3Schema']['enum'], ['=', '!='])


if __name__ == '__main__':
    unittest.main()
