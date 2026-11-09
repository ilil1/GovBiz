"""수집된 Core 시작 단계만 집계한다. 전체 사용자 요청의 분모는 알 수 없다."""

import json
import math
import time

from django.utils.dateparse import parse_datetime

from .trace_client import LangfuseUnavailable, observation, read_page

ROOT_NAMES = ("search.total", "evidence.total", "assistant.total", "combination.total")
MAX_PAGES = 3
PAGE_SIZE = 1000
READ_SECONDS = 8
ENVIRONMENTS = {"all", "production", "development", "unknown", "other"}


def read_metrics(*, from_time, to_time, environment="all"):
    if environment not in ENVIRONMENTS:
        raise ValueError("Invalid environment")
    deadline = time.monotonic() + READ_SECONDS
    result = []
    seen = set()
    for name in ROOT_NAMES:
        params = {
            "fields": "basic,metrics",
            "limit": PAGE_SIZE,
            "filter": json.dumps(
                [
                    {
                        "type": "boolean",
                        "column": "isRootObservation",
                        "operator": "=",
                        "value": True,
                    },
                    {
                        "type": "datetime",
                        "column": "startTime",
                        "operator": ">=",
                        "value": from_time.isoformat(),
                    },
                    {
                        "type": "datetime",
                        "column": "startTime",
                        "operator": "<",
                        "value": to_time.isoformat(),
                    },
                    {"type": "string", "column": "name", "operator": "=", "value": name},
                ],
                separators=(",", ":"),
            ),
        }
        completed = errors = warnings = in_progress = missing_latency = 0
        durations = []
        cursors = set()
        try:
            for _ in range(MAX_PAGES):
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise ValueError("Trace metrics deadline exceeded")
                rows, cursor = read_page(params, timeout=min(5, remaining))
                for row in rows:
                    if row.get("isRootObservation") is not True:
                        raise ValueError("Unexpected non-root observation")
                    item = observation(row)
                    started = parse_datetime(item["started_at"])
                    ended = parse_datetime(item["ended_at"]) if item["ended_at"] else None
                    if (
                        item["name"] != name
                        or row.get("level") not in {"DEBUG", "DEFAULT", "WARNING", "ERROR"}
                        or not from_time <= started < to_time
                        or (ended is not None and ended < started)
                    ):
                        raise ValueError("Unexpected observation")
                    if item["id"] in seen:
                        raise ValueError("Duplicate observation")
                    seen.add(item["id"])
                    # 원본 응답의 모든 페이지를 검증한 뒤 선택한 환경만 센다.
                    # 빈 값과 알 수 없는 다른 환경은 운영이나 개발로 추정하지 않는다.
                    value = item["environment"]
                    category = (
                        "unknown"
                        if value is None or not value.strip()
                        else value
                        if value in {"production", "development"}
                        else "other"
                    )
                    if environment != "all" and environment != category:
                        continue
                    if item["ended_at"] is None:
                        in_progress += 1
                        continue
                    completed += 1
                    errors += item["level"] == "ERROR"
                    warnings += item["level"] == "WARNING"
                    if item["latency_seconds"] is None:
                        missing_latency += 1
                    else:
                        durations.append(item["latency_seconds"])
                if not cursor:
                    break
                if cursor in cursors:
                    raise ValueError("Repeated cursor")
                cursors.add(cursor)
                params["cursor"] = cursor
            else:
                raise ValueError("Trace metrics page limit exceeded")
        except (AttributeError, KeyError, TypeError, ValueError, OverflowError):
            raise LangfuseUnavailable from None
        durations.sort()

        def percentile(fraction, values=durations):
            return values[math.ceil(len(values) * fraction) - 1] if values else None

        result.append(
            {
                "name": name,
                "observed": completed + in_progress,
                "completed": completed,
                "in_progress": in_progress,
                "errors": errors,
                "warnings": warnings,
                "latency_samples": len(durations),
                "missing_latency": missing_latency,
                "p50_seconds": percentile(0.50),
                "p95_seconds": percentile(0.95),
            }
        )
    return result
