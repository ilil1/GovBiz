"""Check the isolated image test's runner inputs without starting Docker."""

import importlib.util
import json
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

spec = importlib.util.spec_from_file_location(
    "check_image", Path(__file__).with_name("check-image.py")
)
check_image = importlib.util.module_from_spec(spec)
spec.loader.exec_module(check_image)


class ImageRunnerContractTest(unittest.TestCase):
    def test_receipt_tests_receive_real_runner_and_reject_missing_input(self):
        calls = []

        def fake_docker(*arguments, capture=False, check=True):
            calls.append(arguments)
            if arguments[:2] == ("image", "inspect"):
                return SimpleNamespace(
                    stdout=json.dumps([{"Config": {"User": "10001:10001", "Cmd": ["gunicorn"]}}])
                )
            if arguments[:1] == ("inspect",):
                return SimpleNamespace(stdout='[{"State": {"ExitCode": 0}}]')
            if "id" in arguments:
                return SimpleNamespace(stdout="10001")
            if "OPS_TEST_BUDGET_CLIENT_PATH=/test-inputs/missing-budget-client.py" in arguments:
                return SimpleNamespace(
                    returncode=1, stderr="Usage receipt tests require the real runner source"
                )
            return SimpleNamespace(stdout="")

        def fake_request(container, path, host="localhost"):
            if host != "localhost":
                return {"status": 400}
            if path.endswith("/ready"):
                return {"status": 503, "body": '{"status":"DOWN","checks":{"database":"DOWN"}}'}
            return {"status": 200, "body": '{"status":"UP","service":"govbiz-ops-service"}'}

        with (
            patch.object(check_image, "docker", side_effect=fake_docker),
            patch.object(check_image, "request", side_effect=fake_request),
        ):
            check_image.main()

        receipt_calls = [
            args
            for args in calls
            if "apps.evaluations.test_usage_correction.UsageReceiptTests" in args
        ]
        self.assertEqual(len(receipt_calls), 3)
        for args in receipt_calls[:2]:
            self.assertIn("OPS_TEST_BUDGET_CLIENT_PATH=/test-inputs/budget_client.py", args)
        self.assertIn(
            "OPS_TEST_BUDGET_CLIENT_PATH=/test-inputs/missing-budget-client.py", receipt_calls[2]
        )
        run = next(args for args in calls if args[0] == "run")
        self.assertTrue(any("target=/test-inputs/budget_client.py,readonly" in arg for arg in run))


if __name__ == "__main__":
    unittest.main()
