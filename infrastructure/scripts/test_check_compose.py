"""Verify the Compose smoke test passes the actual producer to Ops tests."""

import importlib.util
import io
import json
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

spec = importlib.util.spec_from_file_location(
    "check_compose", Path(__file__).with_name("check-compose.py")
)
check_compose = importlib.util.module_from_spec(spec)
spec.loader.exec_module(check_compose)


class ComposeRunnerContractTest(unittest.TestCase):
    def test_smoke_mounts_the_real_producer_only_in_the_disposable_test_container(self):
        calls = []

        def fake_run(command, environment, *, capture=False):
            calls.append(command)
            if "config" in command:
                project = command[command.index("--project-name") + 1]
                volumes = {
                    key: {"external": True, "name": name}
                    for key, name in check_compose.EXISTING_VOLUMES.items()
                }
                volumes.update(
                    {
                        key: {"name": f"{project}_{key}"}
                        for key in (
                            "web-workspace-node-modules",
                            "web-frontend-node-modules",
                            "web-shared-node-modules",
                        )
                    }
                )
                return SimpleNamespace(stdout=json.dumps({"volumes": volumes}))
            if "logs" in command:
                return SimpleNamespace(stdout="EXISTING_DATA_PRESERVED")
            if "ps" in command:
                return SimpleNamespace(stdout="container-id")
            if command[:2] == ["docker", "inspect"]:
                return SimpleNamespace(stdout="image-id")
            if command[:3] == ["docker", "image", "inspect"]:
                return SimpleNamespace(stdout='["gunicorn"]')
            return SimpleNamespace(stdout="")

        response = io.BytesIO(b'{"status":"UP"}')
        response.status = 200
        with (
            patch.object(sys, "argv", ["check-compose.py", "--smoke"]),
            patch.object(check_compose, "unused_port", side_effect=[31001, 31002]),
            patch.object(check_compose, "validate"),
            patch.object(check_compose, "run", side_effect=fake_run),
            patch.object(check_compose.urllib.request, "urlopen", return_value=response),
        ):
            check_compose.main()

        test_call = next(call for call in calls if "manage.py" in call and "test" in call)
        source = (
            check_compose.ROOT / "pipelines/evals/support_program_evidence/integrations/budget_client.py"
        )
        self.assertIn("run", test_call)
        self.assertIn("--rm", test_call)
        self.assertIn("--no-deps", test_call)
        self.assertIn(f"{source}:/test-inputs/budget_client.py:ro", test_call)
        self.assertIn("OPS_TEST_BUDGET_CLIENT_PATH=/test-inputs/budget_client.py", test_call)
        self.assertIn('OPS_TEST_GUNICORN_COMMAND=["gunicorn"]', test_call)
        self.assertTrue(source.is_file())
        self.assertTrue(all("--volume" not in call for call in calls if call is not test_call))


if __name__ == "__main__":
    unittest.main()
