"""Bundle only registered evaluation inputs and dependency records for installed workers."""

import argparse
import hashlib
import json
import shutil
from pathlib import Path

CONTRACTS = Path("packages/govbiz-evaluation-contracts/src/govbiz_evaluation_contracts")
EVIDENCE = Path("evaluation/support-program-evidence")
METADATA = (
    "packages/govbiz-ai-runtime/pyproject.toml",
    "packages/govbiz-evaluation-contracts/pyproject.toml",
    "evaluation/pyproject.toml",
    "pipelines/pyproject.toml",
    "pipelines/uv.lock",
)


def bundle(root):
    root = Path(root).resolve()
    owner = root / CONTRACTS
    catalog = json.loads((owner / "capture_catalog.json").read_text())
    release = json.loads((owner / "execution_release.json").read_text())
    inputs = {}
    for dataset in catalog:
        selected = release["datasets"][dataset["id"]]
        if selected["fixture_sha256"] != dataset["fixture_sha256"]:
            raise ValueError("Catalog fixture and approved release differ")
        items = [(dataset["fixture"], dataset["fixture_sha256"])]
        items.extend(
            (item["path"], selected["captures"][item["id"]]) for item in dataset["captures"]
        )
        for name, expected in items:
            path = Path(name)
            if path.is_absolute() or ".." in path.parts or path.suffix != ".json":
                raise ValueError("Invalid registered evaluation input")
            source = (root / EVIDENCE / path).resolve()
            if not source.is_relative_to((root / EVIDENCE).resolve()):
                raise ValueError("Registered evaluation input escapes evidence directory")
            raw = source.read_bytes()
            if hashlib.sha256(raw).hexdigest() != expected:
                raise ValueError("Registered evaluation input differs from approved release")
            inputs[str(EVIDENCE / path)] = raw
    inputs.update({name: (root / name).read_bytes() for name in METADATA})
    destination = owner / "_inputs"
    staged = owner / "_inputs.build"
    if staged.exists():
        shutil.rmtree(staged)
    staged.mkdir()
    try:
        for name, raw in inputs.items():
            target = staged / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(raw)
        if destination.exists():
            shutil.rmtree(destination)
        staged.rename(destination)
    finally:
        if staged.exists():
            shutil.rmtree(staged)
    return len(inputs) - len(METADATA)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[2])
    args = parser.parse_args()
    print(f"Bundled {bundle(args.root)} registered evaluation inputs; model calls: 0")


if __name__ == "__main__":
    main()
