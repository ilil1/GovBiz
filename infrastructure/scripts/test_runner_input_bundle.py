"""The wheel receives only approved catalog bytes, never adjacent raw evidence."""

import hashlib
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "llmops/bundle_runner_inputs.py"
spec = importlib.util.spec_from_file_location("runner_bundle", SCRIPT)
bundle = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bundle)


class RunnerInputBundleTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.owner = self.root / bundle.CONTRACTS
        self.owner.mkdir(parents=True)
        evidence = self.root / bundle.EVIDENCE
        evidence.mkdir(parents=True)
        self.fixture = b'{"fixture": 1}\n'
        self.capture = b'{"capture": 1}\n'
        (evidence / "fixture.json").write_bytes(self.fixture)
        (evidence / "capture.json").write_bytes(self.capture)
        (evidence / "raw-private.json").write_text("must never be bundled")
        self.catalog = [
            {
                "id": "fixed",
                "fixture": "fixture.json",
                "fixture_sha256": hashlib.sha256(self.fixture).hexdigest(),
                "captures": [{"id": "capture", "path": "capture.json"}],
            }
        ]
        self.release = {
            "datasets": {
                "fixed": {
                    "fixture_sha256": hashlib.sha256(self.fixture).hexdigest(),
                    "captures": {"capture": hashlib.sha256(self.capture).hexdigest()},
                }
            }
        }
        for name in bundle.METADATA:
            path = self.root / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(name)
        self.save()

    def save(self):
        (self.owner / "capture_catalog.json").write_text(json.dumps(self.catalog))
        (self.owner / "execution_release.json").write_text(json.dumps(self.release))

    def test_only_registered_bytes_and_dependency_records_are_included(self):
        self.assertEqual(bundle.bundle(self.root), 2)
        installed = self.owner / "_inputs"
        self.assertEqual((installed / bundle.EVIDENCE / "capture.json").read_bytes(), self.capture)
        self.assertFalse((installed / bundle.EVIDENCE / "raw-private.json").exists())
        self.assertEqual(len(list(installed.rglob("*.*"))), len(bundle.METADATA) + 2)

    def test_tampered_capture_is_rejected_before_replacing_an_existing_bundle(self):
        bundle.bundle(self.root)
        (self.root / bundle.EVIDENCE / "capture.json").write_text("changed")
        with self.assertRaisesRegex(ValueError, "differs from approved"):
            bundle.bundle(self.root)
        self.assertEqual(
            (self.owner / "_inputs" / bundle.EVIDENCE / "capture.json").read_bytes(), self.capture
        )

    def test_catalog_cannot_select_outside_evidence(self):
        self.catalog[0]["fixture"] = "../../outside.json"
        self.save()
        with self.assertRaisesRegex(ValueError, "Invalid registered"):
            bundle.bundle(self.root)

    def test_symlink_cannot_select_outside_evidence(self):
        path = self.root / bundle.EVIDENCE / "fixture.json"
        path.unlink()
        outside = self.root / "outside.json"
        outside.write_bytes(self.fixture)
        path.symlink_to(outside)
        with self.assertRaisesRegex(ValueError, "escapes evidence"):
            bundle.bundle(self.root)

    def test_later_catalog_registration_is_bundled_without_a_hardcoded_list(self):
        raw = b'{"new":true}'
        evidence = self.root / bundle.EVIDENCE
        (evidence / "new-capture.json").write_bytes(raw)
        self.catalog[0]["captures"].append({"id": "new", "path": "new-capture.json"})
        self.release["datasets"]["fixed"]["captures"]["new"] = hashlib.sha256(raw).hexdigest()
        self.save()
        self.assertEqual(bundle.bundle(self.root), 3)
        self.assertEqual(
            (self.owner / "_inputs" / bundle.EVIDENCE / "new-capture.json").read_bytes(), raw
        )


if __name__ == "__main__":
    unittest.main()
