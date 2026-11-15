"""Resolve stable evidence identifiers to checkout or installed package bytes."""

from importlib.util import find_spec
from pathlib import Path, PurePosixPath

AI = "backend/ai-service/app/"
OPS = "backend/ops-service/apps/evaluations/"
EVIDENCE = "evaluation/support-program-evidence/"
DATASETS = "pipelines/evals/support_program_evidence/datasets/"
PRIOR_DATASETS = "pipelines/evals/datasets/"
PIPELINE_EVALUATION = "pipelines/evaluation/"
FLOW_EVALUATION = "pipelines/flows/support_program_evidence/"
PRIOR_FLOW_EVALUATION = "pipelines/flows/evaluation/"
PIPELINE_COMPAT = "pipelines/_compat/evaluation/"
PIPELINE_MODULES = frozenset({"__init__.py", "flows.py", "capture.py", "rag.py", "tasks.py", "clients.py"})
ENGINE_SOURCE = "pipelines/evals/support_program_evidence/"
PRIOR_ENGINE_SOURCE = "pipelines/evals/govbiz_evaluation/"
ENGINE_METADATA = "pipelines/evals/pyproject.toml"
PREVIOUS_ENGINE_SOURCE = "pipelines/evaluation_engine/govbiz_evaluation/"
PREVIOUS_ENGINE_METADATA = "pipelines/evaluation_engine/pyproject.toml"
LEGACY_ENGINE_METADATA = "evaluation/pyproject.toml"
ENGINE_PACKAGES = ("evaluators", "reports", "integrations", "preparation")
# Stored execution specs and historical captures use these logical identifiers.
# Keep them stable while resolving to the actual relocated implementation bytes.
EVALUATION_MODULES = {
    **{name + ".py": "evaluators/" + name + ".py" for name in ("evaluate", "rag_evaluate")},
    **{name + ".py": "reports/" + name + ".py" for name in ("reporting", "rag_reporting")},
    **{name + ".py": "integrations/" + name + ".py" for name in (
        "budget_client", "embedding_budget", "rag_budget", "rag_live"
    )},
    **{name + ".py": "preparation/" + name + ".py" for name in (
        "verify_flow", "official_snapshot", "official_rag", "revise_official_reference", "core_flow_rag"
    )},
}
# Legacy wrapper identifiers remain resolvable when inspecting a historical
# checkout that still contains them. New releases do not ship or hash them.
COMPAT_MODULES = frozenset({
    "evaluate.py", "rag_evaluate.py", "reporting.py", "rag_reporting.py",
    "budget_client.py", "embedding_budget.py", "rag_budget.py", "rag_live.py",
    "verify_flow.py", "official_snapshot.py", "official_rag.py",
})
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
        elif name == LEGACY_ENGINE_METADATA:
            # The identifier is part of saved execution manifests; the bytes
            # now come from the colocated engine's packaging configuration.
            mapped = ENGINE_METADATA
        elif name.startswith(PIPELINE_COMPAT):
            relative = name.removeprefix(PIPELINE_COMPAT)
            if relative not in PIPELINE_MODULES:
                raise ValueError("Unknown pipeline compatibility resource")
            mapped = PIPELINE_EVALUATION + relative
        elif name.startswith((PIPELINE_EVALUATION, PRIOR_FLOW_EVALUATION)):
            prefix = PIPELINE_EVALUATION if name.startswith(PIPELINE_EVALUATION) else PRIOR_FLOW_EVALUATION
            relative = name.removeprefix(prefix)
            if relative in PIPELINE_MODULES:
                mapped = FLOW_EVALUATION + relative
        elif name.startswith(PRIOR_DATASETS):
            mapped = DATASETS + name.removeprefix(PRIOR_DATASETS)
        elif name.startswith(EVIDENCE):
            relative = name.removeprefix(EVIDENCE)
            if relative.startswith("_compat/"):
                flat = relative.removeprefix("_compat/")
                if flat not in COMPAT_MODULES:
                    raise ValueError("Unknown evaluation compatibility resource")
                mapped = ENGINE_SOURCE + flat
            elif relative in EVALUATION_MODULES:
                mapped = ENGINE_SOURCE + EVALUATION_MODULES[relative]
            elif relative == "__init__.py" or relative in {
                part + "/__init__.py" for part in ENGINE_PACKAGES
            }:
                mapped = ENGINE_SOURCE + relative
            else:
                mapped = DATASETS + relative
        candidate = root / mapped
        # Also supports historical checkout fixtures used to verify older releases.
        if mapped != name and not candidate.exists():
            if name.startswith(PIPELINE_COMPAT):
                raise FileNotFoundError(f"Pipeline compatibility module is missing: {mapped}")
            if name.startswith((PIPELINE_EVALUATION, PRIOR_FLOW_EVALUATION)) and mapped.startswith(FLOW_EVALUATION):
                # New layouts must never use stale historical modules when a
                # current flow file is missing. Old checkouts remain inspectable.
                config = root / "pipelines/pyproject.toml"
                adopted = config.is_file() and '"pipelines.flows.support_program_evidence"' in config.read_text()
                if (root / FLOW_EVALUATION).is_dir() or adopted:
                    raise FileNotFoundError(f"Pipeline flow implementation is missing: {mapped}")
                previous = root / PRIOR_FLOW_EVALUATION / mapped.removeprefix(FLOW_EVALUATION)
                if (root / PRIOR_FLOW_EVALUATION).is_dir():
                    if not previous.is_file():
                        raise FileNotFoundError(f"Pipeline flow implementation is missing: {previous}")
                    candidate = previous
                elif (root / "pipelines/flows").is_dir():
                    raise FileNotFoundError(f"Pipeline flow implementation is missing: {mapped}")
                elif name.startswith(PIPELINE_EVALUATION):
                    candidate = root / name
                else:
                    raise FileNotFoundError(f"Pipeline flow implementation is missing: {mapped}")
            # An old flat checkout may still be inspected, but do not let a
            # leftover flat module stand in for missing installed code in a
            # checkout that has already adopted the new package layout.
            elif mapped.startswith(DATASETS):
                # Once the new data directory exists, do not replace missing
                # files with stale historical copies.
                if (root / DATASETS).is_dir() or (root / ENGINE_SOURCE).is_dir():
                    raise FileNotFoundError(f"Evaluation data is missing: {mapped}")
                previous = root / PRIOR_DATASETS / mapped.removeprefix(DATASETS)
                if (root / PRIOR_DATASETS).is_dir():
                    if not previous.is_file():
                        raise FileNotFoundError(f"Evaluation data is missing: {previous}")
                    candidate = previous
                elif (root / EVIDENCE).is_dir():
                    candidate = root / EVIDENCE / mapped.removeprefix(DATASETS)
                else:
                    raise FileNotFoundError(f"Evaluation data is missing: {mapped}")
            elif mapped.startswith(ENGINE_SOURCE) or name == LEGACY_ENGINE_METADATA:
                # New and previous colocated packages cannot silently fall back
                # to stale files when their current implementation is missing.
                if (root / ENGINE_SOURCE).is_dir():
                    raise FileNotFoundError(f"Evaluation implementation is missing: {mapped}")
                prior = root / PRIOR_ENGINE_SOURCE
                if prior.is_dir():
                    if name == LEGACY_ENGINE_METADATA:
                        raise FileNotFoundError(f"Evaluation implementation is missing: {mapped}")
                    candidate = prior / mapped.removeprefix(ENGINE_SOURCE)
                    if not candidate.is_file():
                        raise FileNotFoundError(f"Evaluation implementation is missing: {candidate}")
                elif (root / ENGINE_METADATA).parent.is_dir():
                    raise FileNotFoundError(f"Evaluation implementation is missing: {mapped}")
                if not prior.is_dir():
                    # The immediately preceding colocated layout has its own
                    # source tree. Resolve its real files before older layouts;
                    # do not accept stale wrappers when that tree is incomplete.
                    previous_layout = (root / PREVIOUS_ENGINE_METADATA).parent.is_dir() or (root / PREVIOUS_ENGINE_SOURCE).is_dir()
                    if previous_layout:
                        previous = (PREVIOUS_ENGINE_METADATA if name == LEGACY_ENGINE_METADATA
                                    else PREVIOUS_ENGINE_SOURCE + mapped.removeprefix(ENGINE_SOURCE))
                        candidate = root / previous
                        if not candidate.is_file():
                            raise FileNotFoundError(f"Evaluation implementation is missing: {previous}")
                    else:
                        relative = name.removeprefix(EVIDENCE)
                        if relative.startswith("_compat/"):
                            legacy = relative.removeprefix("_compat/")
                        else:
                            legacy = EVALUATION_MODULES.get(relative, relative)
                        if name == LEGACY_ENGINE_METADATA:
                            candidate = root / name
                        else:
                            candidate = root / EVIDENCE / legacy
                            if not candidate.exists() and relative in EVALUATION_MODULES:
                                # Support checkouts predating the role directories.
                                if any((root / EVIDENCE / part).is_dir() for part in ENGINE_PACKAGES):
                                    raise FileNotFoundError(f"Evaluation implementation is missing: {mapped}")
                                candidate = root / name
            else:
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
        relative = name.removeprefix(EVIDENCE)
        if relative.startswith("_compat/"):
            flat = relative.removeprefix("_compat/")
            if flat not in COMPAT_MODULES:
                raise ValueError("Unknown evaluation compatibility resource")
            return _package("support_program_evidence") / flat
        return _package("support_program_evidence") / EVALUATION_MODULES.get(relative, relative)
    if name.startswith((DATASETS, PRIOR_DATASETS)):
        # Installed bundles retain the historical identifier for both current
        # and previous repository data paths.
        prefix = DATASETS if name.startswith(DATASETS) else PRIOR_DATASETS
        return Path(__file__).parent / "_inputs" / EVIDENCE / name.removeprefix(prefix)
    if name.startswith(PIPELINE_COMPAT):
        relative = name.removeprefix(PIPELINE_COMPAT)
        if relative not in PIPELINE_MODULES:
            raise ValueError("Unknown pipeline compatibility resource")
        return _package("pipelines") / "evaluation" / relative
    if name.startswith((PIPELINE_EVALUATION, PRIOR_FLOW_EVALUATION)):
        prefix = PIPELINE_EVALUATION if name.startswith(PIPELINE_EVALUATION) else PRIOR_FLOW_EVALUATION
        relative = name.removeprefix(prefix)
        if relative in PIPELINE_MODULES:
            return _package("pipelines") / "flows" / "support_program_evidence" / relative
    if name.startswith("pipelines/") and name.endswith(".py"):
        return _package("pipelines") / name.removeprefix("pipelines/")
    return Path(__file__).parent / "_inputs" / name


def evidence_root(root=None):
    if root is None:
        return Path(__file__).parent / "_inputs" / EVIDENCE
    root = Path(root)
    current = root / DATASETS
    prior = root / PRIOR_DATASETS
    legacy = root / EVIDENCE
    if current.is_dir() or (root / ENGINE_SOURCE).is_dir():
        return current
    return prior if prior.is_dir() else legacy if legacy.is_dir() else current
