"""Resolve stable evidence identifiers to checkout or installed package bytes."""

from importlib.util import find_spec
from pathlib import Path, PurePosixPath

AI = "backend/ai-service/app/"
OPS = "backend/ops-service/apps/evaluations/"
EVIDENCE = "evaluation/support-program-evidence/"
CONTRACTS_SOURCE = "packages/govbiz-evaluation-contracts/src/govbiz_evaluation_contracts/"
RUNTIME_SOURCE = "packages/govbiz-ai-runtime/src/govbiz_ai_runtime/"
CONTRACT_MODULES = frozenset(
    {
        "catalog.py",
        "execution_spec.py",
        "managed_materials.py",
        "rag_replay.py",
        "quality_policy.py",
        "artifact_files.py",
        "recovery_inputs.py",
        "vector_cache.py",
        "capture_catalog.json",
        "rag_live_plans.json",
        "execution_release.json",
    }
)


def _relative(name):
    path = PurePosixPath(name)
    if not name or path.is_absolute() or ".." in path.parts or "\\" in name:
        raise ValueError("Invalid evidence resource identifier")
    return path


def _package(name):
    spec = find_spec(name)
    if spec is None or spec.origin is None:
        raise ModuleNotFoundError(f"Required evaluation package is not installed: {name}")
    return Path(spec.origin).resolve().parent


def source_path(name, root=None):
    """Logical IDs remain stable in saved evidence; source locations may change."""
    name = str(_relative(name))
    if root is not None:
        root = Path(root).resolve()
        mapped = name
        if name.startswith(AI):
            mapped = RUNTIME_SOURCE + name.removeprefix(AI)
        elif name.startswith(OPS) and name.removeprefix(OPS) in CONTRACT_MODULES:
            mapped = CONTRACTS_SOURCE + name.removeprefix(OPS)
        candidate = root / mapped
        # Also supports historical checkout fixtures used to verify older releases.
        if mapped != name and not candidate.exists():
            candidate = root / name
        if not candidate.resolve().is_relative_to(root):
            raise ValueError("Evidence resource escapes repository")
        return candidate
    if name.startswith(AI):
        return _package("govbiz_ai_runtime") / name.removeprefix(AI)
    if name.startswith(OPS) and name.removeprefix(OPS) in CONTRACT_MODULES:
        return Path(__file__).parent / name.removeprefix(OPS)
    if name.startswith(CONTRACTS_SOURCE):
        return Path(__file__).parent / name.removeprefix(CONTRACTS_SOURCE)
    if name.startswith(RUNTIME_SOURCE):
        return _package("govbiz_ai_runtime") / name.removeprefix(RUNTIME_SOURCE)
    if name.startswith(EVIDENCE) and name.endswith(".py"):
        return _package("govbiz_evaluation") / name.removeprefix(EVIDENCE)
    if name.startswith("pipelines/") and name.endswith(".py"):
        return _package("pipelines") / name.removeprefix("pipelines/")
    return Path(__file__).parent / "_inputs" / name


def evidence_root(root=None):
    return (
        Path(root) / EVIDENCE if root is not None else Path(__file__).parent / "_inputs" / EVIDENCE
    )
