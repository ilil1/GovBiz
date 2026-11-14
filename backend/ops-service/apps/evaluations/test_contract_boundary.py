"""Ops resolves storage explicitly; the worker's shared contracts cannot query its database."""

from unittest.mock import patch
from uuid import uuid4

from django.test import SimpleTestCase
from govbiz_evaluation_contracts import catalog as contracts
from govbiz_evaluation_contracts import execution_spec
from govbiz_evaluation_contracts.managed_materials import build_snapshot

from . import catalog
from .execution_spec import read_release


class SharedContractBoundaryTests(SimpleTestCase):
    def setUp(self):
        self.identifier = f"managed-{uuid4().hex}-v1"
        self.snapshot = build_snapshot(
            {
                "title": "관리자 평가 자료",
                "description": "저장소 경계를 확인하는 자료",
                "documents": [
                    {
                        "id": "notice",
                        "title": "지원 공고",
                        "source_url": "https://example.com/notice",
                        "chunks": ["서울 중소기업을 지원합니다."],
                    }
                ],
                "cases": [
                    {
                        "id": "Q01",
                        "document_id": "notice",
                        "question": "지원 대상은 누구인가요?",
                        "expected_status": "ANSWERED",
                        "expected_citation_orders": [0],
                        "reference_facts": ["서울 중소기업"],
                        "forbidden_claims": [],
                        "answer": {
                            "text": "서울 중소기업입니다.",
                            "status": "ANSWERED",
                            "citation_orders": [0],
                        },
                    }
                ],
            },
            self.identifier,
        )

    def test_ops_resolver_does_not_leak_into_worker_catalog_or_release(self):
        with patch.object(catalog, "_database_snapshot", return_value=self.snapshot) as resolve:
            self.assertEqual(catalog.get_dataset(self.identifier), self.snapshot["catalog"])
            self.assertIn(self.identifier, read_release(self.identifier)["datasets"])
        self.assertEqual(resolve.call_count, 2)
        with self.assertRaises(KeyError):
            contracts.get_dataset(self.identifier)
        with self.assertRaises(KeyError):
            execution_spec.read_release(self.identifier)

    def test_pinned_snapshot_takes_precedence_over_ops_database(self):
        with (
            contracts.managed_snapshot_context(self.snapshot),
            patch.object(catalog, "_database_snapshot") as resolve,
        ):
            self.assertEqual(catalog.get_dataset(self.identifier), self.snapshot["catalog"])
            self.assertEqual(contracts.get_dataset(self.identifier), self.snapshot["catalog"])
        resolve.assert_not_called()

    def test_ops_cannot_resolve_a_different_managed_revision(self):
        with patch.object(catalog, "_database_snapshot", return_value=self.snapshot):
            with self.assertRaises(KeyError):
                catalog.get_snapshot(f"managed-{uuid4().hex}-v1")
