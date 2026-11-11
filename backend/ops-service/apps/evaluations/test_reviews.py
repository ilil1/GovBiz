import json
from hashlib import sha256
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import MagicMock, patch
from uuid import uuid4

from django.conf import settings
from django.contrib.auth import get_user_model
from django.test import SimpleTestCase, TestCase, override_settings
from rest_framework.test import APIClient

from .catalog import DATASETS, LIVE_CAPTURE_ID, live_config
from .models import EvaluationBaseline, EvaluationReview, EvaluationRun, QualityAssessment
from .reviews import review_material, review_state, save_case_review
from .services import ResultsUnavailable, read_result
from .views import CaseReviewRequestSerializer


class CaseReviewCommentTests(SimpleTestCase):
    def payload(self, decision, **changes):
        return {
            "case_id": "E01",
            "decision": decision,
            "capture_sha256": "a" * 64,
            "fixture_sha256": "b" * 64,
            "rubric_version": "v1",
            "review_version": 0,
            **changes,
        }

    def test_suitable_accepts_missing_or_blank_comment_without_inventing_a_reason(self):
        for changes in ({}, {"comment": "  "}, {"comment": "확인한 내용"}):
            with self.subTest(changes=changes):
                serializer = CaseReviewRequestSerializer(data=self.payload("SUITABLE", **changes))
                self.assertTrue(serializer.is_valid(), serializer.errors)
                self.assertEqual(
                    serializer.validated_data["comment"], changes.get("comment", "").strip()
                )

    def test_unsuitable_and_deferred_require_a_nonblank_reason(self):
        for decision in ("UNSUITABLE", "DEFERRED"):
            for comment in (None, "", "  "):
                with self.subTest(decision=decision, comment=comment):
                    changes = {} if comment is None else {"comment": comment}
                    serializer = CaseReviewRequestSerializer(data=self.payload(decision, **changes))
                    self.assertFalse(serializer.is_valid())
                    self.assertIn("comment", serializer.errors)
            serializer = CaseReviewRequestSerializer(
                data=self.payload(decision, comment="확인 필요")
            )
            self.assertTrue(serializer.is_valid(), serializer.errors)

    def test_service_rejects_a_missing_reason_before_accessing_material(self):
        for decision in ("UNSUITABLE", "DEFERRED"):
            with (
                self.subTest(decision=decision),
                patch("apps.evaluations.reviews.review_material") as material,
            ):
                with self.assertRaises(ValueError):
                    save_case_review(None, None, "E01", decision, "  ", "a", "b", "v1", 0)
                material.assert_not_called()


class FixtureReviewImpactTests(SimpleTestCase):
    def test_impact_uses_dataset_assessments_and_existing_baseline(self):
        run = MagicMock()
        run.dataset_id = "sample-dataset"
        run.reviews.select_related.return_value = []
        run.case_reviews.select_related.return_value = []
        baseline = MagicMock()
        baseline.review_id = 17
        baseline.changes.select_related.return_value = []
        with (
            patch("apps.evaluations.reviews.EvaluationBaseline.objects.filter") as baseline_filter,
            patch("apps.evaluations.reviews.QualityAssessment.objects.filter") as assessment_filter,
            patch(
                "apps.evaluations.reviews.quality_state",
                return_value={"is_current": False, "status": "NOT_EVALUATED"},
            ),
        ):
            baseline_filter.return_value.first.return_value = baseline
            assessment_filter.return_value.exists.return_value = True
            impact = review_state(run)["fixture_review_impact"]
        self.assertEqual(impact, {"has_active_baseline": True, "has_quality_assessments": True})
        baseline_filter.assert_called_once_with(dataset_id="sample-dataset")
        assessment_filter.assert_called_once_with(run__dataset_id="sample-dataset")


