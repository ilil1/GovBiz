"""Exercise installed worker packages from outside the repository, without model calls."""

import importlib.abc
import json
import os
import sys
import tempfile
from pathlib import Path


class RejectServiceImports(importlib.abc.MetaPathFinder):
    def find_spec(self, fullname, path=None, target=None):
        if fullname.split(".", 1)[0] in {"app", "apps", "django"}:
            raise AssertionError("Worker imported a backend service: " + fullname)
        return None


def main():
    sys.meta_path.insert(0, RejectServiceImports())
    from govbiz_evaluation_contracts.execution_spec import build_release, read_release
    from govbiz_evaluation_contracts.resources import evidence_root

    from pipelines import serve
    from pipelines.evaluation import tasks

    actual = build_release()
    if actual != read_release():
        raise ValueError("Installed code or resources differ from the accepted release")
    evidence = evidence_root()
    current = tasks.prepare.fn(
        str(evidence / "target-coverage-fixture.json"),
        str(evidence / "runs/target-coverage-20260907-v1/capture.json"),
    )
    assert current["summary"]["completed"]
    with tempfile.TemporaryDirectory(prefix="govbiz-installed-report-") as temporary:
        report = tasks.render.fn(current, current, temporary)
        assert (Path(temporary) / "report.html").is_file()
        assert report["artifact_sha256"]
    # Inspect the registration boundary without starting Prefect or a web server.
    registration = {}
    serve.evaluate_saved_capture.serve = lambda **options: registration.update(options)
    serve.main()
    assert registration["name"] == "saved-capture" and registration["limit"] == 1
    assert registration["entrypoint_type"].value == "module_path"
    assert not any(name.split(".", 1)[0] in {"app", "apps", "django"} for name in sys.modules)
    print(
        json.dumps(
            {
                "status": "PASS",
                "installed_release_verified": True,
                "cases": len(current["frame"]),
                "report_created": True,
                "model_api_calls": 0,
                "deployment": "govbiz-ops-evidence-evaluation/saved-capture",
            }
        )
    )


if __name__ == "__main__":
    os.environ["DO_NOT_TRACK"] = "1"
    main()
