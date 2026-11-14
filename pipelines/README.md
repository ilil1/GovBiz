# GovBiz 파이프라인

`pipelines/`는 Prefect가 실행할 평가 순서와 재시도, 외부 점수 전송을 관리하는
설치 가능한 Python 패키지다. 평가 지표·입력 검증·비교 보고서는
`govbiz-evaluation-engine` 패키지의 `govbiz_evaluation` 모듈을 호출한다.

```text
packages/
├── govbiz-ai-runtime/                # AI 서비스와 실행기가 공유하는 모델·생성·검색 코드
└── govbiz-evaluation-contracts/      # Ops와 실행기가 공유하는 카탈로그·검증·파일 계약

evaluation/
├── pyproject.toml                   # govbiz-evaluation-engine 설치 정의
└── support-program-evidence/        # govbiz_evaluation 모듈로 설치
    ├── evaluate.py, rag_evaluate.py  # 입력 검증·지표 계산
    ├── reporting.py, rag_reporting.py # 비교 보고서·점수 데이터 생성
    ├── budget_client.py, rag_live.py # 승인된 모델 호출·Ops 예산 통신
    └── fixture·runs·tests           # 원본 입력·실험 기록·평가 테스트

pipelines/
├── pyproject.toml, uv.lock           # 실행 의존성과 잠금 파일
├── serve.py                         # 평가 Deployment 등록·실행 대기
├── evaluation/
│   ├── flows.py                     # Ops 요청 검증·실행·복구 순서
│   ├── capture.py, rag.py            # 고정 근거·RAG 평가 흐름
│   ├── tasks.py                     # Prefect 작업과 재시도 정책
│   └── clients.py                   # Langfuse 점수 전송·저장 확인
└── tests/                           # 실행 순서·실패·복구 검증
```

평가 엔진과 파이프라인은 AI 서비스의 `app`이나 Ops의 `apps`를 import하지 않는다.
공유 코드는 별도 패키지를 설치해 사용하고, Ops의 예산 승인·정산은 계속 HTTP API로
요청한다. Prefect·Langfuse·Ops 연결도 운영 시 필요한 외부 시스템 의존성이다.
평가 엔진은 Prefect나 `pipelines`를 가져오지 않는다.

입력 데이터와 과거 `runs/`는 이동하거나 다시 계산하지 않는다. 이미지 빌드는 승인된
카탈로그가 참조하는 JSON만 검증해 계약 패키지의 리소스로 묶는다. 설치된 실행기는
그 리소스와 실제 설치 코드의 해시를 확인하며, 저장소의 `backend/`·`evaluation/`
경로를 요구하지 않는다. CLI로 원본 데이터를 재생성할 때는 저장소 경로를 명시한다.
실제 AI HTTP 앱을 띄우는 캡처 도구는 `backend/ai-service/integration/serve_flow.py`에
있으며 실행기 패키지에는 포함하지 않는다.

개발 환경에서는 저장소 루트에서 의존성을 설치한다. 실행 전 리소스 묶음은
[LLMOps 운영 안내](../infrastructure/llmops/README.md)의 빌드 절차로 준비한다.

```bash
python3 infrastructure/llmops/bundle_runner_inputs.py
uv sync --project pipelines --locked --no-editable --extra dev
uv run --project pipelines --locked --no-editable govbiz-pipelines
```

설치된 배포 환경에서는 작업 디렉터리와 관계없이 `govbiz-pipelines` 또는
`python -m pipelines.serve`로 시작한다. 결과 위치는 `LLMOPS_RESULTS_DIR`, 공용 잠금
위치는 `LLMOPS_WORK_DIR`로 지정한다. 미지정 시 현재 작업 디렉터리 아래 `work/`를
사용한다. Prefect 자체 저장 위치는 `PREFECT_HOME`으로 설정할 수 있다.

현재는 `govbiz-ops-evidence-evaluation/saved-capture` 하나를 모듈 진입점으로 등록하고
`limit=1`로 운영한다. 같은 Deployment에서 저장 캡처 재계산·승인된 실행·복구를
처리하며, 등록만으로 유료 평가를 시작하지 않는다.

외부 모델 호출 없는 평가·파이프라인 회귀 검증:

```bash
uv run --project pipelines --locked --no-editable --extra dev python -m pytest evaluation/support-program-evidence pipelines/tests
```

AI HTTP 앱과의 통합 검증에는 테스트 전용 의존성 그룹을 별도로 설치한다.
`integration` 그룹은 운영 실행기에는 설치하지 않는다.

```bash
uv sync --project pipelines --locked --no-editable --extra dev --group integration
PYTHONPATH=backend/ai-service pipelines/.venv/bin/python -m pytest backend/ai-service/integration
```

실행 파일·의존성 잠금·공용 계약이 바뀌면 `execution_release.json`도 갱신하고 Ops와
실행기를 같은 릴리스로 배포한다. 접수한 명세와 실제 설치 코드·입력 해시가 다르면
모델 호출 전에 거절한다. 이전 코드로 접수한 미실행 요청은 새 명세로 다시 접수해야
할 수 있다. 컨테이너·Compose·GitOps 설정은 `infrastructure/`에서 관리한다.
