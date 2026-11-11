"""The compact view is derived only after the stored report is verified."""

from types import SimpleNamespace
from unittest.mock import patch
from uuid import uuid4

from django.test import SimpleTestCase
from rest_framework.test import APIRequestFactory, force_authenticate

from .services import ResultsUnavailable
from .test_report_layout import graphless_report_fixture, report_fixture
from .views import evaluation_report


class CompactReportApiTests(SimpleTestCase):
    def setUp(self):
        self.factory = APIRequestFactory()
        self.run_id = uuid4()
        self.report = report_fixture()

    def get(self, query=""):
        request = self.factory.get(f"/api/v1/ops/evaluations/{self.run_id}/report{query}")
        force_authenticate(request, user=SimpleNamespace(is_authenticated=True))
        return evaluation_report(request, self.run_id)

    @patch("apps.evaluations.views.get_object_or_404")
    @patch("apps.evaluations.views.read_result")
    def test_anonymous_request_cannot_access_compact_report(self, read, get_run):
        request = self.factory.get(f"/api/v1/ops/evaluations/{self.run_id}/report?view=compact")
        self.assertEqual(evaluation_report(request, self.run_id).status_code, 401)
        get_run.assert_not_called()
        read.assert_not_called()

    @patch("apps.evaluations.views.get_object_or_404")
    @patch("apps.evaluations.views.read_result")
    def test_raw_bytes_and_compact_view_share_verification_and_sandbox(self, read, get_run):
        read.return_value = (None, None, self.report, None)
        original = self.get()
        compact = self.get("?view=compact")
        self.assertEqual(original.status_code, 200)
        self.assertEqual(compact.status_code, 200)
        self.assertEqual(original.content, self.report)
        self.assertNotEqual(compact.content, self.report)
        self.assertEqual(compact["Content-Security-Policy"], original["Content-Security-Policy"])
        self.assertIn("sandbox allow-scripts", compact["Content-Security-Policy"])
        self.assertIn("no-store", compact["Cache-Control"])
        self.assertEqual(read.call_count, 2)
        get_run.assert_called_with(get_run.call_args.args[0], pk=self.run_id, status="COMPLETED")

    @patch("apps.evaluations.views.get_object_or_404")
    @patch("apps.evaluations.views.read_result", side_effect=ResultsUnavailable)
    def test_unverified_report_is_never_transformed(self, read, _get_run):
        response = self.get("?view=compact")
        self.assertEqual(response.status_code, 404)
        read.assert_called_once()

    @patch("apps.evaluations.views.get_object_or_404")
    @patch("apps.evaluations.views.read_result")
    def test_report_without_graphs_is_returned_unchanged(self, read, _get_run):
        original = graphless_report_fixture()
        read.return_value = (None, None, original, None)
        compact = self.get("?view=compact")
        self.assertEqual(compact.status_code, 200)
        self.assertEqual(compact.content, original)
        self.assertIn("sandbox allow-scripts", compact["Content-Security-Policy"])

    @patch("apps.evaluations.views.get_object_or_404")
    @patch("apps.evaluations.views.read_result")
    def test_unknown_report_layout_is_explicit_error(self, read, _get_run):
        read.return_value = (None, None, b"<html>older unknown format</html>", None)
        compact = self.get("?view=compact")
        self.assertEqual(compact.status_code, 422)
        self.assertContains(compact, 'href="?"', status_code=422)
        self.assertContains(compact, "저장된 원본 보고서 보기", status_code=422)
        self.assertIn("sandbox allow-scripts", compact["Content-Security-Policy"])
        self.assertIn("no-store", compact["Cache-Control"])
        original = self.get()
        self.assertEqual(original.status_code, 200)
        self.assertEqual(original.content, b"<html>older unknown format</html>")
