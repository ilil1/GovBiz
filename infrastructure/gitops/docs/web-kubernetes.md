# 웹 Kubernetes 배포

웹을 Vite 개발 서버 밖에서 실행하기 위한 구성이다. 런타임은 정적 번들을 제공하는 Nginx이며,
별도 웹 Chart 없이 기존 `govbiz-service` Chart의 Deployment·ClusterIP Service를 사용한다.
개발용 Compose·Vite와 기존 Vercel 배포는 유지한다.

Core·Ops의 웹 origin과 내부 평가·추적 연결은 [in-cluster values](../environments/in-cluster/README.md)를
함께 사용한다. 웹 overlay는 검증된 이미지 digest를 요구하며 기본 브라우저 주소는 `http://localhost:18173`이다.

## 실행 경로

`브라우저 → web:8080 → 정적 SPA 또는 Core/Ops 내부 Service`

- `/`, `/login`, `/ops/*` 등 화면 경로는 정적 번들을 제공한다. 깊은 경로 새로고침도 지원한다.
- `/api/v1/ops`와 그 하위 경로는 `ops-service:8000`으로 전달한다.
- 나머지 `/api/*`는 `core-service:8080`으로 전달한다. API 오류를 HTML로 바꾸지 않는다.
- Host의 포트, Origin, 쿠키, CSRF 헤더, 요청 메서드·쿼리·본문을 보존한다.
- API·HTML은 `private, no-store`, 해시 이름의 `/assets/*`만 장기 캐시한다.
- 브라우저가 보낸 프록시 IP·scheme·신뢰 헤더는 덮어쓰거나 제거한다.
- 일반 API 읽기 제한은 100초, 기존 신청 문서 생성 경로는 600초, 요청 본문 제한은 2MiB다.
- `/healthz`는 웹 프로세스 건강 확인이다. Core·Ops의 정상 여부를 대신하지 않는다.

현재 프록시는 같은 namespace의 Core·Ops Service와 직접 HTTP/loopback 접근을 대상으로 한다.
Service가 먼저 존재해야 Nginx가 기동하며, Service를 삭제·재생성해 ClusterIP가 바뀌면 웹도
재기동해야 한다. 일반 백엔드 Pod 교체는 Service를 유지하므로 웹 재기동이 필요 없다.
TLS 종료 지점의 신뢰 범위, 실제 클라이언트 IP, HTTPS 쿠키·CSRF 처리는 외부 ingress 구성에서
함께 정해야 한다. 임의의 `X-Forwarded-Proto`를 신뢰해 외부 TLS가 준비됐다고 간주하지 않는다.

## 빌드

저장소 루트에서 실행한다. Node 24.20.0과 기존 Nginx 1.30.4 이미지를 digest로 고정했고,
pnpm 11.22.0과 루트 잠금 파일을 사용한다.

```bash
docker build --file frontend/web/Dockerfile --tag govbiz-web:local-k8s .
```

기본 `WEB_MODE=portfolio`는 기존 격리 빌드 모드로 같은 origin API를 사용하고 도우미 AI UI를
끈다. 실제 AI UI가 필요한 배포는 `--build-arg WEB_MODE=connected`로 명시한다.
두 모드 모두 `.env*`와 상속된 `VITE_*`를 읽지 않으며 개발 로그인은 빌드에서 비활성이다.
개인 관리 계정의 정상 로그인 준비는 별도다. 런타임 환경변수로 이미 빌드한 UI 설정이 바뀌지 않는다.

Docker context는 웹·공통 패키지·workspace 입력으로 제한하고 `.env*`·키·캐시·로컬 산출물을
제외한다. 최종 이미지에는 정적 결과와 Nginx 설정만 복사한다. Node·pnpm·소스·API 비밀값은
런타임에 필요 없다. UID/GID `101`, 읽기 전용 루트 파일 시스템, 모든 capability 제거,
`/tmp` 임시 볼륨으로 실행한다.

## 로컬 개발 배포

먼저 Core·Ops가 실행되는 **명시적으로 선택한 개인 개발 클러스터**에 이미지를 적재한다.
기존 운영 Argo Application과 서비스는 이 명령의 변경 대상이 아니다.

```bash
kind load docker-image govbiz-web:local-k8s --name <개인-kind-클러스터>
helm template web infrastructure/gitops/charts/govbiz-service \
  --namespace govbiz-msa -f infrastructure/gitops/environments/local-msa/web.yaml
helm upgrade --install web infrastructure/gitops/charts/govbiz-service \
  --kubeconfig <개인-kubeconfig> --namespace govbiz-msa \
  -f infrastructure/gitops/environments/local-msa/web.yaml --wait --timeout 5m
kubectl --kubeconfig <개인-kubeconfig> -n govbiz-msa \
  port-forward --address 127.0.0.1 service/web 18173:8080
```

