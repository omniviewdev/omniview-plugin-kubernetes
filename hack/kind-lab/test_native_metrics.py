import json
import unittest

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


if __name__ == '__main__':
    unittest.main()
