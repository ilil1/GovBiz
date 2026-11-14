"""평가 엔진 테스트의 소스 경로. Prefect 실행 패키지는 가져오지 않는다."""
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[2]
for source in (ROOT / "backend/ai-service", ROOT / "backend/ops-service", Path(__file__).parent):
    sys.path.insert(0, str(source))
