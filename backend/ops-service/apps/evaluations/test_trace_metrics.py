from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import patch

from django.test import SimpleTestCase
from rest_framework.test import APIRequestFactory, force_authenticate

from .trace_client import LangfuseUnavailable
from .trace_metrics import read_metrics
from .trace_views import api_trace_metrics

NOW = datetime(2026, 10, 14, 2, tzinfo=UTC)


def row(name, identifier, *, level="DEFAULT", latency=1.0, ended=True):
    return {
        "id": identifier,
        "traceId": "a" * 32,
        "name": name,
        "type": "SPAN",
        "startTime": "2026-10-14T01:00:00Z",
        "endTime": "2026-10-14T01:00:01Z" if ended else None,
        "isRootObservation": True,
        "level": level,
        "latency": latency,
    }


class TraceMetricsTests(SimpleTestCase):
    @patch("apps.evaluations.trace_metrics.read_page")
    def test_counts_completed_errors_warnings_pending_and_missing_latency(self, read_page):
        read_page.side_effect = [
            (
                [
                    row("search.total", "1", latency=1),
                    row("search.total", "2", level="ERROR", latency=9),
                    row("search.total", "3", level="WARNING", latency=None),
                    row("search.total", "4", ended=False, level="ERROR"),
                ],
                None,
            ),
            ([], None),
            ([], None),
        ]
        results = read_metrics(from_time=NOW - timedelta(days=1), to_time=NOW)
        self.assertEqual(
            results[0],
            {
                "name": "search.total",
                "observed": 4,
                "completed": 3,
                "in_progress": 1,
                "errors": 1,
                "warnings": 1,
                "latency_samples": 2,
                "missing_latency": 1,
                "p50_seconds": 1,
                "p95_seconds": 9,
            },
        )
        self.assertIsNone(results[1]["p95_seconds"])

    @patch("apps.evaluations.trace_metrics.read_page")
    def test_page_limit_and_duplicate_never_return_partial_results(self, read_page):
        read_page.side_effect = [([], "cursor1"), ([], "cursor2"), ([], "cursor3")]
        with self.assertRaises(LangfuseUnavailable):
            read_metrics(from_time=NOW - timedelta(days=1), to_time=NOW)
        read_page.side_effect = [
            ([row("search.total", "1")], "cursor1"),
            ([row("search.total", "1")], None),
        ]
        with self.assertRaises(LangfuseUnavailable):
            read_metrics(from_time=NOW - timedelta(days=1), to_time=NOW)

    @patch("apps.evaluations.trace_metrics.read_page")
    def test_rejects_non_root_or_wrong_name(self, read_page):
        read_page.return_value = ([row("assistant.total", "1")], None)
        with self.assertRaises(LangfuseUnavailable):
            read_metrics(from_time=NOW - timedelta(days=1), to_time=NOW)

    @patch("apps.evaluations.trace_views.read_metrics", side_effect=LangfuseUnavailable)
    def test_upstream_failure_is_503_without_partial_values(self, _read):
        request = APIRequestFactory().get("/api/v1/ops/trace-metrics")
        force_authenticate(request, user=SimpleNamespace(is_authenticated=True))
        response = api_trace_metrics(request)
        self.assertEqual(response.status_code, 503)
        self.assertNotIn("results", response.data)
