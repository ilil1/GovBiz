"""Create a read-only compact view of a verified Evidently HTML report."""

import json
import re


class ReportLayoutUnavailable(ValueError):
    """The report is not in the known Evidently widget format."""


_REPORT_DATA = re.compile(r"<script>\s*var metric_[0-9a-f]{32}\s*=\s*")
_GRAPH = re.compile(
    r'\{"type": "big_graph", "title": (?P<title>"(?:[^"\\]|\\.)*"), '
    r'"size": (?P<size>[12])(?=,)'
)


def compact_report(report: bytes) -> bytes:
    """Change only graph width literals in the verified standalone report.

    Evidently 0.7.23 embeds widget data as JSON in a script assignment. Parse it
    to validate the exact graph sequence, but preserve every original byte other
    than graph size 2 -> 1. Unknown formats must not be silently altered.
    """
    try:
        html = report.decode("utf-8")
        assignments = list(_REPORT_DATA.finditer(html))
        if len(assignments) != 1:
            raise ReportLayoutUnavailable("Unknown report layout")
        start = assignments[0].end()
        data, consumed = json.JSONDecoder().raw_decode(html[start:])
        end = start + consumed
        if not html[end:].startswith(";") or not isinstance(data, dict):
            raise ReportLayoutUnavailable("Unknown report layout")
        if data.get("name") != "Report" or not isinstance(data.get("widgets"), list):
            raise ReportLayoutUnavailable("Unknown report layout")

        expected = []
        pending = list(reversed(data["widgets"]))
        while pending:
            widget = pending.pop()
            if not isinstance(widget, dict):
                raise ReportLayoutUnavailable("Unknown report layout")
            if widget.get("type") == "big_graph":
                size, title = widget.get("size"), widget.get("title")
                if type(size) is not int or size not in (1, 2) or not isinstance(title, str):
                    raise ReportLayoutUnavailable("Unknown report layout")
                expected.append((title, size))
            children = widget.get("widgets", [])
            if not isinstance(children, list):
                raise ReportLayoutUnavailable("Unknown report layout")
            pending.extend(reversed(children))

        body = html[start:end]
        matches = list(_GRAPH.finditer(body))
        found = [(json.loads(m.group("title")), int(m.group("size"))) for m in matches]
        if found != expected:
            raise ReportLayoutUnavailable("Unknown report layout")

        # All other HTML and JS, including Plotly data and labels, remains exact.
        pieces, offset = [], 0
        for match in matches:
            pos = match.start("size")
            pieces.extend((body[offset:pos], "1"))
            offset = pos + 1
        return (html[:start] + "".join(pieces) + body[offset:] + html[end:]).encode("utf-8")
    except (UnicodeError, json.JSONDecodeError, RecursionError) as exc:
        raise ReportLayoutUnavailable("Unknown report layout") from exc
