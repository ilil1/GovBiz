"""수집된 허용 모델 generation만 집계한다. 전체 호출의 분모는 알 수 없다."""

import json
import math
import re
import time

from django.utils.dateparse import parse_datetime

from .trace_client import LangfuseUnavailable, observation, read_page

MODEL_NAMES = ("search.ranking.model", "evidence.model", "assistant.model", "combination.model")
MODEL_PATTERN = re.compile(r"[A-Za-z0-9][A-Za-z0-9._:-]{0,99}\Z")
ENVIRONMENTS = {"all", "production", "development", "unknown", "other"}
MAX_PAGES = 3
PAGE_SIZE = 1000
READ_SECONDS = 8


def read_model_metrics(*, from_time, to_time, environment="all"):
    if environment not in ENVIRONMENTS:
        raise ValueError("Invalid environment")
    deadline = time.monotonic() + READ_SECONDS
    groups = {}
    seen = set()
    try:
        for name in MODEL_NAMES:
            params = {
                "fields": "basic,metrics,model,metadata",
                "limit": PAGE_SIZE,
                "filter": json.dumps(
                    [
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
            cursors = set()
            for _ in range(MAX_PAGES):
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise ValueError("Model metrics deadline exceeded")
                rows, cursor = read_page(params, timeout=min(5, remaining))
                for row in rows:
                    item = observation(row)
                    started = parse_datetime(item["started_at"])
                    ended = parse_datetime(item["ended_at"]) if item["ended_at"] else None
                    if (
                        item["name"] != name
                        or item["type"] != "GENERATION"
                        or row.get("level") not in {"DEBUG", "DEFAULT", "WARNING", "ERROR"}
                        or not from_time <= started < to_time
                        or (ended is not None and ended < started)
                        or item["id"] in seen
                    ):
                        raise ValueError("Unexpected model observation")
                    seen.add(item["id"])
                    model = item["model"] or None
                    if model is not None and not MODEL_PATTERN.fullmatch(model):
                        raise ValueError("Invalid model")
                    metadata = row.get("metadata")
                    if metadata is not None and not isinstance(metadata, dict):
                        raise ValueError("Invalid metadata")
                    outcome = (metadata or {}).get("outcome")
                    if outcome is not None and not isinstance(outcome, str):
                        raise ValueError("Invalid outcome")
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
                    group = groups.setdefault(
                        (name, model),
                        {
                            "observed": 0,
                            "completed": 0,
                            "errors": 0,
                            "warnings": 0,
                            "timeouts": 0,
                            "timeout_unknown": 0,
                            "in_progress": 0,
                            "missing_latency": 0,
                            "durations": [],
                        },
                    )
                    group["observed"] += 1
                    if ended is None:
                        group["in_progress"] += 1
                        continue
                    group["completed"] += 1
                    if item["level"] == "WARNING":
                        group["warnings"] += 1
                    if item["level"] == "ERROR":
                        group["errors"] += 1
                        if outcome == "timeout":
                            group["timeouts"] += 1
                        elif outcome not in {"failed", "cancelled", "incomplete"}:
                            group["timeout_unknown"] += 1
                    if item["latency_seconds"] is None:
                        group["missing_latency"] += 1
                    else:
                        group["durations"].append(item["latency_seconds"])
                if not cursor:
                    break
                if cursor in cursors:
                    raise ValueError("Repeated cursor")
                cursors.add(cursor)
                params["cursor"] = cursor
            else:
                raise ValueError("Model metrics page limit exceeded")
    except (AttributeError, KeyError, TypeError, ValueError, OverflowError):
        raise LangfuseUnavailable from None

    results = []
    for (feature, model), group in sorted(
        groups.items(), key=lambda item: (item[0][0], item[0][1] or "")
    ):
        durations = sorted(group.pop("durations"))
        results.append(
            {
                "feature": feature,
                "model": model,
                **group,
                "latency_samples": len(durations),
                "p50_seconds": durations[math.ceil(len(durations) * 0.5) - 1]
                if durations
                else None,
                "p95_seconds": durations[math.ceil(len(durations) * 0.95) - 1]
                if durations
                else None,
            }
        )
    return results
