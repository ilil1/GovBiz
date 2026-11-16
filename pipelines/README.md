# GovBiz 파이프라인

`pipelines/`는 Prefect가 실행할 평가 순서와 재시도, 외부 점수 전송을 관리하는
설치 가능한 Python 패키지다. 평가 지표·입력 검증·비교 보고서는
`govbiz-evaluation-engine` 패키지의 `support_program_evidence` 모듈을 호출한다.

```text
packages/
├── govbiz-ai-runtime/                # AI 서비스와 실행기가 공유하는 모델·생성·검색 코드
└── govbiz-evaluation-contracts/      # Ops와 실행기가 공유하는 카탈로그·검증·파일 계약

pipelines/
├── pyproject.toml, uv.lock           # 실행 의존성과 잠금 파일
├── serve.py                         # 평가 Deployment 등록·실행 대기
├── flows/                           # Prefect 실행 흐름
│   ├── support_program_evidence/    # 구현된 공고 원문 평가 파이프라인
│   │   ├── flows.py                 # Ops 요청 검증·실행·복구 순서
│   │   ├── capture.py, rag.py       # 고정 근거·RAG 평가 흐름
│   │   ├── tasks.py                 # Prefect 작업과 재시도 정책
│   │   ├── clients.py               # Langfuse 점수 전송·저장 확인
│   │   └── tests/                   # 실행 순서·실패·복구 및 전용 Prefect 테스트 설정
│   ├── catalog_ingestion/README.md   # 추후 검토 후 개발 예정
│   └── daily_report/README.md       # 추후 검토 후 개발 예정
├── evals/                           # 기능별 평가 코드와 전용 테스트
│   ├── pyproject.toml
│   ├── support_program_evidence/
│   │   ├── datasets/                # 평가 입력 데이터와 이전 실행 기록
│   │   │   ├── fixture*.json
│   │   │   └── runs/
│   │   ├── evaluators/              # 답변·RAG 지표 계산
│   │   ├── reports/                 # 비교 보고서와 점수
│   │   ├── integrations/            # 모델 호출과 예산 연계
│   │   ├── preparation/             # 평가 자료 준비 및 검증
│   │   └── tests/                   # 근거 답변·RAG 평가 테스트
│   └── support_program_search/      # 관련 공고 검색·순위 평가 CLI
│       ├── evaluate.py              # 후보 검색·최종 추천 지표 계산
│       ├── review/                  # 검색 결과 검토 도구
│       ├── elasticsearch/           # 로컬 검색 비교 실험 설정
│       ├── runs/                    # 과거 입력·캡처·보고서·실행 코드 보존
│       └── tests/                   # 검색 평가 테스트; 검토 도구는 tests/review/
└── tests/                           # 공통 패키지 구조·설치·리소스 계약 검증
```

설치되는 근거 평가 엔진과 파이프라인은 AI 서비스의 `app`이나 Ops의 `apps`를 import하지 않는다.
공유 코드는 별도 패키지를 설치해 사용하고, Ops의 예산 승인·정산은 계속 HTTP API로
요청한다. Prefect·Langfuse·Ops 연결도 운영 시 필요한 외부 시스템 의존성이다.
평가 엔진은 Prefect나 `pipelines`를 가져오지 않는다.

실행 코드 테스트와 전용 `conftest.py`는 해당 `flows/<기능>/tests/`에서 관리한다.
평가 코드 테스트는 해당 `evals/<기능>/tests/`에서 관리한다.
`pipelines/tests/`에는 기능 실행과 무관한 패키지 구조·설치·리소스 계약 테스트를 둔다.

`support_program_evidence`는 공고 안의 근거 검색·답변·인용을 평가하며 설치되는 평가 엔진에 포함된다.
`support_program_search`는 여러 공고 중 관련 공고를 찾고 순위를 매기는 품질을 평가한다.
검색 평가는 [독립 CLI와 검토 도구](evals/support_program_search/README.md)로 실행하며,
실제 Agent를 대역 HTTP로 검증하는 테스트는 AI 서비스의 테스트 의존성을 사용한다.

입력 데이터와 과거 `runs/`는 `pipelines/evals/support_program_evidence/datasets/`에서 관리하며 내용을 다시 계산하지 않는다. 이미지 빌드는 승인된
카탈로그가 참조하는 JSON만 검증해 계약 패키지의 리소스로 묶는다. 설치된 실행기는
그 리소스와 실제 설치 코드의 해시를 확인하며, 저장소의 `backend/`·`evaluation/`
경로를 요구하지 않는다. CLI로 원본 데이터를 재생성할 때는 저장소 경로를 명시한다.
실행 명세에 남은 `backend/...` 및 `evaluation/support-program-evidence/...` 문자열은 과거 평가 기록과 연결하는 논리 식별자다.
실제 검증 파일은 설치된 공용 패키지에서 찾으므로 해당 저장소 경로가 필요하지 않다.
평가 코드의 과거 논리 파일 식별자는 유지하고, 실행 시 실제 역할별 모듈의 해시를 확인한다.
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

`catalog_ingestion/`과 `daily_report/`는 개발 예정 안내만 있으며 실행 코드나 Prefect 배포가 없다.

현재는 `govbiz-ops-evidence-evaluation/saved-capture` 하나를 모듈 진입점으로 등록하고
`limit=1`로 운영한다. 같은 Deployment에서 저장 캡처 재계산·승인된 실행·복구를
처리하며, 등록만으로 유료 평가를 시작하지 않는다.

외부 모델 호출 없는 평가·파이프라인 회귀 검증:

```bash
uv run --project pipelines --locked --no-editable --extra dev python -m pytest pipelines/evals/support_program_evidence/tests pipelines/tests pipelines/flows/support_program_evidence/tests
```

검색 평가 검증은 근거 답변 평가와 별도 프로세스로 실행한다. 저장된 실행 기록은 자동 수집 대상에서 제외한다.

```bash
uv run --project pipelines --locked --no-editable --extra dev --group integration python -m pytest pipelines/evals/support_program_search/tests
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
