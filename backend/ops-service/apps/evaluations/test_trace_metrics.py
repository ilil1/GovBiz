from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import patch

from django.test import SimpleTestCase
from rest_framework.test import APIRequestFactory, force_authenticate

from .trace_client import LangfuseUnavailable
from .trace_metrics import read_metrics
from .trace_views import api_trace_metrics

NOW = datetime(2026, 10, 14, 2, tzinfo=UTC)


def row(name, identifier, *, level="DEFAULT", latency=1.0, ended=True, environment=None):
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
        "environment": environment,
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

    @patch("apps.evaluations.trace_metrics.read_page")
    def test_rejects_unknown_level_or_end_before_start(self, read_page):
        invalid_level = row("search.total", "1", level="UNKNOWN")
        invalid_time = {**row("search.total", "2"), "endTime": "2026-10-14T00:59:59Z"}
        for invalid in (invalid_level, invalid_time):
            with self.subTest(observation=invalid):
                read_page.return_value = ([invalid], None)
                with self.assertRaises(LangfuseUnavailable):
                    read_metrics(from_time=NOW - timedelta(days=1), to_time=NOW)

    @patch("apps.evaluations.trace_metrics.read_page")
    def test_environment_filters_without_guessing_missing_values(self, read_page):
        rows = [
            row("search.total", "1", environment="production"),
            row("search.total", "2", environment="development"),
            row("search.total", "3", environment=None),
            row("search.total", "4", environment="staging"),
        ]
        for env, expected in (
            ("all", 4),
            ("production", 1),
            ("development", 1),
            ("unknown", 1),
            ("other", 1),
        ):
            with self.subTest(environment=env):
                read_page.side_effect = [(rows, None), ([], None), ([], None), ([], None)]
                result = read_metrics(
                    from_time=NOW - timedelta(days=1), to_time=NOW, environment=env
                )
                self.assertEqual(result[0]["observed"], expected)

    @patch("apps.evaluations.trace_metrics.read_page")
    def test_combination_review_root_is_counted(self, read_page):
        read_page.side_effect = [
            ([], None),
            ([], None),
            ([], None),
            ([row("combination.total", "combination1", level="ERROR", latency=2)], None),
        ]
        result = read_metrics(from_time=NOW - timedelta(days=1), to_time=NOW)
        self.assertEqual(result[3]["name"], "combination.total")
        self.assertEqual(result[3]["observed"], 1)
        self.assertEqual(result[3]["errors"], 1)
        self.assertEqual(result[3]["p95_seconds"], 2)

    @patch("apps.evaluations.trace_metrics.read_page")
    def test_combination_review_invalid_or_incomplete_page_fails_entire_summary(self, read_page):
        invalid = row("combination.total", "combination1", level="UNKNOWN")
        for pages in (
            [([invalid], None)],
            [([], "cursor1"), ([], "cursor2"), ([], "cursor3")],
        ):
            with self.subTest(pages=pages):
                read_page.side_effect = [([], None)] * 3 + pages
                with self.assertRaises(LangfuseUnavailable):
                    read_metrics(from_time=NOW - timedelta(days=1), to_time=NOW)

    @patch("apps.evaluations.trace_metrics.read_page")
    def test_excluded_environment_does_not_hide_incomplete_or_duplicate_pages(self, read_page):
        dev = row("search.total", "1", environment="development")
        read_page.side_effect = [([dev], "cursor1"), ([dev], None)]
        with self.assertRaises(LangfuseUnavailable):
            read_metrics(from_time=NOW - timedelta(days=1), to_time=NOW, environment="production")

    def test_environment_query_rejects_unsupported_values(self):
        request = APIRequestFactory().get("/api/v1/ops/trace-metrics?environment=invalid")
        force_authenticate(request, user=SimpleNamespace(is_authenticated=True))
        self.assertEqual(api_trace_metrics(request).status_code, 400)

    @patch("apps.evaluations.trace_views.read_metrics", return_value=[])
    def test_environment_query_is_forwarded_and_echoed(self, read):
        request = APIRequestFactory().get("/api/v1/ops/trace-metrics?environment=production")
        force_authenticate(request, user=SimpleNamespace(is_authenticated=True))
        response = api_trace_metrics(request)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["environment"], "production")
        self.assertEqual(read.call_args.kwargs["environment"], "production")

    @patch("apps.evaluations.trace_views.read_metrics", side_effect=LangfuseUnavailable)
    def test_upstream_failure_is_503_without_partial_values(self, _read):
        request = APIRequestFactory().get("/api/v1/ops/trace-metrics")
        force_authenticate(request, user=SimpleNamespace(is_authenticated=True))
        response = api_trace_metrics(request)
        self.assertEqual(response.status_code, 503)
        self.assertNotIn("results", response.data)
