from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import patch

from django.test import SimpleTestCase
from rest_framework.test import APIRequestFactory, force_authenticate

from .model_trace_metrics import read_model_metrics
from .trace_client import LangfuseUnavailable
from .trace_views import api_model_trace_metrics

NOW = datetime(2026, 10, 14, 2, tzinfo=UTC)


def row(identifier, **changes):
    return {
        "id": identifier,
        "traceId": "a" * 32,
        "name": "search.ranking.model",
        "type": "GENERATION",
        "startTime": "2026-10-14T01:00:00Z",
        "endTime": "2026-10-14T01:00:01Z",
        "level": "DEFAULT",
        "latency": 1.0,
        "environment": "development",
        "model": "gpt-example",
        "metadata": {"outcome": "completed"},
    } | changes


class ModelTraceMetricsTests(SimpleTestCase):
    @patch("apps.evaluations.model_trace_metrics.read_page")
    def test_only_observed_model_generations_and_safe_summary(self, read_page):
        read_page.side_effect = [
            (
                [
                    row("1", latency=2.0, input="secret prompt"),
                    row("2", level="ERROR", latency=9.0, metadata={"outcome": "timeout"}),
                    row("3", level="ERROR", latency=None, metadata=None),
                    row("4", endTime=None, level="ERROR"),
                    row("5", environment="production"),
                ],
                None,
            ),
            ([], None),
            ([], None),
        ]
        result = read_model_metrics(
            from_time=NOW - timedelta(days=1), to_time=NOW, environment="development"
        )
        self.assertEqual(
            result,
            [
                {
                    "feature": "search.ranking.model",
                    "model": "gpt-example",
                    "observed": 4,
                    "completed": 3,
                    "errors": 2,
                    "warnings": 0,
                    "timeouts": 1,
                    "timeout_unknown": 1,
                    "in_progress": 1,
                    "latency_samples": 2,
                    "missing_latency": 1,
                    "p50_seconds": 2.0,
                    "p95_seconds": 9.0,
                }
            ],
        )
        self.assertNotIn("secret prompt", str(result))

    @patch("apps.evaluations.model_trace_metrics.read_page")
    def test_missing_model_and_environment_remain_unknown(self, read_page):
        read_page.side_effect = [
            ([row("1", model=None, environment=None)], None),
            ([], None),
            ([], None),
        ]
        result = read_model_metrics(
            from_time=NOW - timedelta(days=1), to_time=NOW, environment="unknown"
        )
        self.assertIsNone(result[0]["model"])
        self.assertEqual(result[0]["observed"], 1)

    @patch("apps.evaluations.model_trace_metrics.read_page")
    def test_rejects_incomplete_or_duplicate_pages_including_excluded_environment(self, read_page):
        read_page.side_effect = [([], "c1"), ([], "c2"), ([], "c3")]
        with self.assertRaises(LangfuseUnavailable):
            read_model_metrics(from_time=NOW - timedelta(days=1), to_time=NOW)
        sample = row("1", environment="development")
        read_page.side_effect = [([sample], "c1"), ([sample], None)]
        with self.assertRaises(LangfuseUnavailable):
            read_model_metrics(
                from_time=NOW - timedelta(days=1), to_time=NOW, environment="production"
            )

    @patch("apps.evaluations.model_trace_metrics.read_page")
    def test_rejects_unexpected_type_name_time_model_and_outcome(self, read_page):
        for sample in (
            row("1", type="SPAN"),
            row("1", name="other.model"),
            row("1", startTime="2026-10-15T01:00:00Z"),
            row("1", level=None),
            row("1", model="private text"),
            row("1", metadata={"outcome": ["timeout"]}),
        ):
            with self.subTest(sample=sample):
                read_page.return_value = ([sample], None)
                with self.assertRaises(LangfuseUnavailable):
                    read_model_metrics(from_time=NOW - timedelta(days=1), to_time=NOW)

    def test_admin_only_and_invalid_environment(self):
        factory = APIRequestFactory()
        self.assertIn(
            api_model_trace_metrics(factory.get("/api/v1/ops/model-trace-metrics")).status_code,
            (401, 403),
        )
        request = factory.get("/api/v1/ops/model-trace-metrics?environment=invalid")
        force_authenticate(request, user=SimpleNamespace(is_authenticated=True))
        self.assertEqual(api_model_trace_metrics(request).status_code, 400)

    @patch("apps.evaluations.trace_views.read_model_metrics", return_value=[])
    def test_api_returns_explicit_scope_and_environment(self, read):
        request = APIRequestFactory().get("/api/v1/ops/model-trace-metrics?environment=production")
        force_authenticate(request, user=SimpleNamespace(is_authenticated=True))
        response = api_model_trace_metrics(request)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["scope"], "observed-model-generations")
        self.assertEqual(response.data["environment"], "production")
        self.assertEqual(read.call_args.kwargs["environment"], "production")

    @patch("apps.evaluations.trace_views.read_model_metrics", side_effect=LangfuseUnavailable)
    def test_api_fails_closed_when_upstream_is_unavailable(self, _read):
        request = APIRequestFactory().get("/api/v1/ops/model-trace-metrics")
        force_authenticate(request, user=SimpleNamespace(is_authenticated=True))
        response = api_model_trace_metrics(request)
        self.assertEqual(response.status_code, 503)
        self.assertNotIn("results", response.data)