접속 주소는 `http://localhost:18173`이다. 기존 `5173` 개발 서버를 중지하거나 포트를 빼앗지 않는다.
Core의 허용 Origin, Ops의 `DJANGO_ALLOWED_HOSTS`·CSRF 설정과 NetworkPolicy가 이 경로를 허용해야
한다. 허용된 기존 관리자 계정의 로그인·Ops 조회를 별도로 확인한다. 서비스 상태 확인만으로
인증·평가의 실제 연결 성공을 주장하지 않는다.

개인 환경에서 기존 `http://localhost:5173`을 유지하며 새 웹을 사용할 때는 Core를 관리하는
Argo Application의 `spec.source.helm.valuesObject.env.APP_CORS_ALLOWED_ORIGIN`에
`http://localhost:5173,http://localhost:18173`을 설정하고 Core만 수동 동기화한다. 기존 값이
따로 있으면 덮어 버리지 말고 허용할 새 origin을 추가한다. 이는 Core의 세션 쿠키 쓰기 요청에
필요한 설정이다. 로그인·조회가 성공해도 이 값이 없으면 저장·로그아웃은 거절될 수 있다.
`127.0.0.1`로 접속한다면 해당 origin도 정확히 추가하고, 쿠키를 공유하지 않는 두 호스트를
로그인 도중에 혼용하지 않는다. 외부 origin을 광범위하게 허용하거나 CSRF 검사를 끄지 않는다.

Ops는 Host·Origin을 함께 보존하는 같은 origin 프록시를 사용한다. 현재 개인 환경의
`DJANGO_ALLOWED_HOSTS`에 `localhost,127.0.0.1`이 포함되어 있으므로 이 두 호스트의 직접 HTTP
접속을 위해 `DJANGO_CSRF_TRUSTED_ORIGINS`를 추가할 필요는 없다. 외부 ingress는 별도 설정이다.

## CI와 운영 인계

GovBiz CI의 기존 `Web and shared` 작업에서 정적 이미지 빌드와 기존
`verify-production-proxy.py --web-image govbiz-web:ci`를 실행한다. 가상 Core·Ops를 사용하므로
유료 모델이나 실제 데이터에 연결하지 않는다. 기존 AWS 프록시 검사도 같은 도구에 유지한다.
Infra CI는 기존 서비스 Chart 렌더링 테스트와 lint에 웹을 포함한다.

운영 인계 절차는 다음과 같다.

1. 변경 커밋의 필수 CI 성공을 확인한다.
2. 기본 브랜치의 `Kubernetes package setup`에서 `component=web`과 정확한 패키지 주소를
   입력해 빈 패키지를 준비한다. Actions 임시 토큰을 사용하므로 PAT 발급은 필요 없다.
   Public·연결 포크·Actions Write를 확인한다. 기존 패키지가 있으면 설정을 조회한다.
3. 기존 `MSA image candidates`를 기본 브랜치에서 `component=web`으로 수동 실행한다.
   동일 SHA 필수 CI를 다시 확인하고 `portfolio` 이미지 한 개를 발행한다.
   `msa-image-web`의 `web.json`에 기록된 공개 digest를 확보한다.
4. `localMode=false`, 공개 repository/digest, `pullPolicy=IfNotPresent`를 지정한다.
   local values의 `Never`를 원격 배포에 그대로 사용하지 않는다.
5. 같은 SHA의 Chart·웹 values를 선택하는 수동 Argo Application을 등록·동기화한다.
6. 기존 화면을 유지한 채 새 주소에서 로그인·Core·Ops 연결을 확인한 뒤 웹 접속을 전환한다.

