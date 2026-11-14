"""Exercise real tokenizer cache loading and RAG preparation without model APIs."""

import copy
import hashlib
from pathlib import Path

import pytest
import tiktoken.load

ROOT = Path(__file__).resolve().parents[2]

import check_runner_runtime as check
from govbiz_evaluation import rag_live
from govbiz_evaluation_contracts import catalog, execution_spec

BLOB = "https://openaipublic.blob.core.windows.net/encodings/cl100k_base.tiktoken"
CHECKSUM = "223921b76ee99bde995b7ff738513eef100fb51d18c93597a113bcffe865b2a7"


@pytest.fixture(scope="module")
def tokenizer_bytes():
    # Same public resource/checksum as pinned tiktoken, never an API/model call.
    return tiktoken.load.read_file_cached(BLOB, expected_hash=CHECKSUM)


@pytest.fixture
def cache(monkeypatch, tmp_path, tokenizer_bytes):
    monkeypatch.setenv("TIKTOKEN_CACHE_DIR", str(tmp_path))
    path = tmp_path / hashlib.sha1(BLOB.encode()).hexdigest()
    path.write_bytes(tokenizer_bytes)
    return path


def test_real_cached_tokenizer_and_catalog_plans_pass(cache):
    result = check.verify(ROOT)
    assert result["status"] == "PASS"
    assert result["tokenizer"] == "cl100k_base"
    assert result["datasets"]["rag-synthetic-multichunk-v1"] == 9
    assert result["model_api_calls"] == 0 and result["evaluation_executed"] is False


def test_installed_runner_prepares_packaged_inputs_outside_checkout(cache, monkeypatch, tmp_path):
    monkeypatch.chdir(tmp_path)
    result = check.verify()
    assert result["status"] == "PASS"
    assert result["datasets"]["rag-synthetic-multichunk-v1"] == 9
    assert result["model_api_calls"] == 0


@pytest.mark.parametrize("corrupt", [False, True])
def test_absent_or_corrupt_disk_cache_cannot_be_hidden_by_warm_memory(cache, corrupt):
    tiktoken.get_encoding("cl100k_base")
    if corrupt:
        cache.write_bytes(b"invalid-cache")
    else:
        cache.unlink()
    with pytest.raises(OSError, match="must be bundled"):
        check.verify(ROOT)


def test_actual_token_budget_drift_is_rejected(cache, monkeypatch):
    prepare = rag_live.prepare

    def changed(*args, **kwargs):
        fixture, fingerprint, plan = prepare(*args, **kwargs)
        plan["model_operations"][0]["max_input_tokens"] += 1
        return fixture, fingerprint, plan

    monkeypatch.setattr(rag_live, "prepare", changed)
    with pytest.raises(ValueError, match="accepted plan"):
        check.verify(ROOT)


def test_release_drift_is_rejected_before_loading_tokenizer(cache, monkeypatch):
    altered = copy.deepcopy(execution_spec.read_release())
    altered["schema_version"] = 999
    monkeypatch.setattr(execution_spec, "read_release", lambda: altered)
    cache.unlink()
    with pytest.raises(ValueError, match="accepted source"):
        check.verify(ROOT)


def test_missing_rag_dataset_cannot_pass(cache, monkeypatch):
    monkeypatch.setattr(catalog, "DATASETS", {})
    with pytest.raises(ValueError, match="No RAG call plans"):
        check.verify(ROOT)
