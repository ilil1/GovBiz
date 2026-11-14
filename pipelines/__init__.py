"""설치된 평가 엔진과 공용 계약을 사용하는 Prefect 파이프라인."""

import os

os.environ["DO_NOT_TRACK"] = "1"
os.environ["PREFECT_SERVER_ANALYTICS_ENABLED"] = "false"
