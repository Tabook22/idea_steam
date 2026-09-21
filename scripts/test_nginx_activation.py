import importlib.util
import pathlib
import unittest
from unittest.mock import patch

source = pathlib.Path(__file__).resolve().parents[1] / 'deploy/vps/activate-nginx.py'
spec = importlib.util.spec_from_file_location('activate_nginx', source)
activation = importlib.util.module_from_spec(spec)
spec.loader.exec_module(activation)

class ActivationTests(unittest.TestCase):
    def test_waits_through_old_worker_and_temporary_gateway_response(self):
        with patch.object(activation, 'password_gate_status', side_effect=[
            (200, ''), (502, ''), (401, 'Basic realm="Idea Stream", charset="UTF-8"')
        ]) as probe, patch.object(activation.time, 'sleep'):
            activation.wait_for_password_gate('http://test/ideas/api/healthz')
            self.assertEqual(probe.call_count, 3)

    def test_rejects_public_200_response(self):
        with patch.object(activation, 'password_gate_status', return_value=(200, '')):
            with self.assertRaisesRegex(RuntimeError, 'HTTP 200'):
                activation.wait_for_password_gate('http://test', timeout=0)

    def test_rejects_some_other_login_prompt(self):
        with patch.object(activation, 'password_gate_status', return_value=(401, 'Basic realm="Other"')):
            with self.assertRaisesRegex(RuntimeError, 'Other'):
                activation.wait_for_password_gate('http://test', timeout=0)

    def test_retries_network_failure(self):
        with patch.object(activation, 'password_gate_status', side_effect=[
            activation.urllib.error.URLError('reload pending'), (401, 'Basic realm="Idea Stream"')
        ]), patch.object(activation.time, 'sleep'):
            activation.wait_for_password_gate('http://test')

if __name__ == '__main__':
    unittest.main()