발행·패키지 준비는 기존 도구를 재사용한다. 네 백엔드의 자동 발행과 평가 실행기의 별도 발행은
유지하며, 웹 패키지가 없다는 이유로 백엔드 자동 발행을 차단하지 않는다.
웹은 여러 workspace 입력과 `portfolio` 모드를 묶은 v4 receipt를 사용하므로 기존 네 백엔드
배포 묶음에 포함하지 않는다. [발행 안내](../../release/README.md#kubernetes-웹-이미지)

Kubernetes 웹 전환 완료와 외부 ingress/TLS 완료는 별개다.

## 2026-10-11 배포 확인

배포 대상은 `289c18a9d7a9674c8d7dcf04a93d42c744897e62`다. 이 SHA의 필수 CI가
모두 실제 실행되어 성공했다.

- [GovBiz CI](https://github.com/ilil1/SKN34-4th-1Team/actions/runs/38066804225): 웹·공통 패키지와 Linux 웹 이미지 빌드·프록시 검사 포함
- [Catalog separation CI](https://github.com/ilil1/SKN34-4th-1Team/actions/runs/38066804144)
- [GovBiz Ops CI](https://github.com/ilil1/SKN34-4th-1Team/actions/runs/38066804159)
- [Infra CI](https://github.com/ilil1/SKN34-4th-1Team/actions/runs/38066804143)
- [LLMOps CI](https://github.com/ilil1/SKN34-4th-1Team/actions/runs/38066804092): 두 번째 실행 성공. 첫 실행의 Gradle 의존성 다운로드 실패 후 소스 변경 없이 실패한 작업만 재실행했다.

기존 검사에서 실제 보고서 화면과 달랐던 경로·응답 수집을 수정했다. 화면은
`평가 상세 → /ops/evaluations/:id/report 해설 → /api/v1/ops/evaluations/:id/report 원본`
순서이며, 해설에 필요한 `/rag-material`도 복원 응답에 포함한다. 원본 보고서 해시·보안 헤더·
권한 거절·세션 폐기 검사는 유지한다. 별도 검사기나 발행 예외를 추가하지 않았다.
관련 로컬 관리 화면·브라우저 테스트 24개와 Ruff 검사를 통과했고 유료 모델 호출은 없었다.

개인 클러스터 `govbiz-f218b0ac1c`의 `govbiz-msa`에 실제 배포를 완료했다.

- [패키지 준비](https://github.com/ilil1/SKN34-4th-1Team/actions/runs/38071544847): Actions 임시 토큰으로 준비했다. Public·개인 포크 연결을 확인했고, 권한 상속을 해제한 뒤 Actions 권한을 Write로 줄였다.
- [웹 이미지 발행](https://github.com/ilil1/SKN34-4th-1Team/actions/runs/38072072123): `publish (web)`과 전체 실행이 성공했다. v4 receipt의 소스 입력·발행 정책·`portfolio` 모드를 대조했고, 인증 없는 레지스트리 조회도 통과했다.
- 배포 이미지: `ghcr.io/ilil1/skn34-4th-1team-web@sha256:46167f3915f3ceb70beed324a6e99876f62a9ea88efd4e714d4d0ed94915f4f4`
- `govbiz-fork-web`은 위 SHA의 Chart와 웹 values를 사용하며 수동 동기화로 운영한다. `localMode=false`, `pullPolicy=IfNotPresent`, digest 고정을 적용했다.
- 웹 Pod가 이 공개 digest를 직접 내려받아 `Ready`가 됐고 재시작은 0회다. 기존 앱을 포함한 Argo Application 9개가 모두 `Synced / Healthy`였다.
- [Kubernetes 웹](http://localhost:18173/)과 [관리 화면](http://localhost:18173/ops/evaluations)을 연결했다. 이 주소는 로컬 포트포워드가 실행 중일 때 사용할 수 있다. 기존 5173 개발 서버와 13000 Langfuse는 유지했다.
- 브라우저의 필터 검색 화면에서 실제 지원사업 1,223건과 공고 목록 표시를 확인했다.
- 실제 Core 관리자 비밀번호 로그인·HttpOnly 쿠키·Core/Ops 동일 사용자·새로고침·평가 이력 12건·기존 완료 보고서 4개의 원본 해시를 확인했다. 로그아웃 뒤 익명 접근과 폐기한 세션 재사용이 모두 401로 거절됐다.
- 배포를 위해 잠시 추가한 개인 main 잠금은 해제했다. 기존 삭제·강제 푸시 방지 ruleset은 보존했다.

로컬 실행 증거는 Git에서 제외된 `work/web-release-20261011/`에 있다. 기존 관리자 비밀번호와
kubeconfig를 이 디렉터리로 복사하지 않았다. 실제 로그인 결과는 `actual-web-login.json`,
발행 receipt는 `web-image/web.json`, 배포 상태는 `runtime-final.json`에서 확인한다.

이번 완료 범위는 공개 이미지 기반의 **로컬 Kubernetes 웹 연결**이다. EKS 클러스터·외부
Ingress/ALB·DNS·TLS·AWS IAM 및 운영 스토리지 준비는 별도 단계다. `portfolio` 빌드를 사용했으며
유료 평가나 모델 품질 측정은 실행하지 않았다.
