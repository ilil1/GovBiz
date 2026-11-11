"""Compact-view conversion preserves the verified report except graph widths."""

import json
import unittest

from .report_layout import ReportLayoutUnavailable, compact_report


def report_fixture():
    def graph(title, size):
        return {"type": "big_graph", "title": title, "size": size, "widgets": []}

    data = {
        "name": "Report",
        "widgets": [
            {
                "type": "group",
                "size": 2,
                "widgets": [
                    {"type": "counter", "size": 2, "widgets": []},
                    graph('인용 "value"', 2),
                    graph("이미 두 열", 1),
                ],
            }
        ],
    }
    encoded = json.dumps(data, ensure_ascii=False).encode()
    return (
        b"<html><script>\nvar metric_"
        + b"a" * 32
        + b" = "
        + encoded
        + b";\n</script><script>window.original = true;</script></html>"
    )


def graphless_report_fixture():
    data = {"name": "Report", "widgets": [{"type": "counter", "size": 2, "widgets": []}]}
    return (
        b"<html><script>var metric_"
        + b"a" * 32
        + b" = "
        + json.dumps(data).encode()
        + b";</script></html>"
    )


class ReportLayoutTests(unittest.TestCase):
    def test_only_graph_width_changes_and_original_is_unchanged(self):
        original = report_fixture()
        expected = original.replace(b'\\"value\\"", "size": 2', b'\\"value\\"", "size": 1', 1)
        compact = compact_report(original)
        self.assertNotEqual(compact, original)
        self.assertEqual(compact, expected)
        self.assertEqual(compact_report(compact), compact)

    def test_valid_report_without_graphs_is_returned_unchanged(self):
        original = graphless_report_fixture()
        self.assertEqual(compact_report(original), original)

    def test_unknown_or_ambiguous_html_fails_explicitly(self):
        original = report_fixture()
        for report in (
            b"<html>legacy report</html>",
            original.replace(b'"size": 2, "widgets": []}', b'"size": 3, "widgets": []}'),
            original + original,
            original.replace(b"var metric_", b"var unknown_"),
            b"\xff",
        ):
            with self.subTest(report=report[:40]), self.assertRaises(ReportLayoutUnavailable):
                compact_report(report)