class ReviewFixture:
    def setUp(self):
        self.user = get_user_model().objects.create_user("reviewer", email="reviewer@example.com")
        self.client = APIClient()
        self.client.force_authenticate(self.user)
        directory = TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name)
        override = override_settings(LLMOPS_RESULTS_DIR=self.root)
        override.enable()
        self.addCleanup(override.disable)
        self.dataset = "fixed-context-e01-v1"
        self.capture_id = "fixed-context-20260907-index-v1"
        self.run = self.completed_run()
        self.url = f"/api/v1/ops/evaluations/{self.run.id}"

    def completed_run(self):
        dataset = DATASETS[self.dataset]
        source = next(item for item in dataset["captures"] if item["id"] == self.capture_id)
        reference_raw = (settings.LLMOPS_EVIDENCE_DIR / source["path"]).read_bytes()
        reference_hash = sha256(reference_raw).hexdigest()
        capture = json.loads(reference_raw)
        capture.update(
            caseIds=dataset["case_ids"],
            cases=[item for item in capture["cases"] if item["caseId"] in dataset["case_ids"]],
            model=live_config(self.dataset)["model"],
            modelApiCalls=len(dataset["case_ids"]),
            maxModelCalls=len(dataset["case_ids"]),
            maxOutputTokens=2000,
        )
        run = EvaluationRun.objects.create(
            requested_by=self.user,
            dataset_id=self.dataset,
            candidate_capture_id=LIVE_CAPTURE_ID,
            reference_capture_id=self.capture_id,
            status="COMPLETED",
            prefect_flow_run_id=uuid4(),
            execution_mode="live",
            live_config=live_config(self.dataset),
        )
        folder = self.root / str(run.id)
        (folder / "capture").mkdir(parents=True)
        (folder / "evaluation").mkdir()
        raw = json.dumps(capture).encode()
        (folder / "capture/capture.json").write_bytes(raw)
        capture_hash = sha256(raw).hexdigest()
        (folder / "request.json").write_text(
            json.dumps(
                {
                    "request_id": str(run.id),
                    "dataset_id": run.dataset_id,
                    "candidate_capture_id": run.candidate_capture_id,
                    "reference_capture_id": run.reference_capture_id,
                    "prefect_flow_run_id": str(run.prefect_flow_run_id),
                    "execution_mode": run.execution_mode,
                    "live_config": run.live_config,
                }
            )
        )
        # 실제 비교 JSON은 지표만 담으며 답변은 별도 capture.json에만 있다.
        summary = {
            "completed": True,
            "caseCount": len(dataset["case_ids"]),
            "observedCaseCount": len(dataset["case_ids"]),
        }
        comparison = {
            "schema_version": 2,
            "scope": "fixed-answer-context-only",
            "retrieval_evaluated": False,
            "evaluation_run_id": "a" * 32,
            "reference_run_id": "b" * 32,
            "fixture_sha256": dataset["fixture_sha256"],
            "case_ids": dataset["case_ids"],
            "current": summary,
            "reference": summary,
            "candidate_execution": {
                "run_id": "a" * 32,
                "capture_sha256": capture_hash,
                "model": capture["model"],
            },
            "reference_execution": {"run_id": "b" * 32, "capture_sha256": reference_hash},
        }
        raw_comparison = json.dumps(comparison).encode()
        (folder / "evaluation/comparison.json").write_bytes(raw_comparison)
        (folder / "evaluation/report.html").write_bytes(b"<html>test report</html>")
        (folder / "evaluation/manifest.json").write_text(
            json.dumps(
                {
                    "status": "completed",
                    "evaluation_run_id": "a" * 32,
                    "reference_run_id": "b" * 32,
                    "model_api_calls": 0,
                    "fixture_sha256": dataset["fixture_sha256"],
                    "capture_sha256": capture_hash,
                    "reference_capture_sha256": reference_hash,
                    "artifact_sha256": {
                        "comparison.json": sha256(raw_comparison).hexdigest(),
                        "report.html": sha256(b"<html>test report</html>").hexdigest(),
                    },
                }
            )
        )
        return run

    def review(self, decision="APPROVED", url=None):
        target = url or self.url
        data = self.client.get(target + "/review").json()
        if not data["case_reviews"]:
            for case in data["material"]["cases"]:
                response = self.client.post(
                    target + "/case-review",
                    {
                        "case_id": case["case_id"],
                        "decision": "SUITABLE",
                        "comment": "근거와 조건 확인",
                        "capture_sha256": data["material"]["capture_sha256"],
                        "fixture_sha256": data["material"]["fixture_sha256"],
                        "rubric_version": data["rubric"]["version"],
                        "review_version": data["review_version"],
                    },
                    format="json",
                )
                self.assertEqual(response.status_code, 200)
                data = response.json()
        if decision == "APPROVED":
            quality = data["quality"]
            if not quality["fixture_reviews"]:
                response = self.client.post(
                    target + "/fixture-review",
                    {
                        "decision": "APPROVED",
                        "comment": "테스트 전용 참조 검토",
                        "fixture_sha256": data["material"]["fixture_sha256"],
                        "case_ids": [case["case_id"] for case in data["material"]["cases"]],
                        "rubric_version": quality["fixture_rubric_version"],
                        "fixture_version": quality["fixture_version"],
                    },
                    format="json",
                )
                self.assertEqual(response.status_code, 200)
                data = response.json()
            response = self.client.post(
                target + "/quality",
                {"input_sha256": data["quality"]["input_sha256"]},
                format="json",
            )
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json()["quality"]["status"], "PASS")
        comment = "근거·지역·법인 조건 확인 <script>실행 금지</script>"
        previous = data["reviews"][0] if data["reviews"] else None
        retry = previous and previous["decision"] == decision and previous["comment"] == comment
        return self.client.post(
            target + "/review",
            {
                "decision": decision,
                "comment": comment,
                "capture_sha256": data["material"]["capture_sha256"],
                "fixture_sha256": data["material"]["fixture_sha256"],
                "rubric_version": data["rubric"]["version"],
                "review_version": data["review_version"] - (1 if retry else 0),
            },
            format="json",
        )

    def promote(self):
        review = self.review().json()["reviews"][0]
        response = self.client.post(
            self.url + "/baseline",
            {
                "review_id": review["id"],
                "baseline_version": self.client.get(self.url + "/review").json()[
                    "baseline_version"
                ],
            },
            format="json",
        )
        self.assertEqual(response.status_code, 200)
        return review


