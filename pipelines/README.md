# GovBiz 파이프라인

`pipelines/`는 Prefect가 실행할 평가 순서와 재시도, 외부 점수 전송을 관리한다.
평가 지표·입력 검증·비교 보고서 계산은 `evaluation/`의 함수를 호출한다.

```text
evaluation/support-program-evidence/
├── evaluate.py, rag_evaluate.py       # 입력 검증·지표 계산
├── reporting.py, rag_reporting.py     # 비교 보고서·점수 데이터 생성
├── budget_client.py                   # 유료 실행 시 Ops 예산 계약
├── rag_live.py, serve_flow.py, ...     # 기존 캡처 생성·검증 도구
└── fixture·runs·tests                 # 기존 입력·실험 기록·평가 테스트

pipelines/
├── pyproject.toml, uv.lock            # 실행 의존성과 잠금 파일
├── serve.py                          # 평가 Deployment 등록·실행 대기
├── evaluation/
│   ├── flows.py                      # Ops 요청 검증·실행·복구 순서
│   ├── capture.py, rag.py             # 고정 근거·RAG 평가 흐름
│   ├── tasks.py                      # Prefect 작업과 재시도 정책
│   └── clients.py                    # Langfuse 점수 전송·저장 확인
└── tests/                            # 실행 순서·실패·복구 검증
```

`evaluation/`는 Prefect나 `pipelines/` 모듈을 가져오지 않는다.
다만 기존 실행 도구까지 모두 순수 계산 함수로 바꾼 것은 아니다. 승인된 모델 호출의
캡처 생성 도구와 `BudgetClient`는 평가 도구에서도 사용하므로 기존 위치에 유지한다.
`BudgetClient`는 Ops API에 예산 사용을 요청하는 클라이언트이며 Prefect에 의존하지 않는다.
입력 데이터와 과거 `runs/` 기록은 이동하거나 다시 계산하지 않는다.

저장소 루트에서 실행한다. Prefect·Langfuse와 Ops 연결 설정은
[LLMOps 운영 안내](../infrastructure/llmops/README.md)를 따른다.

```bash
uv sync --project pipelines --locked --extra dev
uv run --project pipelines --locked python -m pipelines.serve
```

현재는 `govbiz-ops-evidence-evaluation/saved-capture` 하나만 등록하고 `limit=1`로
운영한다. 같은 Deployment에서 Ops 요청에 따라 저장 캡처 재계산·승인된 실행·복구를
처리하며, 등록만으로 유료 평가를 시작하지 않는다. 수집·리포트 파이프라인은 아직 없다.
필요해지면 `serve.py`에서 여러 Deployment를 함께 등록하도록 확장할 수 있다.

실제 서비스와 유료 모델 API 없이 실행하는 회귀 검증(일부 테스트는 임시 로컬 HTTP 서버 사용):

```bash
uv run --project pipelines --locked --extra dev python -m pytest evaluation/support-program-evidence pipelines/tests
```

실행 파일이나 잠금 파일이 바뀌면 Ops의 `execution_release.json`도 갱신해야 한다.
실행기는 접수된 명세와 실제 코드·입력의 해시가 다르면 평가를 시작하지 않는다.
이번 경로 변경도 명세 버전을 바꾸므로 Ops와 실행기를 같은 릴리스로 배포한다.
이전 코드로 접수한 미실행 요청은 새 실행기에서 거절될 수 있으므로 새 명세로 다시 접수한다.
컨테이너·Compose·GitOps 설정은 계속 `infrastructure/`에서 관리한다.
