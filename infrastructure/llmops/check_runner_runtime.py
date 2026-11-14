"""Verify a built runner's tokenizer and accepted RAG plans without model calls."""

import argparse
import json
from pathlib import Path
from unittest.mock import patch


def verify(root=None):
    from govbiz_evaluation import rag_live
    import tiktoken
    import tiktoken.registry
    from govbiz_evaluation_contracts.catalog import DATASETS, RAG_SCOPE, live_config
    from govbiz_evaluation_contracts.execution_spec import build_release, read_release

    from govbiz_evaluation_contracts.resources import evidence_root

    release = read_release()
    if release != build_release(root):
        raise ValueError("Runner release differs from accepted source")
    checked = {}
    # A warm process cache must not hide absent/corrupt tokenizer files.
    # Preserve the real tiktoken cache lookup and checksum; forbid its download fallback.
    with (
        patch.dict(tiktoken.registry.ENCODINGS, {}, clear=True),
        patch(
            "tiktoken.load.read_file",
            side_effect=OSError("Tokenizer data must be bundled in the image"),
        ),
    ):
        encoding = tiktoken.get_encoding("cl100k_base")
        text = "격리 실행기 토크나이저 검증"
        if encoding.decode(encoding.encode_ordinary(text)) != text:
            raise ValueError("Runner tokenizer round trip differs")
        for identifier, dataset in DATASETS.items():
            if dataset.get("evaluation_scope") != RAG_SCOPE:
                continue
            config = live_config(identifier)
            if config is None:
                continue
            _, fingerprint, plan = rag_live.prepare(
                evidence_root(root) / dataset["fixture"],
                model=config["model"],
            )
            accepted = release["datasets"][identifier]["live_plan"]
            if (
                fingerprint != accepted["fixture_sha256"]
                or [case["case_id"] for case in plan["rag_cases"]]
                != accepted["case_ids"]
                or plan["model_operations"] != accepted["model_operations"]
                or plan["live_config"] != accepted["live_config"]
            ):
                raise ValueError("Runner RAG preparation differs from accepted plan")
            checked[identifier] = len(plan["model_operations"])
    if not checked:
        raise ValueError("No RAG call plans were checked")
    return {
        "status": "PASS",
        "tokenizer": encoding.name,
        "datasets": checked,
        "model_api_calls": 0,
        "evaluation_executed": False,
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path)
    args = parser.parse_args()
    print(json.dumps(verify(args.root), ensure_ascii=False))
