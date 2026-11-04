"""Filesystem safety checks; no cluster, Docker daemon, or real credentials required."""
import importlib.util
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


if __name__ == '__main__':
    unittest.main()