class ReviewTests(ReviewFixture, TestCase):
    def test_suitable_without_reason_is_saved_and_retry_preserves_the_same_record(self):
        data = self.client.get(self.url + "/review").json()
        payload = {
            "case_id": data["material"]["cases"][0]["case_id"],
            "decision": "SUITABLE",
            "capture_sha256": data["material"]["capture_sha256"],
            "fixture_sha256": data["material"]["fixture_sha256"],
            "rubric_version": data["rubric"]["version"],
            "review_version": data["review_version"],
        }
        for decision in ("UNSUITABLE", "DEFERRED"):
            response = self.client.post(
                self.url + "/case-review", {**payload, "decision": decision}, format="json"
            )
            self.assertEqual(response.status_code, 400)
        response = self.client.post(self.url + "/case-review", payload, format="json")
        self.assertEqual(response.status_code, 200)
        record = response.json()["case_reviews"][0]
        self.assertEqual(record["comment"], "")
        self.assertEqual(record["reviewed_by"], self.user.email)
        retry = self.client.post(self.url + "/case-review", payload, format="json")
        self.assertEqual(retry.status_code, 200)
        self.assertEqual([item["id"] for item in retry.json()["case_reviews"]], [record["id"]])

    def test_fixture_review_impact_covers_other_runs_and_cleared_baseline(self):
        other_dataset = EvaluationRun.objects.create(requested_by=self.user, dataset_id="other")
        assessment_fields = {
            "policy": {},
            "policy_sha256": "a" * 64,
            "inputs": {},
            "input_sha256": "b" * 64,
            "status": "NEEDS_REVIEW",
            "reasons": [],
            "assessed_by": self.user,
        }
        QualityAssessment.objects.create(run=other_dataset, **assessment_fields)
        response = self.client.get(self.url + "/review")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.json()["fixture_review_impact"],
            {"has_active_baseline": False, "has_quality_assessments": False},
        )

        other = EvaluationRun.objects.create(requested_by=self.user, dataset_id=self.dataset)
        QualityAssessment.objects.create(run=other, **assessment_fields)
        review = EvaluationReview.objects.create(
            run=other,
            decision="APPROVED",
            comment="확인",
            capture_sha256="c" * 64,
            reviewed_by=self.user,
        )
        baseline = EvaluationBaseline.objects.create(
            dataset_id=self.dataset, version=1, review=review
        )
        response = self.client.get(self.url + "/review")
        self.assertFalse(response.json()["is_baseline"])
        self.assertEqual(
            response.json()["fixture_review_impact"],
            {"has_active_baseline": True, "has_quality_assessments": True},
        )

        baseline.review = None
        baseline.save(update_fields=["review"])
        response = self.client.get(self.url + "/review")
        self.assertEqual(
            response.json()["fixture_review_impact"],
            {"has_active_baseline": False, "has_quality_assessments": True},
        )

    def test_material_review_history_and_baseline_are_separate(self):
        data = self.client.get(self.url + "/review").json()
        self.assertEqual([item["case_id"] for item in data["material"]["cases"]], ["E01"])
        self.assertEqual(len(data["material"]["cases"][0]["evidence"]), 3)
        self.assertEqual(data["material"]["cases"][0]["cited_orders"], [0])
        self.assertEqual(data["reviews"], [])
        self.assertEqual(
            self.client.post(
                self.url + "/baseline", {"review_id": 1, "baseline_version": 0}, format="json"
            ).status_code,
            409,
        )
        first = self.review().json()["reviews"][0]
        self.assertFalse(EvaluationBaseline.objects.filter(review__isnull=False).exists())
        self.assertEqual(self.review().json()["reviews"][0]["id"], first["id"])
        self.promote()
        session = self.client.get("/api/v1/ops/evaluation-catalog").json()
        selected = next(item for item in session["datasets"] if item["id"] == self.dataset)
        self.assertEqual(selected["baseline"]["id"], f"run:{self.run.id}")
        response = self.review("CHANGES_REQUESTED")
        self.assertFalse(response.json()["is_baseline"])
        self.assertEqual(len(response.json()["reviews"]), 2)
        self.assertEqual(
            self.client.post(
                self.url + "/baseline",
                {"review_id": first["id"], "baseline_version": 0},
                format="json",
            ).status_code,
            409,
        )
        self.assertEqual(EvaluationReview.objects.count(), 2)

    @patch("apps.evaluations.prefect_client.create_run")
    def test_reference_is_pinned_and_retry_survives_baseline_revocation(self, create):
        create.return_value = uuid4()
        self.promote()
        datasets = self.client.get("/api/v1/ops/evaluation-catalog").json()["datasets"]
        profile = next(item for item in datasets if item["id"] == self.dataset)[
            "execution_profiles"
        ]["replay"]
        payload = {
            "request_id": str(uuid4()),
            "dataset_id": self.dataset,
            "candidate_capture_id": self.capture_id,
            "reference_capture_id": f"run:{self.run.id}",
            "baseline_version": 1,
            "execution_profile": profile,
        }
        response = self.client.post("/api/v1/ops/evaluations", payload, format="json")
        self.assertEqual(response.status_code, 202)
        accepted = EvaluationRun.objects.get(pk=payload["request_id"])
        original_spec = accepted.execution_spec
        original_sha = accepted.execution_spec_sha256
        self.assertEqual(original_spec["profile_sha256"], profile)
        self.assertEqual(accepted.reference_config["run_id"], str(self.run.id))
        self.assertEqual(
            accepted.reference_config["capture_sha256"], review_material(self.run)["capture_sha256"]
        )
        self.review("CHANGES_REQUESTED")
        self.assertEqual(
            self.client.post("/api/v1/ops/evaluations", payload, format="json").status_code, 200
        )
        self.assertEqual(create.call_count, 1)
        accepted.refresh_from_db()
        self.assertEqual(accepted.execution_spec, original_spec)
        self.assertEqual(accepted.execution_spec_sha256, original_sha)
        payload["request_id"] = str(uuid4())
        self.assertEqual(
            self.client.post("/api/v1/ops/evaluations", payload, format="json").status_code, 400
        )

    def test_invalid_or_incomplete_material_cannot_be_reviewed_or_promoted(self):
        material = review_material(self.run)
        self.assertEqual(
            self.client.post(
                self.url + "/review",
                {
                    "decision": "APPROVED",
                    "comment": "검토",
                    "capture_sha256": "0" * 64,
                    "fixture_sha256": material["fixture_sha256"],
                    "rubric_version": "evidence-review-v1",
                    "review_version": 0,
                },
                format="json",
            ).status_code,
            409,
        )
        self.assertEqual(
            self.client.post(
                self.url + "/review",
                {
                    "decision": "APPROVED",
                    "comment": " ",
                    "capture_sha256": material["capture_sha256"],
                },
                format="json",
            ).status_code,
            400,
        )
        review = self.promote()
        capture = self.root / str(self.run.id) / "capture/capture.json"
        capture.write_text(capture.read_text() + " ")
        self.assertIsNone(self.client.get(self.url + "/review").json()["material"])
        self.assertEqual(
            self.client.post(
                self.url + "/baseline",
                {
                    "review_id": review["id"],
                    "baseline_version": self.client.get(self.url + "/review").json()[
                        "baseline_version"
                    ],
                },
                format="json",
            ).status_code,
            503,
        )
        self.run.status = "FAILED"
        self.run.save()
        with self.assertRaises(ResultsUnavailable):
            review_material(self.run)

    @patch("apps.evaluations.prefect_client.create_run")
    def test_cross_dataset_and_unapproved_references_do_not_dispatch(self, create):
        payload = {
            "request_id": str(uuid4()),
            "dataset_id": self.dataset,
            "candidate_capture_id": self.capture_id,
            "reference_capture_id": f"run:{self.run.id}",
            "baseline_version": 1,
        }
        self.assertEqual(
            self.client.post("/api/v1/ops/evaluations", payload, format="json").status_code, 400
        )
        self.promote()
        payload.update(
            dataset_id="target-coverage-20260907-v1",
            candidate_capture_id="target-coverage-20260907-v1",
        )
        self.assertEqual(
            self.client.post("/api/v1/ops/evaluations", payload, format="json").status_code, 400
        )
        create.assert_not_called()

    def test_pinned_reference_must_match_result_and_request_marker(self):
        self.run.reference_capture_id = f"run:{uuid4()}"
        self.run.reference_config = {
            "run_id": self.run.reference_capture_id[4:],
            "capture_sha256": "e" * 64,
            "fixture_sha256": DATASETS[self.dataset]["fixture_sha256"],
        }
        marker = self.root / str(self.run.id) / "request.json"
        data = json.loads(marker.read_text())
        data.update(
            reference_capture_id=self.run.reference_capture_id,
            reference_config=self.run.reference_config,
        )
        marker.write_text(json.dumps(data))
        with self.assertRaises(ResultsUnavailable):
            read_result(self.run)

    def test_review_reads_pinned_reference_snapshot_and_rejects_its_tampering(self):
        source = DATASETS[self.dataset]["captures"][1]
        raw = (settings.LLMOPS_EVIDENCE_DIR / source["path"]).read_bytes()
        self.run.reference_capture_id = f"run:{uuid4()}"
        self.run.reference_config = {
            "run_id": self.run.reference_capture_id[4:],
            "capture_sha256": sha256(raw).hexdigest(),
            "fixture_sha256": DATASETS[self.dataset]["fixture_sha256"],
        }
        folder = self.root / str(self.run.id)
        marker = json.loads((folder / "request.json").read_text())
        marker.update(
            reference_capture_id=self.run.reference_capture_id,
            reference_config=self.run.reference_config,
        )
        (folder / "request.json").write_text(json.dumps(marker))
        snapshot = folder / "reference-capture.json"
        snapshot.write_bytes(raw)
        self.assertEqual(
            review_material(self.run)["cases"][0]["reference_answer"],
            json.loads(raw)["cases"][0]["response"]["answer"],
        )
        snapshot.write_bytes(raw + b" ")
        with self.assertRaises(ResultsUnavailable):
            review_material(self.run)

    def test_admin_and_csrf_required_for_reviews_and_baselines(self):
        client = APIClient(enforce_csrf_checks=True)
        self.assertEqual(client.get(self.url + "/review").status_code, 401)
        with patch(
            "apps.evaluations.authentication.read_core_admin",
            return_value={
                "accountId": 99,
                "email": "admin@example.com",
                "role": "ADMIN",
            },
        ):
            client.cookies["govbiz_session"] = "test-session"
            self.assertEqual(client.post(self.url + "/review", {}, format="json").status_code, 403)
            self.assertEqual(
                client.post(self.url + "/baseline", {}, format="json").status_code, 403
            )
