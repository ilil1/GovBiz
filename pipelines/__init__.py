"""Prefect 파이프라인. 기존 평가·서비스 소스를 저장소에서 함께 사용한다."""

import os
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parent.parent
# 서비스와 평가 폴더 이름에는 하이픈이 있어 기존 Python 모듈 검색 경로를 명시한다.
for source in (ROOT, ROOT / "backend/ai-service", ROOT / "backend/ops-service",
               ROOT / "evaluation/support-program-evidence"):
    if str(source) not in sys.path:
        sys.path.insert(0, str(source))

os.environ["DO_NOT_TRACK"] = "1"
os.environ["PREFECT_SERVER_ANALYTICS_ENABLED"] = "false"
os.environ.setdefault("PREFECT_HOME", str(ROOT / "work/llmops/prefect-client"))
