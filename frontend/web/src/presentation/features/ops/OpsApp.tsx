import { createRequestId } from './requestId'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, Navigate, Route, Routes, useLocation, useNavigate, useParams, useSearchParams } from 'react-router'
import { cancelEvaluation, getEvaluation, getEvaluationCatalog, getOpsSession, listEvaluations, OpsApiError, reassessEvaluation, recoverEvaluation, submitEvaluation } from '../../../data/ops/opsApi'
import { appContainer } from '../../../app/appContainer'
import { useAppDispatch } from '../../../app/hooks'
import { signedOut } from '../../shared/auth/state/authSlice'
import { loginPathFor } from '../../shared/auth/returnPath'
import { readPendingEvaluation, storePendingEvaluation, clearPendingEvaluation } from '../../../data/ops/pendingEvaluation'
import type { EvaluationPage, EvaluationRun, EvaluationCatalog, OpsSession, EvaluationSubmission } from '../../../data/ops/opsApi'
import { workspacePageStyles as styles, workspaceTagClassName } from '../../shared/workspace/WorkspacePage.styles'
import { RagComparisonResult } from './RagComparisonResult'
import { RagMaterialPanel } from './RagMaterialPanel'
import { EvaluationReviewPanel } from './EvaluationReviewPanel'
import { EvaluationDatasetPicker } from './EvaluationDatasetPicker'
import { EvaluationHelp } from './EvaluationHelp'
import { BudgetOverview, RunBudgetPanel } from './BudgetPanel'
import { LiveReadinessPanel } from './LiveReadinessPanel'
import { EvaluationSchedulesPanel } from './EvaluationSchedulesPanel'
import { ScheduleSettingsPanel } from './ScheduleSettingsPanel'
import { WorkspacePageHeader } from '../../shared/workspace/WorkspacePageHeader'
import { PerformanceDashboard } from './PerformanceDashboard'
import { EvaluationReport } from './EvaluationReport'
import { AdminAiCostsPage } from '../admin/view/AdminAiCostsPage'
import { EvaluationLogsPanel } from './EvaluationLogsPanel'
import { TraceDetailPage, TraceListPage } from './TracePages'
import { ProductionQualityPage } from './ProductionQualityPage'
import { DatasetManagementPage } from './DatasetManagementPage'
import { MonitoringOverview } from './MonitoringOverview'
import { MonitoringDetailPage, type MonitoringSection } from './MonitoringDetailPage'
import { MonitoringDemoProvider } from './MonitoringDemoContext'

const dashboardPath = '/ops/dashboard'
const listPath = '/ops/evaluations'
const field = 'min-h-11 w-full rounded-xl border border-line bg-white px-3 text-sm focus:outline-2 focus:outline-brand-primary'
const date = (value: string | null) => value ? new Date(value).toLocaleString('ko-KR') : '—'
const message = (error: unknown) => error instanceof Error ? error.message : '요청을 처리하지 못했습니다.'
const evaluationProblem = (code: string) => ({
  PREFECT_CANCEL_UNCONFIRMED: '취소가 끝났는지 확인하지 못했어요. 상태를 다시 확인해 주세요.',
  EXECUTION_SPEC_REQUIRED: '이전 요청에 필요한 정보가 없어요. 새 평가를 만들어 주세요.',
  EXECUTION_SPEC_MISMATCH: '평가 설정이 바뀌어 시작하지 못했어요. 설정을 확인한 뒤 새 평가를 만들어 주세요.',
  PREFECT_DISPATCH_UNCONFIRMED: '요청이 접수됐는지 확인하지 못했어요. 접수를 다시 확인해 주세요.',
  PREFECT_STATUS_UNAVAILABLE: '평가 상태를 확인하지 못했어요. 잠시 후 다시 확인해 주세요.',
  RESULTS_UNAVAILABLE: '결과를 가져오지 못했어요. 다시 확인하고 계속되면 관리자에게 알려 주세요.',
  EVALUATION_FAILED: '평가가 중단됐어요. 작업 기록을 확인해 주세요.',
  EVALUATION_CRASHED: '평가가 중단됐어요. 작업 기록을 확인해 주세요.',
  EVALUATION_CANCELLED: '평가가 취소됐어요.',
} as Record<string, string>)[code] ?? '문제가 생겼어요. 자세한 내용은 아래 기록을 확인해 주세요.'
const recoveryBlockedMessage = (reason: string) => ({
  '진행 중인 복구 실행을 먼저 확인하세요.': '이미 진행 중인 결과 정리를 먼저 확인해 주세요.',
  '완료 응답·입력 무결성 또는 원본 평가기 버전의 호환성을 확인할 수 없습니다.': '필요한 자료나 설정을 확인하지 못해 결과를 다시 정리할 수 없어요.',
  '실행 종료 상태를 확인한 뒤 실패한 후처리만 복구할 수 있습니다.': '평가가 끝난 뒤 결과를 다시 정리할 수 있어요.',
} as Record<string, string>)[reason] ?? '지금은 결과를 다시 정리할 수 없어요. 자세한 내용은 관리자에게 확인해 주세요.'
const reassessmentBlockedMessage = (reason: string) => ({
  '같은 평가기로 재평가한 기록이 있습니다. 결과 또는 실패 원인을 확인해 주세요.': '이미 다시 평가한 기록이 있어요. 아래 기록을 확인해 주세요.',
  '진행 중인 복구 또는 재평가를 먼저 확인해 주세요.': '이미 진행 중인 작업을 먼저 확인해 주세요.',
  '평가의 종료 상태를 확인할 수 없어 재평가할 수 없습니다.': '평가가 끝났는지 확인한 뒤 다시 평가할 수 있어요.',
  '평가가 종료된 후 재평가할 수 있습니다.': '평가가 끝난 뒤 다시 평가할 수 있어요.',
  '저장된 응답과 재평가 입력을 확인할 수 없습니다.': '필요한 자료를 확인하지 못해 다시 평가할 수 없어요.',
} as Record<string, string>)[reason] ?? '지금은 다시 평가할 수 없어요. 자세한 내용은 관리자에게 확인해 주세요.'


function Status({ run }: { run: EvaluationRun }) {
  return <span className={workspaceTagClassName(run.error_code || ['FAILED', 'CRASHED', 'RESULT_ERROR'].includes(run.status) ? 'danger' : run.status === 'COMPLETED' ? 'ok' : 'info')}>{run.status_label}</span>
}

export function OpsApp() {
  useEffect(() => {
    const previous = document.title
    document.title = 'GovBiz · LLMOps 운영'
    return () => { document.title = previous }
  }, [])
  const dispatch = useAppDispatch()
  const [denied, setDenied] = useState(false)
  const [session, setSession] = useState<OpsSession | null>(null)
  const [error, setError] = useState('')
  const [reload, setReload] = useState(0)
  const [loggingOut, setLoggingOut] = useState(false)
  const location = useLocation()
  const navigate = useNavigate()
  useEffect(() => {
    const controller = new AbortController()
    getOpsSession(controller.signal).then((value) => {
      if (controller.signal.aborted) return
      if (!value.user) dispatch(signedOut())
      setSession(value); setDenied(false)
    }).catch((reason) => {
      if (controller.signal.aborted) return
      if (reason instanceof OpsApiError && reason.status === 401) {
        dispatch(signedOut()); setSession({ user: null, csrf_token: '', live_enabled: false, rag_live_enabled: false, search_traces_url: null })
      } else { setError(message(reason)); setDenied(reason instanceof OpsApiError && reason.status === 403) }
    })
    return () => controller.abort()
  }, [reload, dispatch])
  const expired = () => { setSession(null); setError(''); setReload((value) => value + 1) }
  const signOut = async () => {
    setLoggingOut(true)
    try {
      await appContainer.resolve('logOutUseCase').execute()
      dispatch(signedOut()); setSession(null); setError(''); setDenied(false)
      navigate(loginPathFor(location.pathname + location.search), { replace: true })
    }
    catch (reason) { setError(message(reason)) }
    finally { setLoggingOut(false) }
  }
  return <div className="flex min-h-dvh flex-col bg-[#f7f9f8] text-ink">
    <a href="#ops-main" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:bg-white focus:p-3">본문으로 건너뛰기</a>
    <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-white px-[clamp(1rem,5vw,4.5rem)] py-4">
      <Link to={dashboardPath} className="text-lg font-extrabold tracking-tight text-brand-primary">GovBiz <span className="ml-2 text-sm font-semibold text-ink-muted">LLMOps</span></Link>
      <nav aria-label="운영 메뉴" className="flex flex-wrap items-center gap-4 text-sm">
        <Link to="/" className={styles.mutedLink}>서비스 홈</Link>
        {session?.user && <Link to="/ops/traces" className={styles.mutedLink}>AI 실행 추적</Link>}
        {(session?.user || denied) && <><span>{session?.user?.username}</span><button className={styles.secondaryButton} onClick={() => void signOut()} disabled={loggingOut}>로그아웃</button></>}
      </nav>
    </header>
    {error && <div className="m-5 rounded-xl border border-red-200 bg-red-50 p-4" role="alert">{error} {!session && <button className={styles.secondaryButton} onClick={() => { setError(''); setReload((value) => value + 1) }}>연결 다시 확인</button>}</div>}
    {!session ? (!error && <p className="p-8" role="status">운영자 세션을 확인하고 있습니다.</p>)
      : !session.user ? <Navigate replace to={loginPathFor(location.pathname === '/ops/login' ? dashboardPath : location.pathname + location.search + location.hash)} />
        : <OpsWorkspace key={session.user.id} session={session} onExpired={expired} onReviewChanged={() => setReload((value) => value + 1)} />}

  </div>
}

type EvaluationDraft = { mode: 'replay' | 'live'; dataset: string; reference: string; candidate: string; model: string }
const liveOptions = (dataset: EvaluationCatalog['datasets'][number] | undefined) => dataset?.live_options
  ?? (dataset?.live_config && dataset.execution_profiles.live ? [{ live_config: dataset.live_config, execution_profile: dataset.execution_profiles.live }] : [])
const opsPageGroups = [
  { id: 'production', label: '운영', pages: [
    { path: '/ops/usage', label: '실사용 모니터링', description: '요청·모델·비용의 전체 현황' },
    { path: '/ops/traces', label: 'AI 실행 추적', description: '개별 실행 단계와 오류 조사' },
    { path: '/ops/production-quality', label: '운영 표본 품질', description: '저장 표본의 근거·답변 검토' },
  ] },
  { id: 'testing', label: '테스트', pages: [
    { path: dashboardPath, label: '성능 대시보드', description: '평가 지표와 변화 추이' },
    { path: listPath, label: '평가 이력', description: '결과 조회와 답변 검토' },
    { path: '/ops/datasets', label: '평가 자료 관리', description: '원문·질문·채점 조건 등록' },
    { path: `${listPath}/new`, label: '새 평가', description: '자료 선택과 실행 접수' },
    { path: '/ops/budget', label: '예산 관리', description: '평가 사용량과 한도 관리' },
    { path: '/ops/schedules', label: '정기 실행', description: '평가 일정과 중지 관리' },
  ] },
]
const opsPages = opsPageGroups.flatMap((group) => group.pages)

function OpsWorkspace({ session, onExpired, onReviewChanged }: { session: OpsSession; onExpired: () => void; onReviewChanged: () => void }) {
  const location = useLocation()
  const [draft, setDraft] = useState<EvaluationDraft | null>(null)
  const previousPath = useRef(location.pathname)
  const monitoringExample = (location.pathname === '/ops/usage' || location.pathname.startsWith('/ops/usage/'))
    && new URLSearchParams(location.search).get('example') === '1'
  const current = opsPages.find((page) => page.path === location.pathname)
    ?? opsPages.find((page) => page.path === (location.pathname.startsWith(listPath) ? listPath : location.pathname.startsWith('/ops/traces/') ? '/ops/traces' : location.pathname.startsWith('/ops/usage/') ? '/ops/usage' : dashboardPath))!
  const monitoringTitles: Record<string, string> = { requests: '요청과 서버 오류', jobs: '작업 결과', models: '모델 실행', traces: '추적 수집과 연결', costs: '사용량과 비용' }
  const monitoringSection = location.pathname.startsWith('/ops/usage/') ? location.pathname.slice('/ops/usage/'.length) : ''
  const title = monitoringTitles[monitoringSection] ?? (location.pathname.startsWith(`${listPath}/`) && location.pathname.endsWith('/report') ? 'Evidently 평가 보고서' : current.label)
  const legacyPath = location.pathname === listPath ? ({ '#new-evaluation': `${listPath}/new`, '#evaluation-budget': '/ops/budget', '#evaluation-schedules': '/ops/schedules' } as Record<string, string>)[location.hash] : undefined
  const compactEvaluationMenu = location.pathname === listPath || (location.pathname.startsWith(`${listPath}/`) && location.pathname !== `${listPath}/new` && !location.pathname.endsWith('/report'))
  useEffect(() => {
    document.title = `GovBiz · ${title}`
    if (previousPath.current !== location.pathname) {
      previousPath.current = location.pathname
      document.getElementById('ops-main')?.focus({ preventScroll: true })
      window.scrollTo({ top: 0, left: 0, behavior: 'instant' })
    }
  }, [location.pathname, title])
  return <div className="mx-auto grid w-full max-w-[1480px] min-w-0 flex-1 content-start lg:grid-cols-[208px_minmax(0,1fr)] lg:content-stretch">
    <aside className="border-b border-line bg-white lg:border-r lg:border-b-0">
      {compactEvaluationMenu && <details className="lg:hidden"><summary className="cursor-pointer px-5 py-3 text-sm font-semibold">운영 메뉴 보기</summary>
      <nav aria-label="운영 메뉴 목록" className="space-y-5 p-3 lg:sticky lg:top-0 lg:px-4 lg:py-8">
        {opsPageGroups.map((group) => <section key={group.id} aria-labelledby={`ops-mobile-menu-${group.id}`} className="border-t border-line pt-5 first:border-t-0 first:pt-0">
          <h2 id={`ops-mobile-menu-${group.id}`} className="mb-2 px-3 text-xs font-bold tracking-wide text-ink-muted">{group.label}</h2>
          <div className="grid grid-cols-2 gap-1 lg:grid-cols-1 lg:gap-2">
            {group.pages.map((page) => <Link key={page.path} to={page.path === '/ops/usage' && monitoringExample ? '/ops/usage?example=1' : page.path} aria-label={page.label} aria-current={current.path === page.path ? 'page' : undefined}
              className={`min-w-0 rounded-lg border-l-[3px] px-3 py-3 text-sm no-underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-primary ${current.path === page.path ? 'border-brand-primary bg-brand-soft font-bold text-brand-primary' : 'border-transparent text-ink-muted hover:bg-surface-muted hover:text-ink'}`}>
              <span className="block">{page.label}</span><span className="mt-1 hidden text-xs font-normal lg:block">{page.description}</span>
            </Link>)}
          </div>
        </section>)}
      </nav>
      </details>}
      <div className={compactEvaluationMenu ? 'hidden lg:block' : undefined}>
      <nav aria-label="LLMOps 작업 메뉴" className="space-y-5 p-3 lg:sticky lg:top-0 lg:px-4 lg:py-8">
        {opsPageGroups.map((group) => <section key={group.id} aria-labelledby={`ops-menu-${group.id}`} className="border-t border-line pt-5 first:border-t-0 first:pt-0">
          <h2 id={`ops-menu-${group.id}`} className="mb-2 px-3 text-xs font-bold tracking-wide text-ink-muted">{group.label}</h2>
          <div className="grid grid-cols-2 gap-1 lg:grid-cols-1 lg:gap-2">
            {group.pages.map((page) => <Link key={page.path} to={page.path === '/ops/usage' && monitoringExample ? '/ops/usage?example=1' : page.path} aria-label={page.label} aria-current={current.path === page.path ? 'page' : undefined}
              className={`min-w-0 rounded-lg border-l-[3px] px-3 py-3 text-sm no-underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-primary ${current.path === page.path ? 'border-brand-primary bg-brand-soft font-bold text-brand-primary' : 'border-transparent text-ink-muted hover:bg-surface-muted hover:text-ink'}`}>
              <span className="block">{page.label}</span><span className="mt-1 hidden text-xs font-normal lg:block">{page.description}</span>
            </Link>)}
          </div>
        </section>)}
      </nav>
      </div>
    </aside>
    <main id="ops-main" tabIndex={-1} className="min-w-0 focus-visible:outline-2 focus-visible:outline-brand-primary">
      {legacyPath ? <Navigate replace to={legacyPath} /> : <Routes>
        <Route path={dashboardPath} element={<PerformanceDashboard onExpired={onExpired} />} />
        <Route path="/ops/traces" element={<TraceListPage onExpired={onExpired} />} />
        <Route path="/ops/traces/:traceId" element={<TraceDetailPage key={location.pathname} onExpired={onExpired} />} />
        <Route path="/ops/production-quality" element={<ProductionQualityPage owner={session.user!.id} onExpired={onExpired} />} />
        <Route path="/ops/usage" element={<MonitoringRoute onExpired={onExpired} />} />
        <Route path="/ops/usage/:section" element={<MonitoringRoute onExpired={onExpired} />} />
        <Route path="/ops" element={<Navigate replace to={dashboardPath} />} />
        <Route path="/ops/evaluations" element={<EvaluationList onExpired={onExpired} />} />
        <Route path="/ops/datasets" element={<DatasetManagementPage owner={session.user!.id} onExpired={onExpired} />} />
        <Route path="/ops/evaluations/new" element={<EvaluationCatalogContent key="new" title="새 평가" onExpired={onExpired}>{(datasets) => <EvaluationCreate owner={session.user!.id} datasets={datasets} liveEnabled={session.live_enabled} ragLiveEnabled={session.rag_live_enabled} onExpired={onExpired} draft={draft} onDraftChange={setDraft} />}</EvaluationCatalogContent>} />
        <Route path="/ops/evaluations/:runId" element={<EvaluationDetail key={location.pathname} onExpired={onExpired} onReviewChanged={onReviewChanged} />} />
        <Route path="/ops/evaluations/:runId/report" element={<EvaluationReport key={location.pathname} onExpired={onExpired} />} />
        <Route path="/ops/budget" element={<><WorkspacePageHeader title="예산 관리" /><div className={styles.content}><BudgetOverview onExpired={onExpired} refreshKey={0} operatorId={session.user!.id} /></div></>} />
        <Route path="/ops/schedules" element={<EvaluationSchedulesPage owner={session.user!.id} onExpired={onExpired} />} />
        <Route path="*" element={<Navigate replace to={dashboardPath} />} />
      </Routes>}
    </main>
  </div>
}

function MonitoringRoute({ onExpired }: { onExpired: () => void }) {
  const { section } = useParams()
  const [search, setSearch] = useSearchParams()
  const example = search.get('example') === '1'
  const setExample = () => {
    const next = new URLSearchParams(search)
    if (example) next.delete('example'); else next.set('example', '1')
    setSearch(next, { replace: true })
  }
  const banner = <div className={`flex flex-wrap items-center justify-between gap-4 rounded-xl border px-4 py-4 ${example ? 'border-amber-300 bg-amber-50 text-amber-950' : 'border-line bg-white text-ink'}`}>
    <div className="min-w-0" role="status"><p className="m-0 text-base font-bold">{example ? '예시 화면을 보고 있습니다' : '저장된 데이터로 보고 있습니다'}</p><p className={`mt-1 mb-0 text-xs ${example ? 'text-amber-950' : 'text-ink-muted'}`}>{example ? '연습용 수치 · 실제 기록에 반영되지 않음' : '테스트 기록이 포함될 수 있음'}</p></div>
    <button type="button" aria-pressed={example} className={`${styles.secondaryButton} min-h-11`} onClick={setExample}>{example ? '실제 데이터로 돌아가기' : '예시 데이터로 살펴보기'}</button>
  </div>
  const modeKey = example ? 'example' : 'live'
  const back = example ? '/ops/usage?example=1' : '/ops/usage'
  if (section && !['requests', 'jobs', 'models', 'traces', 'costs'].includes(section)) return <Navigate replace to={back} />
  return <MonitoringDemoProvider enabled={example}>
    {!section ? <><WorkspacePageHeader title="실사용 모니터링" /><div className={styles.content}>{banner}<MonitoringOverview key={modeKey} onExpired={onExpired} /></div></>
      : section === 'costs' ? <AdminAiCostsPage key={modeKey} title="사용량과 비용" onExpired={onExpired} monitoringDetail monitoringBackTo={back}>{banner}</AdminAiCostsPage>
        : <MonitoringDetailPage key={modeKey} section={section as MonitoringSection} onExpired={onExpired} modeBanner={banner} />}
  </MonitoringDemoProvider>
}

// 자료가 필요한 화면에 진입할 때만 조회한다. 경로·계정이 바뀌면 진행 중인 조회를 취소한다.
function EvaluationCatalogContent({ title, onExpired, children, embedded = false }: {
  title: string; onExpired: () => void; children: (datasets: EvaluationCatalog['datasets']) => ReactNode; embedded?: boolean;
}) {
  const [catalog, setCatalog] = useState<EvaluationCatalog | null>(null)
  const [error, setError] = useState('')
  const [revision, setRevision] = useState(0)
  const expiry = useRef(onExpired); expiry.current = onExpired
  useEffect(() => {
    const controller = new AbortController()
    setCatalog(null); setError('')
    getEvaluationCatalog(controller.signal).then((value) => {
      if (!controller.signal.aborted) setCatalog(value)
    }).catch((reason) => {
      if (controller.signal.aborted) return
      if (reason instanceof OpsApiError && [401, 403].includes(reason.status)) expiry.current()
      else setError(message(reason))
    })
    return () => controller.abort()
  }, [revision])
  if (catalog) return children(catalog.datasets)
  const fallback = error ? <section className={styles.card} aria-label="평가 자료 조회 오류">
      <p role="alert">평가 자료를 불러오지 못했습니다. {error}</p>
      <button className={`${styles.secondaryButton} mt-3`} onClick={() => setRevision((value) => value + 1)}>평가 자료 다시 불러오기</button>
    </section> : <p role="status">평가 자료와 실행 조건을 불러오고 있습니다. 다른 운영 메뉴는 이용할 수 있습니다.</p>
  return embedded ? fallback : <><WorkspacePageHeader title={title} /><div className={styles.content}>{fallback}</div></>
}

function EvaluationSchedulesPage({ owner, onExpired }: { owner: string; onExpired: () => void }) {
  const [revision, setRevision] = useState(0)
  return <><WorkspacePageHeader title="정기 실행" /><div className={styles.content}>
    <ScheduleSettingsPanel owner={owner} onExpired={onExpired} onSaved={() => setRevision((value) => value + 1)} />
    <EvaluationCatalogContent title="정기 실행" onExpired={onExpired} embedded>{(datasets) =>
      <EvaluationSchedulesPanel owner={owner} datasets={datasets} onExpired={onExpired} refreshKey={revision} />
    }</EvaluationCatalogContent>
  </div></>
}

function EvaluationList({ onExpired }: { onExpired: () => void }) {
  const [search, setSearch] = useSearchParams()
  const pageValue = Number(search.get('page') ?? 1)
  const page = Number.isInteger(pageValue) && pageValue > 0 ? pageValue : 1
  const [data, setData] = useState<EvaluationPage | null>(null)
  const [error, setError] = useState('')
  const [refresh, setRefresh] = useState(0)
  const expiry = useRef(onExpired); expiry.current = onExpired
  useEffect(() => {
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    setError(''); setData(null)
    const read = async () => {
      let keepPolling = true
      try {
        const value = await listEvaluations(page, controller.signal)
        if (!controller.signal.aborted) { setData(value); setError('') }
      } catch (reason) {
        if (controller.signal.aborted) return
        if (reason instanceof OpsApiError && [401, 403].includes(reason.status)) {
          keepPolling = false; expiry.current()
        } else setError(message(reason))
      } finally {
        if (!controller.signal.aborted && keepPolling) timer = setTimeout(() => void read(), 5_000)
      }
    }
    void read()
    return () => { controller.abort(); clearTimeout(timer) }
  }, [page, refresh])
  return <>
    <WorkspacePageHeader title="평가 이력" actions={<><button className={styles.secondaryButton} onClick={() => setRefresh((value) => value + 1)}>목록 새로고침</button><Link className={styles.primaryButton} to={`${listPath}/new`}>새 평가 만들기</Link></>} />
    <div className={styles.content}>
      <section id="evaluation-history" className={`${styles.card} scroll-mt-28`} aria-label="평가 실행 이력">
        <h2 className={styles.cardTitle}>실행 이력{data ? ` · ${data.count}건` : ''}</h2>
        <p className={styles.cardDescription}>자료를 선택하면 자세한 결과를 볼 수 있어요. 실행 완료가 품질 합격을 뜻하지는 않아요.</p>
        {error && <p role="alert" className="text-sm text-red-700">{error} 기존 결과가 있으면 마지막으로 받은 상태를 유지합니다.</p>}
        {!data ? (!error && <p role="status">실행 이력을 불러오고 있습니다.</p>) : !data.results.length ? <p className="py-8 text-center text-sm text-ink-muted">아직 실행한 평가가 없습니다. 새 평가에서 자료와 실행 방식을 선택해 시작하세요.</p> : <>
          <div aria-hidden="true" className="hidden grid-cols-[minmax(0,2fr)_minmax(7rem,1fr)_minmax(0,1fr)_minmax(10rem,1fr)] gap-4 border-b border-line px-4 pb-2 text-xs font-semibold text-ink-muted lg:grid"><span>평가 자료와 방법</span><span>진행 상태</span><span>요청한 사람</span><span>요청한 시간</span></div>
          <ul aria-label="평가 실행 목록" className="m-0 grid list-none gap-3 p-0 lg:gap-0">
            {data.results.map((run, index) => <li key={run.id} className="grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(0,8rem)] gap-x-3 gap-y-4 rounded-xl border border-line p-4 lg:grid-cols-[minmax(0,2fr)_minmax(7rem,1fr)_minmax(0,1fr)_minmax(10rem,1fr)] lg:items-center lg:gap-4 lg:rounded-none lg:border-0 lg:border-b lg:border-line last:lg:border-b-0">
              <div className="min-w-0">
                <Link className="inline-flex min-h-11 items-center font-semibold leading-6 break-words text-brand-primary underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-primary [overflow-wrap:anywhere]" to={`${listPath}/${run.id}`} aria-label={`${run.dataset_label} · ${date(run.created_at)} · ${run.status_stale ? '상태 확인 지연, 마지막 상태 ' : ''}${run.status_label} · ${index + 1}번째 기록 상세 보기`}>{run.dataset_label}</Link>
                <p className="mt-1 text-sm text-ink-muted [overflow-wrap:anywhere]">{run.recovery_kind === 'reassessment' ? '저장 답변 다시 평가' : run.execution_mode === 'recovery' ? '기존 결과 다시 정리' : run.execution_mode === 'live' ? '새 답변 생성' : '저장 답변 다시 확인'}{run.execution_mode === 'live' && run.live_config?.model ? ` · ${run.live_config.model}` : ''}</p>
              </div>
              <div className="min-w-0 text-right lg:text-left">
                {run.status_stale ? <p className="mb-1 text-xs text-ink-muted">마지막 상태</p> : <span className="sr-only">진행 상태: </span>}
                <Status run={run} />
                {run.status_stale && <><p className="mt-1 text-xs font-semibold text-amber-800">상태 확인 지연 · 현재 상태 미확정</p><p className="mt-1 text-xs text-ink-muted">마지막 확인: {run.synced_at ? date(run.synced_at) : '아직 확인되지 않음'}</p></>}
                {!run.status_stale && run.error_message && <p className="mt-1 text-xs text-ink-muted">자세한 내용은 결과에서 확인하세요.</p>}
              </div>
              <div className="col-span-2 grid min-w-0 gap-2 lg:contents">
                <div className="grid min-w-0 grid-cols-[4.75rem_minmax(0,1fr)] gap-3 lg:block"><p className="text-xs text-ink-muted lg:sr-only">요청자</p><p className="text-sm break-words [overflow-wrap:anywhere]">{run.requested_by || '기록 없음'}</p></div>
                <div className="grid min-w-0 grid-cols-[4.75rem_minmax(0,1fr)] gap-3 lg:block"><p className="text-xs text-ink-muted lg:sr-only">요청 시각</p><p className="text-sm break-words">{date(run.created_at)}</p></div>
              </div>
            </li>)}
          </ul>
        </>}
        {data && <nav aria-label="평가 이력 페이지" className="mt-3 flex items-center justify-end gap-3 text-sm"><button className={styles.secondaryButton} disabled={!data.previous} onClick={() => setSearch({ page: String(page - 1) })}>이전</button><span>{page} / {Math.max(1, Math.ceil(data.count / 25))}</span><button className={styles.secondaryButton} disabled={!data.next} onClick={() => setSearch({ page: String(page + 1) })}>다음</button></nav>}
      </section>
    </div>
  </>
}

function EvaluationCreate({ owner, datasets, liveEnabled: allLiveEnabled, ragLiveEnabled, onExpired, draft, onDraftChange }: {
  owner: string; datasets: EvaluationCatalog['datasets']; liveEnabled: boolean; ragLiveEnabled: boolean; onExpired: () => void;
  draft: EvaluationDraft | null; onDraftChange: (draft: EvaluationDraft) => void;
}) {
  const [restored] = useState(() => {
    try { return { pending: readPendingEvaluation(owner), error: '' } }
    catch { return { pending: null, error: '보관한 요청을 읽을 수 없습니다. 이 탭의 요청 기록과 실행 이력을 확인해야 새 평가를 접수할 수 있습니다.' } }
  })
  const [pending, setPending] = useState<EvaluationSubmission | null>(restored.pending)
  const [storageError, setStorageError] = useState(restored.error)
  const [rejected, setRejected] = useState(false)
  const [budgetRejected, setBudgetRejected] = useState(false)
  const [confirmDiscardPending, setConfirmDiscardPending] = useState(false)
  const [submitError, setSubmitError] = useState('')
  const [busy, setBusy] = useState(false)
  const [step, setStep] = useState<1 | 2 | 3>(restored.pending ? 3 : 1)
  const stepHeading = useRef<HTMLHeadingElement>(null)
  const firstStepRender = useRef(true)
  useEffect(() => {
    if (firstStepRender.current) { firstStepRender.current = false; return }
    stepHeading.current?.focus()
  }, [step])
  const [mode, setMode] = useState<'replay' | 'live'>(restored.pending ? restored.pending.live_config ? 'live' : 'replay' : draft?.mode ?? 'replay')
  const [approved, setApproved] = useState(!!restored.pending?.live_config)
  const [dataset, setDataset] = useState(restored.pending?.dataset_id ?? draft?.dataset ?? '')
  const selected = datasets.find((item) => item.id === dataset)
  const options = liveOptions(selected)
  const [model, setModel] = useState(restored.pending?.live_config?.model ?? draft?.model ?? options[0]?.live_config.model ?? '')
  const selectedOption = options.find((option) => option.live_config.model === model)
  const liveConfig = pending?.live_config ?? selectedOption?.live_config
  const liveProfile = selectedOption?.execution_profile
  const supported = selected?.evaluation_scope === 'fixed-answer-context-only' || selected?.evaluation_scope === 'source-chunks-retrieval-answer'
  const ragLive = selected?.evaluation_scope === 'source-chunks-retrieval-answer' && mode === 'live'
  const liveEnabled = allLiveEnabled && (!ragLive || ragLiveEnabled)
  const canGenerate = supported && options.length > 0
  const [reference, setReference] = useState(restored.pending?.reference_capture_id ?? draft?.reference ?? '')
  const [candidate, setCandidate] = useState(restored.pending?.candidate_capture_id ?? draft?.candidate ?? '')
  const changeDataset = (id: string) => {
    const value = datasets.find((item) => item.id === id)
    if (!liveOptions(value).length) setMode('replay')
    if (!model) setModel(liveOptions(value)[0]?.live_config.model ?? '')
    setApproved(false); setDataset(id); setReference(value?.baseline?.id ?? value?.captures[0]?.id ?? ''); setCandidate(value?.captures.at(-1)?.id ?? '')
  }
  useEffect(() => { onDraftChange({ mode, dataset, reference, candidate, model }) }, [mode, dataset, reference, candidate, model, onDraftChange])
  useEffect(() => { if (!pending) setApproved(false) }, [dataset, model, liveProfile, pending])
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const requestId = useRef<string | null>(restored.pending?.request_id ?? null)
  const submitting = useRef(false)
  const navigate = useNavigate()
  const expiry = useRef(onExpired); expiry.current = onExpired
  const finish = useCallback((value: EvaluationRun, request: EvaluationSubmission) => {
    if (value.id !== request.request_id || value.requested_by_id !== owner) throw new Error('접수된 요청의 식별자와 계정이 일치하지 않습니다.')
    if (!mounted.current) return
    clearPendingEvaluation(owner, request.request_id)
    navigate(`${listPath}/${value.id}`)
  }, [owner, navigate])
  // 재진입은 조회만 수행한다. 서버에 아직 없더라도 자동으로 유료 요청을 전송하지 않는다.
  useEffect(() => {
    if (!restored.pending) return
    const controller = new AbortController()
    setBusy(true)
    getEvaluation(restored.pending.request_id, controller.signal).then((value) => {
      if (!controller.signal.aborted) finish(value, restored.pending!)
    }).catch((reason) => {
      if (controller.signal.aborted) return
      if (reason instanceof OpsApiError && [401, 403].includes(reason.status)) expiry.current()
      else setSubmitError(reason instanceof OpsApiError && reason.status === 404
        ? '아직 접수된 요청을 찾지 못했습니다. 보관한 조건과 같은 요청으로 재확인할 수 있습니다.' : message(reason))
    }).finally(() => { if (!controller.signal.aborted) setBusy(false) })
    return () => controller.abort()
  }, [restored, finish])
  const submit = async () => {
    if (step !== 3 || submitting.current || busy || storageError || (!pending && mode === 'live' && (!approved || !liveEnabled || !canGenerate || !selectedOption))) return
    if (!pending && (!supported || !(mode === 'live' ? liveProfile : selected?.execution_profiles.replay))) return
    submitting.current = true; setBusy(true); setSubmitError(''); setRejected(false); setBudgetRejected(false)
    try {
      let request = pending ?? readPendingEvaluation(owner)
      const retrying = request !== null
      if (!request) {
        request = {
          request_id: createRequestId(), dataset_id: dataset,
          execution_profile: mode === 'live' ? liveProfile! : selected!.execution_profiles.replay,
          candidate_capture_id: mode === 'live' ? 'new-model-response' : candidate,
          reference_capture_id: reference, live_config: mode === 'live' ? selectedOption!.live_config : null,
          baseline_version: reference === selected?.baseline?.id ? selected.baseline.version : null,
        }
        try { storePendingEvaluation(owner, request) }
        catch { setStorageError('요청을 보관할 수 없어 전송하지 않았습니다. 브라우저의 탭 저장소를 확인하세요.'); return }
      }
      requestId.current = request.request_id; setPending(request)
      if (retrying) {
        try { finish(await getEvaluation(request.request_id), request); return }
        catch (reason) { if (!(reason instanceof OpsApiError && reason.status === 404)) throw reason }
      }
      const run = await submitEvaluation(request.request_id, request.dataset_id, request.candidate_capture_id,
        request.reference_capture_id, request.live_config, request.baseline_version, owner, request.execution_profile)
      finish(run, request)
    } catch (reason) {
      if (reason instanceof OpsApiError && [401, 403].includes(reason.status)) expiry.current()
      else {
        const wasRejected = reason instanceof OpsApiError && reason.status === 400
        setRejected(wasRejected)
        setBudgetRejected(wasRejected && reason.code === 'LIVE_BUDGET_UNAVAILABLE')
        setSubmitError(wasRejected ? `${message(reason)} 접수되지 않은 조건을 다시 선택할 수 있습니다.` : `${message(reason)} 재시도할 때 보관한 요청을 사용합니다.`)
      }
    } finally { submitting.current = false; setBusy(false) }
  }
  const discardPending = () => {
    if (!pending || busy || submitting.current) return
    try {
      const stored = readPendingEvaluation(owner)
      if (stored && stored.request_id !== pending.request_id) throw new Error('다른 요청이 보관되어 있습니다.')
      clearPendingEvaluation(owner, pending.request_id)
      requestId.current = null
      setPending(null); setConfirmDiscardPending(false); setSubmitError(''); setStorageError('')
      setRejected(false); setBudgetRejected(false); setApproved(false); setStep(1)
      setMode('replay'); setDataset(''); setModel(''); setReference(''); setCandidate('')
    } catch {
      setStorageError('보관 기록을 지우지 못했습니다. 평가 이력을 확인한 뒤 다시 시도해 주세요.')
    }
  }
  const reselect = () => {
    if (!rejected || !pending) return
    try { clearPendingEvaluation(owner, pending.request_id); onExpired() }
    catch { setStorageError('접수되지 않은 요청 기록을 정리하지 못했습니다. 탭 저장소를 확인하세요.') }
  }
  return <>
    <WorkspacePageHeader title="새 평가" actions={<Link className={styles.secondaryButton} to="/ops/datasets">평가 자료 등록·관리</Link>} />
    <div className={styles.content}>
      <section id="new-evaluation" className={`${styles.card} scroll-mt-28`} aria-label="평가 실행">
        <h2 className="text-xl font-bold leading-snug text-ink sm:text-2xl">평가 준비하기</h2>
        {pending && <div className="space-y-3 rounded-xl bg-amber-50 p-4 text-sm leading-6" role="status">
          <p className="font-semibold">이전에 보낸 평가 요청을 확인하고 있어요</p>
          <p>요청이 접수됐는지 확인할 수 없다면 평가 이력에서 먼저 살펴봐 주세요.</p>
          <div className="flex flex-wrap gap-2"><Link className={styles.secondaryButton} to={listPath}>평가 이력 보기</Link>
            {!confirmDiscardPending && <button type="button" className={styles.secondaryButton} disabled={busy} onClick={() => setConfirmDiscardPending(true)}>요청 보관 종료</button>}
          </div>
          {confirmDiscardPending && <div className="space-y-3 rounded-lg bg-white p-3">
            <p className="font-semibold">이 탭에 보관된 요청 기록을 지울까요?</p>
            <p>서버에 이미 접수된 평가는 취소되지 않습니다. 아직 확인되지 않은 요청이 나중에 접수될 수도 있으니 평가 이력을 확인해 주세요.</p>
            <div className="flex flex-wrap gap-2"><button type="button" className={styles.primaryButton} disabled={busy} onClick={discardPending}>보관 기록 지우기</button><button type="button" className={styles.secondaryButton} onClick={() => setConfirmDiscardPending(false)}>돌아가기</button></div>
          </div>}
          <details><summary className="cursor-pointer font-medium">보관된 요청 정보</summary><p className="mt-2 break-all">요청 번호: {pending.request_id}</p><p>{pending.dataset_id} · 기준 {pending.reference_capture_id}{pending.baseline_version ? ` · 기준 버전 ${pending.baseline_version}` : ''} · {pending.live_config ? `${pending.live_config.model} · 최대 ${pending.live_config.max_model_calls}회 · 출력 ${pending.live_config.max_output_tokens}토큰/회 · 입력 ${pending.live_config.max_input_tokens ?? '기록 없음'}토큰/회` : '저장 응답 재평가'}</p></details>
        </div>}
        {storageError && <p role="alert" className="text-sm text-red-700">{storageError}</p>}
        {submitError && <div role="alert" className="space-y-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm leading-6 text-red-800">
          {budgetRejected ? <>
            <p className="text-base font-bold">평가를 시작할 수 없어요</p>
            <p>사용 한도가 부족하거나 예산 상태를 확인해야 해요. 이번 평가는 접수되지 않았어요.</p>
            <p>예산 관리에서 전체·하루 한도를 확인한 뒤, 이 화면으로 돌아와 다시 실행해 주세요.</p>
            <Link className="inline-flex min-h-11 items-center rounded-lg bg-white px-4 font-semibold text-red-800 ring-1 ring-red-200 focus-visible:outline-2 focus-visible:outline-brand-primary" to="/ops/budget">예산 관리로 이동</Link>
          </> : <p>{submitError}</p>}
        </div>}
        {rejected && <button className={styles.secondaryButton} onClick={reselect}>접수되지 않은 조건 다시 선택</button>}
        <ol aria-label="평가 준비 단계" className="grid list-none gap-2 p-0 text-sm sm:grid-cols-3">
          {(['평가 자료', '답변 확인 방법', '비교 및 실행'] as const).map((label, index) => <li key={label} aria-current={step === index + 1 ? 'step' : undefined} className={`rounded-lg px-3 py-2 ${step === index + 1 ? 'bg-brand-primary font-bold text-white' : 'bg-surface-muted text-ink-muted'}`}><span className="mr-2">{index + 1}</span>{label}{step === index + 1 && <span className="sr-only"> · 현재 단계</span>}</li>)}
        </ol>
        <form className="grid min-w-0 grid-cols-1 gap-4 md:grid-cols-2" onSubmit={(event) => { event.preventDefault(); if (step === 3) void submit() }}>
          {step === 1 && <>
          <h3 ref={stepHeading} tabIndex={-1} className="border-t border-line pt-5 text-lg font-bold leading-snug sm:text-xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-primary md:col-span-2">1. 평가 자료 선택</h3>
          <EvaluationDatasetPicker datasets={datasets} value={dataset} disabled={busy || requestId.current !== null} onChange={changeDataset} />
          {dataset && !supported && <p className="text-sm text-amber-800 md:col-span-2">이 자료는 평가 범위를 확인할 수 없어 실행할 수 없습니다. 다른 자료를 선택해 주세요.</p>}
          <button type="button" className={`${styles.primaryButton} justify-self-start md:col-span-2`} disabled={!dataset || !supported || busy} onClick={() => setStep(2)}>다음: 답변 확인 방법</button>
          </>}
          {step === 2 && <>
          <h3 ref={stepHeading} tabIndex={-1} className="border-t border-line pt-5 text-lg font-bold leading-snug sm:text-xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-primary md:col-span-2">2. 답변 확인 방법 선택</h3>
          <p className="text-sm text-ink-muted md:col-span-2">선택한 자료: <strong className="text-ink">{selected?.selection_guide?.title ?? selected?.label}</strong> · 질문 {selected?.case_ids.length ?? 0}개</p>
          <fieldset className="min-w-0 md:col-span-2">
            <legend className="text-base font-semibold">답변을 확인하는 방법</legend>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <label className={`flex cursor-pointer items-start gap-3 rounded-xl border p-4 text-sm leading-6 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-brand-primary ${mode === 'replay' ? 'border-brand-primary bg-brand-soft' : 'border-line bg-white'}`}>
                <input type="radio" name="evaluation-mode" aria-label="기존 답변 다시 확인" value="replay" className="mt-1" checked={mode === 'replay'} disabled={busy || requestId.current !== null} onChange={() => { setMode('replay'); setApproved(false) }} />
                <span><strong className="block text-base text-ink">기존 답변 다시 확인</strong><span className="block text-ink-muted">저장된 답변을 비교합니다. 추가 AI 호출은 없습니다.</span><span className="mt-1 block text-ink-muted">현재 AI의 성능을 새로 측정하는 것은 아닙니다.</span></span>
              </label>
              <label className={`flex items-start gap-3 rounded-xl border p-4 text-sm leading-6 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-brand-primary ${!canGenerate ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'} ${mode === 'live' ? 'border-brand-primary bg-brand-soft' : 'border-line bg-white'}`}>
                <input type="radio" name="evaluation-mode" aria-label="새 응답 생성" value="live" className="mt-1" checked={mode === 'live'} disabled={!canGenerate || busy || requestId.current !== null} onChange={() => { setMode('live'); setApproved(false) }} />
                <span><strong className="block text-base text-ink">새 응답 생성</strong><span className="block text-ink-muted">선택한 모델로 새 답변을 만듭니다.</span><span className="mt-1 block text-amber-800">자료를 OpenAI에 전송하며 비용이 발생할 수 있습니다.</span>{!canGenerate && <span className="mt-1 block text-ink-muted">이 자료에서는 새 응답을 만들 수 없습니다.</span>}</span>
              </label>
            </div>
          </fieldset>
          {ragLive && <details className="text-sm leading-6 text-ink-muted md:col-span-2"><summary className="cursor-pointer font-semibold">검색과 AI 호출 상세 보기</summary><p className="mt-2">{ragLiveNotice(liveConfig)}</p></details>}
          {selected && <p className="text-sm md:col-span-2" role="status">확인 범위: {selected.evaluation_scope === 'fixed-answer-context-only' ? '미리 고른 공고 내용을 바탕으로 답변을 확인합니다. 여러 공고 중 알맞은 공고를 찾는 능력은 측정하지 않습니다.' : selected.evaluation_scope === 'source-chunks-retrieval-answer' ? (ragLive ? '정해진 공고 안에서 필요한 내용을 찾고 새 답변을 확인합니다. 실제 서비스의 공고 검색 성능은 측정하지 않습니다.' : '정해진 공고의 저장된 검색과 답변을 다시 확인합니다. 새로운 검색이나 답변 생성은 하지 않습니다.') : '평가할 범위를 확인할 수 없습니다.'}</p>}
          {mode === 'live' && <div className="grid min-w-0 grid-cols-1 gap-1 md:col-span-2">
            <EvaluationHelp label="평가 모델" title={<label htmlFor="evaluation-model" className="text-base font-semibold">평가 모델</label>}><p>한 번에 선택한 모델 하나를 평가합니다. 같은 평가 자료로 다른 모델도 실행하면 <Link className="text-brand-primary underline" to="/ops/dashboard">성능 대시보드</Link>에서 모델별 결과를 비교할 수 있습니다.</p></EvaluationHelp>
            <select id="evaluation-model" className={`${field} min-w-0 max-w-full !text-base`} value={model} disabled={busy || requestId.current !== null} onChange={(event) => { setModel(event.target.value); setApproved(false) }}>
              {!selectedOption && <option value={model} disabled>{model ? `${model} · ${pending ? '보관한 요청의 모델' : '현재 선택 불가'}` : '평가할 모델을 선택하세요'}</option>}
              {options.map((option) => <option key={option.live_config.model} value={option.live_config.model}>{option.live_config.model}</option>)}
            </select>
          </div>}
          {mode === 'live' && !pending && !selectedOption && <p role="alert" className="text-sm text-red-700 md:col-span-2">선택했던 모델을 현재 자료에서 사용할 수 없습니다. 허용된 평가 모델을 다시 선택하세요.</p>}
          {ragLive && <div className="md:col-span-2"><VectorPlan config={liveConfig} /></div>}
          {mode === 'live' && !liveEnabled && <p role="status" className="text-sm text-amber-800 md:col-span-2">새 응답 생성이 비활성화되어 있습니다. 실행기와 서버 설정을 확인하거나 기존 답변 확인을 선택해 주세요.</p>}
          <div className="flex flex-wrap gap-3 md:col-span-2">
            <button type="button" className={styles.secondaryButton} onClick={() => setStep(1)}>이전: 평가 자료</button>
            <button type="button" className={styles.primaryButton} disabled={busy || (mode === 'live' && (!liveEnabled || !selectedOption))} onClick={() => setStep(3)}>다음: 비교하고 실행</button>
          </div>
          </>}
          {step === 3 && <>
          <h3 ref={stepHeading} tabIndex={-1} className="border-t border-line pt-5 text-lg font-bold leading-snug sm:text-xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-primary md:col-span-2">3. 비교하고 실행</h3>
          <div className="grid min-w-0 grid-cols-1 content-start gap-1">
            <EvaluationHelp label="비교 기준 답변" title={<label htmlFor="evaluation-reference" className="text-base font-semibold">비교 기준 답변</label>}><p>선택한 답변과 비교할 기존 기록입니다. 비교 기준이라고 해서 정답으로 승인된 것은 아닙니다.</p></EvaluationHelp>
            <select id="evaluation-reference" className={`${field} min-w-0 max-w-full !text-base`} value={reference} disabled={busy || requestId.current !== null} onChange={(event) => setReference(event.target.value)}>{selected?.baseline && <option value={selected.baseline.id}>{selected.baseline.label}</option>}{selected?.captures.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select>
            <p className="text-sm leading-6 text-ink-muted">비교 기준은 정답 승인을 뜻하지 않습니다.</p>
          </div>
          {mode === 'replay' && <div className="grid min-w-0 grid-cols-1 content-start gap-1">
            <EvaluationHelp label="다시 확인할 답변" title={<label htmlFor="evaluation-candidate" className="text-base font-semibold">다시 확인할 답변</label>}><p>비교 기준 답변과 견줄 저장된 답변입니다. 같은 답변을 고르면 결과가 다시 계산되는지만 확인합니다.</p></EvaluationHelp>
            <select id="evaluation-candidate" className={`${field} min-w-0 max-w-full !text-base`} value={candidate} disabled={busy || requestId.current !== null} onChange={(event) => setCandidate(event.target.value)}>{selected?.captures.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select>
          </div>}
          <section aria-label="평가 설정 요약" className="min-w-0 rounded-xl border border-brand-primary bg-brand-soft p-4 text-sm leading-6 md:col-span-2">
            {selected ? <EvaluationHelp label="비교 범위" title={<h4 className="text-base font-bold">실행 전 선택한 내용을 확인하세요</h4>}><p>비교 범위: {selected.case_ids.join(', ')} · {selected.case_ids.length}건. {mode === 'live' ? '선택한 모델의 새 응답과 선택한 기준 응답을 비교합니다.' : reference === candidate ? '같은 저장 결과의 재현 검증입니다.' : '두 실행의 위 사례만 비교합니다. 원본의 다른 사례는 평가 범위에 포함하지 않습니다.'}</p></EvaluationHelp> : <h4 className="text-base font-bold">실행 전 선택한 내용을 확인하세요</h4>}
            <dl className="mt-3 grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2 [overflow-wrap:anywhere]">
              <div><dt className="text-ink-muted">평가 자료</dt><dd className="font-semibold break-words">{selected?.selection_guide?.title ?? selected?.label ?? '선택되지 않음'} · 질문 {selected?.case_ids.length ?? 0}개</dd></div>
              <div><dt className="text-ink-muted">확인 방법</dt><dd className="font-semibold">{mode === 'live' ? `새 응답 생성 · ${liveConfig?.model ?? '모델 선택 필요'}` : '기존 답변 다시 확인 · 추가 AI 호출 없음'}</dd></div>
              <div><dt className="text-ink-muted">비교 기준 답변</dt><dd className="font-semibold">{(selected?.baseline?.id === reference ? selected.baseline.label : selected?.captures.find((item) => item.id === reference)?.label) ?? '선택되지 않음'}</dd></div>
              {mode === 'replay' && <div><dt className="text-ink-muted">다시 확인할 답변</dt><dd className="font-semibold">{selected?.captures.find((item) => item.id === candidate)?.label ?? '선택되지 않음'}</dd></div>}
            </dl>
            {mode === 'replay' && reference && reference === candidate && <p className="mt-3 rounded-lg bg-white p-3 text-amber-800">같은 저장 답변을 비교합니다. 현재 AI 성능 측정이 아닌 재현 확인입니다.</p>}
            <p className="mt-3 text-ink-muted" aria-live="polite">{pending ? '같은 요청으로 재시도하여 접수 여부를 확인합니다.' : mode === 'live' ? !liveEnabled ? '현재 새 응답 생성이 비활성화되어 있습니다. 실행기와 서버 설정을 확인해 주세요.' : !selectedOption ? '사용할 평가 모델을 선택해 주세요.' : approved ? '전송 내용에 동의했습니다. 설정·예산을 점검하거나 새 응답 생성 및 평가를 실행하세요.' : '전송 내용과 최대 호출 예산을 확인하고 동의해 주세요. 설정·예산은 실행 전에 점검할 수 있습니다.' : '비교할 두 답변을 확인한 뒤 평가를 실행하세요. 추가 AI 호출은 없습니다.'}</p>
          </section>
          {mode === 'live' && selected && liveConfig && <div className="min-w-0 rounded-xl border border-amber-200 md:col-span-2 bg-amber-50 p-4 text-sm leading-6">
            <p>모델: <strong>{liveConfig.model}</strong> · 최대 {liveConfig.max_model_calls}회 · 호출당 출력 최대 {liveConfig.max_output_tokens.toLocaleString()}토큰 · 호출당 입력 최대 {liveConfig.max_input_tokens?.toLocaleString() ?? '기록 없음'}토큰 · 자동 재호출 없음</p>
            {ragLive && <p>임베딩: {liveConfig.embedding_model} · {liveConfig.embedding_dimensions}차원. 최대 호출 수에는 새로 만드는 청크·질문 임베딩과 답변만 포함됩니다. 재사용하는 청크 벡터에는 임베딩 호출을 예약하지 않습니다. 전체 입력 예약 {liveConfig.max_total_input_tokens?.toLocaleString()}토큰 · 전체 출력 예약 {liveConfig.max_total_output_tokens?.toLocaleString()}토큰.</p>}
            <p>각 답변 생성 전에 같은 입력과 응답 형식을 OpenAI 입력 토큰 계산 API로 전송합니다. 계산 실패 또는 입력 상한 초과 시 생성을 중단합니다.</p>
            <p>전송 자료: {selected.fixture}의 {selected.case_ids.join(', ')} 질문과 등록된 공고 내용. 시스템 답변 지침을 함께 전송합니다. 자료에 따라 실제 공고의 저장 본문 또는 가상 근거를 사용하며, 실제 회원 대화는 사용하지 않습니다.</p>
            {!liveEnabled && <p role="status" className="font-semibold">새 모델 평가가 비활성화되어 있습니다. 실행기의 API 키와 서버 설정을 준비해야 합니다.</p>}
            <label className="mt-3 flex items-start gap-2"><input type="checkbox" className="mt-1" checked={approved} disabled={!liveEnabled || busy || requestId.current !== null} onChange={(event) => setApproved(event.target.checked)} />위 자료의 OpenAI 전송과 최대 호출 예산을 확인했습니다.</label>
          </div>}
          {mode === 'live' && !pending && liveProfile && <div className="min-w-0 md:col-span-2"><LiveReadinessPanel key={`${dataset}:${model}:${liveProfile}`} datasetId={dataset} executionProfile={liveProfile} model={model} onExpired={onExpired} /></div>}
          {!pending && (!reference || !candidate) && <p role="status" className="text-sm text-amber-800 md:col-span-2">비교할 저장 답변이 없습니다. 이전 단계에서 다른 평가 자료를 선택해 주세요.</p>}
          <div className="flex flex-wrap gap-3 md:col-span-2">
            {!pending && <button type="button" className={styles.secondaryButton} disabled={busy} onClick={() => setStep(2)}>이전: 답변 확인 방법</button>}
            <button type="submit" className={styles.primaryButton} disabled={busy || !!storageError || rejected || (!pending && (!supported || !dataset || !reference || !candidate || (mode === 'live' && (!approved || !liveEnabled || !canGenerate || !selectedOption))))}>{busy ? '접수 중…' : pending ? '같은 요청으로 재시도' : mode === 'live' ? '새 응답 생성 및 평가' : '평가 실행'}</button>
          </div>
          </>}
        </form>
      </section>
    </div>
  </>
}

function EvaluationDetailSection({ title, label, children }: { title: string; label?: string; children: ReactNode }) {
  return <details aria-label={label} className="group min-w-0 rounded-[1.4rem] border border-line bg-white shadow-[0_8px_24px_rgb(32_33_36_/_4%)]">
    <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-[1.35rem] py-4 font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-primary [&::-webkit-details-marker]:hidden">
      <span className="min-w-0">{title}</span><span aria-hidden="true" className="shrink-0 text-xs text-brand-primary"><span className="group-open:hidden">펼치기 +</span><span className="hidden group-open:inline">접기 −</span></span>
    </summary>
    <div className="grid min-w-0 gap-4 border-t border-line p-[1.35rem]">{children}</div>
  </details>
}

function EvaluationDetail({ onExpired, onReviewChanged }: { onExpired: () => void; onReviewChanged: () => void }) {
  const { runId = '' } = useParams()
  const navigate = useNavigate()
  const cancelInFlight = useRef(false)
  const readVersion = useRef(0)
  const [cancelError, setCancelError] = useState('')
  const recoveryRequest = useRef<{ source: string; id: string } | null>(null)
  const reassessmentRequest = useRef<{ source: string; id: string } | null>(null)
  const reassessmentInFlight = useRef(false)
  const [run, setRun] = useState<EvaluationRun | null>(null)
  const [error, setError] = useState('')
  const [refresh, setRefresh] = useState(0)
  const [busy, setBusy] = useState(false)
  const expiry = useRef(onExpired); expiry.current = onExpired
  const primaryAction = `${styles.primaryButton} min-h-11 !text-sm`
  const secondaryAction = `${styles.secondaryButton} min-h-11 !text-sm`
  const terminal = run !== null && ['COMPLETED', 'FAILED', 'CANCELLED', 'CRASHED'].includes(run.status)
  useEffect(() => {
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    const read = async () => {
      try {
        const version = readVersion.current
        const value = await getEvaluation(runId, controller.signal)
        if (controller.signal.aborted || version !== readVersion.current) return
        setRun(value); setError('')
        if ((value.prefect_flow_run_id || value.status === 'CANCELLING') && !['COMPLETED', 'FAILED', 'CANCELLED', 'CRASHED'].includes(value.status)) timer = setTimeout(() => void read(), 5_000)
      } catch (reason) {
        if (controller.signal.aborted) return
        if (reason instanceof OpsApiError && (reason.status === 401 || reason.status === 403)) expiry.current()
        else setError(message(reason))
      }
    }
    void read()
    return () => { controller.abort(); clearTimeout(timer) }
  }, [runId, refresh])
  const retry = async () => {
    if (!run || busy) return
    setBusy(true)
    try {
      setRun(run.execution_mode === 'recovery' && run.source_run_id
        ? await (run.recovery_kind === 'reassessment' ? reassessEvaluation : recoverEvaluation)(run.source_run_id, run.id)
        : await submitEvaluation(run.id, run.dataset_id, run.candidate_capture_id, run.reference_capture_id, run.live_config, run.baseline_version, undefined, run.execution_profile))
      setRefresh((value) => value + 1)
    }
    catch (reason) {
      if (reason instanceof OpsApiError && (reason.status === 401 || reason.status === 403)) expiry.current()
      else setError(message(reason))
    } finally { setBusy(false) }
  }
  const cancel = async () => {
    if (!run || busy || cancelInFlight.current) return
    cancelInFlight.current = true
    readVersion.current += 1
    setBusy(true); setCancelError('')
    try { setRun(await cancelEvaluation(run.id, run.requested_by_id)) }
    catch (reason) {
      if (reason instanceof OpsApiError && reason.status === 401) expiry.current()
      else setCancelError(`${message(reason)} 취소 접수 여부는 상태를 다시 확인하세요.`)
    } finally {
      cancelInFlight.current = false; setBusy(false); setRefresh((value) => value + 1)
    }
  }
  const recover = async () => {
    if (!run || busy) return
    if (recoveryRequest.current?.source !== run.id) recoveryRequest.current = { source: run.id, id: createRequestId() }
    setBusy(true)
    try {
      const result = await recoverEvaluation(run.id, recoveryRequest.current.id)
      setError(''); navigate(`${listPath}/${result.id}`)
    } catch (reason) {
      if (reason instanceof OpsApiError && (reason.status === 401 || reason.status === 403)) expiry.current()
      else setError(message(reason))
    } finally { setBusy(false) }
  }
  const reassess = async () => {
    if (!run || busy || reassessmentInFlight.current) return
    if (reassessmentRequest.current?.source !== run.id) reassessmentRequest.current = { source: run.id, id: createRequestId() }
    reassessmentInFlight.current = true; setBusy(true)
    try {
      const result = await reassessEvaluation(run.id, reassessmentRequest.current.id)
      setError(''); navigate(`${listPath}/${result.id}`)
    } catch (reason) {
      if (reason instanceof OpsApiError && (reason.status === 401 || reason.status === 403)) expiry.current()
      else setError(message(reason))
    } finally { reassessmentInFlight.current = false; setBusy(false) }
  }
  return <>
    <WorkspacePageHeader title="평가 실행 상세" parent={{ to: listPath, label: '실행 이력' }} actions={run && (run.status !== 'COMPLETED' || run.status_stale) ? <Status run={run} /> : undefined} />
    <div className={styles.content}>
      {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</p>}
      {!run ? error ? <button className={`${styles.secondaryButton} min-h-11 !text-sm self-start`} onClick={() => setRefresh((value) => value + 1)}>다시 불러오기</button> : <p role="status">평가를 불러오고 있습니다.</p> : <>
        <section className={styles.card} aria-label="이번 평가 한눈에 보기">
          <div className="flex flex-wrap items-center justify-between gap-2"><h2 className={styles.cardTitle}>{run.status_stale || run.error_code === 'PREFECT_STATUS_UNAVAILABLE' ? '현재 상태를 확인할 수 없어요' : run.status === 'COMPLETED' ? '평가가 끝났어요' : run.status === 'CANCELLED' ? '평가가 취소됐어요' : run.status === 'CANCELLING' ? '평가를 취소하고 있어요' : run.status === 'RESULT_ERROR' ? '결과를 불러오지 못했어요' : ['FAILED', 'CRASHED'].includes(run.status) ? '평가를 끝내지 못했어요' : '평가를 진행하고 있어요'}</h2></div>
          <p className="text-sm text-ink-muted">{run.dataset_label} · {date(run.created_at)}</p>
          {(run.status !== 'COMPLETED' || run.status_stale || run.error_code === 'PREFECT_STATUS_UNAVAILABLE') && <p role={run.status_stale || run.error_code === 'PREFECT_STATUS_UNAVAILABLE' || ['RESULT_ERROR', 'FAILED', 'CRASHED'].includes(run.status) ? 'alert' : undefined} className="text-sm leading-6">{run.status_stale || run.error_code === 'PREFECT_STATUS_UNAVAILABLE' ? '상태를 다시 확인해 주세요. 평가가 끝났는지는 아직 알 수 없어요.' : run.status === 'CANCELLED' ? '취소된 평가의 결과는 확인할 수 없습니다.' : run.status === 'CANCELLING' ? '취소가 끝날 때까지 기다려 주세요.' : run.status === 'RESULT_ERROR' ? evaluationProblem(run.error_code) : ['FAILED', 'CRASHED'].includes(run.status) ? (run.postprocessing?.can_recover ? '만들어진 답변으로 결과 정리를 다시 시도할 수 있어요.' : run.can_retry ? '평가 요청이 접수됐는지 다시 확인해 주세요.' : run.postprocessing?.can_reassess ? '저장된 답변을 다시 평가할 수 있어요.' : run.error_code ? evaluationProblem(run.error_code) : '오류 내용을 확인한 뒤 새 평가를 진행해 주세요.') : '완료되면 결과를 확인할 수 있어요.'}</p>}
          {run.status === 'COMPLETED' && (run.execution_mode === 'replay' || run.recovery_kind === 'reassessment' || run.execution_mode === 'recovery' || !['fixed-answer-context-only', 'source-chunks-retrieval-answer'].includes(run.evaluation_scope ?? '')) && <p className="text-sm leading-6 text-ink-muted">{run.execution_mode === 'replay' ? '저장된 답변을 확인한 결과예요. 현재 모델의 성능을 새로 측정한 것은 아니에요.' : run.recovery_kind === 'reassessment' ? '저장된 답변을 다시 평가했어요. AI를 추가로 호출하지 않았어요.' : run.execution_mode === 'recovery' ? '기존 답변으로 결과를 다시 정리했어요. AI를 추가로 호출하지 않았어요.' : null}{run.evaluation_scope !== 'fixed-answer-context-only' && run.evaluation_scope !== 'source-chunks-retrieval-answer' && ' 평가 범위를 확인할 수 없어요.'}</p>}
          {cancelError && <p role="alert" className="text-sm text-red-700">{cancelError}</p>}
          <div className="flex flex-wrap items-center gap-3">
            {run.can_retry && <button className={primaryAction} disabled={busy} onClick={() => void retry()}>{busy ? '확인 중…' : '접수 다시 확인'}</button>}
            {!run.status_stale && run.error_code !== 'PREFECT_STATUS_UNAVAILABLE' && run.postprocessing?.can_recover && <button className={primaryAction} disabled={busy} onClick={() => void recover()}>{busy ? '요청 중…' : '결과 정리 다시 시도'}</button>}
            {!run.status_stale && run.error_code !== 'PREFECT_STATUS_UNAVAILABLE' && run.status !== 'COMPLETED' && !run.can_retry && !run.postprocessing?.can_recover && run.postprocessing?.can_reassess && <button className={primaryAction} disabled={busy} onClick={() => void reassess()}>{busy ? '요청 중…' : '저장 답변 다시 평가'}</button>}
            {!run.status_stale && run.error_code !== 'PREFECT_STATUS_UNAVAILABLE' && !run.can_retry && !run.postprocessing?.can_recover && !run.postprocessing?.can_reassess && ['FAILED', 'CRASHED'].includes(run.status) && <Link className={primaryAction} to={`${listPath}/new`}>새 평가 만들기</Link>}
            {(run.status_stale || run.error_code === 'PREFECT_STATUS_UNAVAILABLE' || run.status === 'RESULT_ERROR' || !!error || !!cancelError || (!terminal && !run.prefect_flow_run_id && run.status !== 'CANCELLING' && !run.can_retry)) && <button className={secondaryAction} onClick={() => setRefresh((value) => value + 1)}>상태 다시 확인</button>}
          </div>
          {run.postprocessing?.can_recover && <p className="text-sm text-ink-muted">이미 만든 답변으로 결과를 정리합니다. 추가 AI 호출은 없습니다.</p>}
          {run.status !== 'COMPLETED' && !run.can_retry && !run.postprocessing?.can_recover && run.postprocessing?.can_reassess && <p className="text-sm text-ink-muted">저장된 답변을 다시 평가해 별도 기록으로 남겨요. AI를 추가로 호출하지 않아요.</p>}
          {(run.prefect_flow_run_id || run.status === 'CANCELLING') && !terminal && !error && <p className="text-xs text-ink-muted">상태를 자동으로 확인하고 있어요.</p>}
          {run.error_message && <details className="text-sm"><summary className="cursor-pointer font-semibold">문제 원인과 해결 방법</summary><p className="mt-2 leading-6">{evaluationProblem(run.error_code)}</p><details className="mt-3 text-ink-muted"><summary className="cursor-pointer">관리자용 원본 메시지</summary><p className="mt-2 whitespace-pre-wrap break-words">{run.error_message}</p></details></details>}
          {run.can_cancel && <details className="text-sm"><summary className="cursor-pointer font-semibold">평가 취소하기</summary><p className="my-2 text-ink-muted">앞으로의 AI 호출을 중단해요. 이미 시작된 호출에는 비용이 생길 수 있고, 확인되지 않은 사용량은 예산에 남아요.</p><button className={secondaryAction} disabled={busy} onClick={() => void cancel()}>평가 취소 요청</button></details>}
          {run.cancel_requested_at && <p role="status" className="text-sm text-ink-muted">취소 요청: {run.cancel_requested_by} · {date(run.cancel_requested_at)}{run.status === 'CANCELLING' ? ' · 종료 확인 중' : ''}</p>}
          <div className="grid gap-3">
            <details className="group rounded-xl border border-line">
              <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-semibold [&::-webkit-details-marker]:hidden">
                <span>평가 정보 보기</span><span aria-hidden="true" className="text-xs text-brand-primary"><span className="group-open:hidden">펼치기 +</span><span className="hidden group-open:inline">접기 −</span></span>
              </summary>
              <dl className="mx-4 mb-4 divide-y divide-line border-t border-line text-sm">
                {([
                  ['평가 방법', run.recovery_kind === 'reassessment' ? '저장된 답변 다시 평가' : run.execution_mode === 'recovery' ? '기존 답변으로 결과 정리' : run.execution_mode === 'live' ? '새 답변을 만들어 평가' : '저장된 답변 확인'],
                  ['확인한 범위', run.evaluation_scope === 'fixed-answer-context-only' ? '준비된 공고 내용으로 답변 확인' : run.evaluation_scope === 'source-chunks-retrieval-answer' ? '정해진 공고에서 내용 찾기와 답변 확인' : '기록 없음'],
                  ...(run.execution_mode === 'live' && run.live_config?.model ? [['답변 모델', run.live_config.model]] : []),
                  ['비교 기준', run.reference_label || '기록 없음'],
                  ['확인한 답변', run.candidate_label || '기록 없음'],
                  ['요청한 사람', run.requested_by || '기록 없음'],
                ] as [string, string][]).map(([label, value]) => <div className="grid min-w-0 grid-cols-[minmax(5rem,7rem)_minmax(0,1fr)] items-center gap-3 py-3" key={label}><dt className={`text-ink-muted ${label === '확인한 범위' ? 'self-start pt-3' : ''}`}>{label}</dt><dd className="min-w-0 font-semibold [overflow-wrap:anywhere]">{label === '확인한 범위' ? <EvaluationHelp label="확인한 범위" title={<span>{value}</span>}><p className="font-normal">{run.evaluation_scope === 'fixed-answer-context-only' ? '미리 준비한 공고 내용으로 답변을 확인해요. 실제 서비스의 공고 검색 성능은 측정하지 않았어요.' : run.evaluation_scope === 'source-chunks-retrieval-answer' ? '정해진 공고 안에서 내용을 찾고 답변한 결과를 확인해요. 실제 서비스의 공고 검색 성능은 측정하지 않았어요.' : '평가 범위가 기록되지 않아 무엇을 확인했는지 알 수 없어요.'}</p></EvaluationHelp> : value}</dd></div>)}
              </dl>
            </details>
            <details className="group rounded-xl border border-line">
              <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-semibold [&::-webkit-details-marker]:hidden">
                <span>관리자용 기술 정보</span><span aria-hidden="true" className="text-xs text-brand-primary"><span className="group-open:hidden">펼치기 +</span><span className="hidden group-open:inline">접기 −</span></span>
              </summary>
              <div className="grid min-w-0 gap-5 border-t border-line p-4 text-sm">
                <section aria-label="처리 시간">
                  <h3 className="font-semibold">처리 시간</h3>
                  <dl className="mt-2 divide-y divide-line">{([
                    ['요청 시각', date(run.created_at)], ['시작 시각', run.started_at ? date(run.started_at) : '기록 없음'],
                    ['종료 시각', run.finished_at ? date(run.finished_at) : '기록 없음'], ['마지막 상태 확인', run.synced_at ? date(run.synced_at) : '기록 없음'],
                  ] as [string, string][]).map(([label, value]) => <div key={label} className="grid min-w-0 grid-cols-[minmax(6rem,9rem)_minmax(0,1fr)] gap-3 py-2"><dt className="text-ink-muted">{label}</dt><dd className="min-w-0 [overflow-wrap:anywhere]">{value}</dd></div>)}</dl>
                </section>
                <section aria-label="평가 설정과 호출 한도">
                  <EvaluationHelp label="평가 설정과 호출 한도" title={<h3 className="font-semibold">평가 설정과 호출 한도</h3>}><p>호출 한도는 미리 허용한 최대치이며 실제 사용량과 다를 수 있어요. 토큰은 AI가 글을 처리할 때 사용하는 단위예요.</p></EvaluationHelp>
                  <dl className="divide-y divide-line">{([
                    ['AI 호출 시도', run.model_api_calls === null ? '아직 확인되지 않음' : `${run.model_api_calls}회`],
                    ...(run.live_config ? [
                      ['사용 모델', run.live_config.model], ['허용된 최대 호출', `${run.live_config.max_model_calls}회`],
                      ['한 번에 입력할 수 있는 양', run.live_config.max_input_tokens == null ? '기록 없음' : `${run.live_config.max_input_tokens}토큰`],
                      ['한 번에 출력할 수 있는 양', `${run.live_config.max_output_tokens}토큰`],
                    ] : []),
                    ...(run.execution_spec ? [
                      ['확인할 질문 번호', run.execution_spec.dataset.case_ids.join(', ') || '기록 없음'], ['평가기 버전', run.execution_spec.evaluation.sha256],
                      ...(run.recovery_kind === 'reassessment' ? [['원본에 기록된 평가기 버전', run.source_evaluator_version ?? '확인할 수 없음'], ['원본 접수 시 승인된 평가기 버전', run.source_approved_evaluator_version ?? '확인할 수 없음']] : []),
                      ...(run.execution_spec.generation ? [['프롬프트 버전', run.execution_spec.generation.prompt_sha256]] : []),
                    ] : []),
                  ] as [string, string][]).map(([label, value]) => <div key={label} className="grid min-w-0 grid-cols-[minmax(6rem,9rem)_minmax(0,1fr)] gap-3 py-2"><dt className="text-ink-muted">{label}</dt><dd className="min-w-0 [overflow-wrap:anywhere]">{value}</dd></div>)}</dl>
                  <VectorPlan config={run.live_config} />
                </section>
                <section aria-label="식별 번호">
                  <EvaluationHelp label="식별 번호" title={<h3 className="font-semibold">식별 번호</h3>}><p>문제 확인이나 기록 대조에 사용하는 번호예요. 설정 번호는 접수한 평가 설정이 같은지 확인할 때 사용해요.</p></EvaluationHelp>
                  <dl className="divide-y divide-line">{([
                    ['요청 번호', run.id], ['평가 설정 번호', run.execution_spec_sha256 ?? '기존 기록 · 설정 번호 없음'],
                    ['평가 결과 번호', run.evaluation_run_id ?? '결과 대기'],
                  ] as [string, string][]).map(([label, value]) => <div key={label} className="grid min-w-0 grid-cols-[minmax(6rem,9rem)_minmax(0,1fr)] gap-3 py-2"><dt className="text-ink-muted">{label}</dt><dd className="min-w-0 [overflow-wrap:anywhere]">{value}</dd></div>)}</dl>
                </section>
              </div>
            </details>
          </div>
        </section>
        {run.status === 'COMPLETED' && run.evaluation_scope !== 'source-chunks-retrieval-answer' && <section className={styles.card} aria-label="평가 결과">
          <h2 className={styles.cardTitle}>결과 요약</h2>
          <div className="grid gap-3 sm:grid-cols-3">{[
            { label: '확인한 질문', value: `${run.summary.observedCaseCount ?? '—'} / ${run.summary.caseCount ?? '—'}개`, help: '평가할 질문 중 결과를 확인한 질문 수예요.' },
            { label: '답변 여부가 예상과 일치', value: run.summary.statusAccuracy == null ? '미측정' : `${Number((run.summary.statusAccuracy * 100).toFixed(2))}%`, help: '답변했는지 또는 근거가 부족해 답변하지 않았는지가 예상과 일치한 비율이에요.' },
            { label: '필요한 근거 표시', value: run.summary.referenceCitationRecall == null ? '미측정' : `${Number((run.summary.referenceCitationRecall * 100).toFixed(2))}%`, help: '평가 자료에서 필요하다고 정한 근거를 답변에 표시한 비율이에요.' },
          ].map(({ label, value, help }) => <div className="min-w-0 rounded-xl bg-[#f3f7f5] p-4" key={label}><EvaluationHelp label={label} title={<p className="text-sm text-ink-muted">{label}</p>}><p>{help}</p></EvaluationHelp><strong className="mt-1 block text-2xl">{value}</strong></div>)}</div>
          <p className="text-sm text-ink-muted">자동 확인 결과예요. 답변과 공고 내용을 직접 확인해 주세요.</p>
        </section>}
        {run.status === 'COMPLETED' && run.evaluation_scope === 'source-chunks-retrieval-answer' && run.comparison?.schema_version === 3 && <RagComparisonResult comparison={run.comparison} />}
        {run.status === 'COMPLETED' && run.evaluation_scope === 'fixed-answer-context-only' && <EvaluationReviewPanel runId={run.id} onExpired={onExpired} onChanged={onReviewChanged} />}
        {run.status === 'COMPLETED' && run.evaluation_scope === 'source-chunks-retrieval-answer' && <RagMaterialPanel runId={run.id} onExpired={onExpired} onReviewChanged={onReviewChanged} />}
        {run.source_run_id && <Link className="text-sm font-semibold text-brand-primary underline" to={`${listPath}/${run.source_run_id}`}>원본 실행과 실패 기록 보기</Link>}
        <EvaluationDetailSection title="AI 사용량 보기"><RunBudgetPanel runId={run.id} onExpired={onExpired} refreshKey={refresh} /></EvaluationDetailSection>
        {run.postprocessing && <EvaluationDetailSection title="추가 작업과 처리 기록 보기" label="추가 작업">
          <details className="group/processing rounded-xl border border-line text-sm">
            <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-primary [&::-webkit-details-marker]:hidden"><span>관리자용 처리 정보</span><span aria-hidden="true" className="shrink-0 text-xs text-brand-primary"><span className="group-open/processing:hidden">펼치기 +</span><span className="hidden group-open/processing:inline">접기 −</span></span></summary>
            <div className="grid gap-2 border-t border-line p-4 text-ink-muted"><p>자료 확인: {run.postprocessing.inputs_ready ? '완료' : '미확인'}</p><p>마지막 단계: {{ unverified: '미확인', report: '보고서 생성', publish: '결과 등록', completed: '완료' }[run.postprocessing.stage]}</p>{run.postprocessing.blocked_reason && <p>결과 정리: {run.postprocessing.blocked_reason}</p>}{run.postprocessing.reassessment_blocked_reason && <p>다시 평가: {run.postprocessing.reassessment_blocked_reason}</p>}</div>
          </details>
          {!run.postprocessing.can_recover && (run.status !== 'COMPLETED' || !run.postprocessing.inputs_ready) && <p className="text-sm text-ink-muted">{recoveryBlockedMessage(run.postprocessing.blocked_reason)}</p>}
          {run.status === 'COMPLETED' && run.postprocessing.can_reassess && <div className="space-y-2 rounded-xl bg-surface-muted p-4">
            <h3 className="font-semibold">저장된 답변 다시 평가</h3>
            <p className="text-sm leading-6">AI를 추가로 호출하지 않고 별도 기록으로 저장해요.</p>
            <button className={`${secondaryAction} self-start`} disabled={busy} onClick={() => void reassess()}>{busy ? '재평가 접수 중…' : '저장 답변 다시 평가'}</button>
          </div>}
          {!run.postprocessing.can_reassess && run.postprocessing.reassessment_blocked_reason && <p className="text-sm text-ink-muted">{reassessmentBlockedMessage(run.postprocessing.reassessment_blocked_reason)}</p>}
          {run.postprocessing.attempts.length > 0 && <ul className="space-y-2 text-sm">{run.postprocessing.attempts.map((attempt, index) => <li key={attempt.id}><Link className="text-brand-primary underline" to={`${listPath}/${attempt.id}`}>{index + 1}번째 {attempt.recovery_kind === 'reassessment' ? '다시 평가' : '결과 정리'} · {attempt.status_label}</Link></li>)}</ul>}
        </EvaluationDetailSection>}

        {run.status === 'COMPLETED' && run.comparison && !(run.evaluation_scope === 'source-chunks-retrieval-answer' && run.comparison.schema_version === 3) && <EvaluationDetailSection title="이전 결과와 비교하기"><ComparisonResult comparison={run.comparison} /></EvaluationDetailSection>}
        <EvaluationDetailSection title="보고서와 실행 기록 보기"><div className="flex flex-wrap items-center gap-3">
          {run.report_url && <a className={primaryAction} href={`${listPath}/${run.id}/report`} target="_blank" rel="noopener noreferrer">평가 보고서 보기</a>}
          {run.trace_links.map((trace) => {
            const target = new URL(trace.url, window.location.origin)
            return target.origin === window.location.origin && /^\/ops\/traces\/[a-zA-Z0-9_-]+$/.test(target.pathname)
              ? <Link key={trace.case_id} className={secondaryAction} to={target.pathname}>{trace.case_id} 실행 추적</Link>
              : <a key={trace.case_id} className={secondaryAction} href={trace.url} target="_blank" rel="noopener noreferrer">{trace.case_id} 실행 추적 ↗</a>
          })}
          {run.langfuse_url && <a className={secondaryAction} href={run.langfuse_url} target="_blank" rel="noopener noreferrer">상세 점수 보기</a>}
          {!run.report_url && !run.prefect_flow_run_id && <p className="text-sm text-ink-muted">평가가 접수되면 실행 기록을 확인할 수 있습니다.</p>}
        </div>
        {run.prefect_flow_run_id && <EvaluationLogsPanel key={`${run.id}:${run.prefect_flow_run_id}`} runId={run.id} flowId={run.prefect_flow_run_id} onExpired={onExpired} />}</EvaluationDetailSection>
      </>}
    </div>
  </>
}

const metricLabels = {
  statusAccuracy: '예상대로 답변하거나 보류한 비율', referenceCitationRecall: '필요한 공고 내용을 근거로 표시한 비율', failureRate: '실행 실패 비율', missingRate: '답변 누락 비율',
  meanLatencyMs: '평균 답변 시간 (밀리초)', meanInputTokens: 'AI에 보낸 양 (평균 토큰)', meanOutputTokens: 'AI가 만든 양 (평균 토큰)', semanticFaithfulness: '답변의 근거 충실도',
}
const ragLiveNotice = (config: EvaluationRun['live_config'] | undefined) => `${config?.document_vectors ? '동일한 원문·청크와 임베딩 설정의 평가용 벡터를 재사용합니다. 없는 벡터만 새로 만들고 질문 임베딩·검색·답변을 실행합니다.' : '고정 원문·청크로 새 임베딩·검색·답변을 실행합니다.'} 사례마다 격리된 메모리 색인을 사용하며 Core 원문 재수집·재청킹 및 운영 색인 성능은 측정하지 않습니다.`

function VectorPlan({ config }: { config: EvaluationRun['live_config'] | undefined }) {
  if (!config?.document_vectors) return null
  const entries = Object.entries(config.document_vectors)
  const reused = entries.filter(([, value]) => value.sha256 !== null).length
  const generated = entries.filter(([id, value]) => value.sha256 === null && value.source_case_id === id).length
  return <section aria-label="청크 벡터 준비 계획" className="rounded-xl border border-line bg-slate-50 p-4 text-sm">
    <h3 className="font-semibold">청크 벡터 준비 계획</h3>
    <p className="mt-2">저장 벡터 재사용 {reused}사례 · 새 임베딩 {generated}묶음 · 실행 내 공유 {entries.length - reused - generated}사례</p>
    <ul className="mt-2 space-y-1">{entries.map(([id, value]) => <li key={id}>{id}: {value.sha256 !== null ? '저장 벡터 재사용' : value.source_case_id === id ? '새 임베딩' : `이번 실행의 ${value.source_case_id} 벡터 재사용`}</li>)}</ul>
    <p className="mt-2 text-xs text-ink-muted">접수 시 고정하는 계획입니다. 저장 벡터가 사라지거나 바뀌면 추가 호출 없이 중단합니다. 완료된 사용량은 실행 예산 장부에서 확인하세요.</p>
  </section>
}
const scopeNotice = (scope: string | null) => scope === 'fixed-answer-context-only'
  ? '제공된 공고 내용으로 답변을 확인했어요. 공고를 찾아오는 성능은 측정하지 않았어요.'
  : scope === 'source-chunks-retrieval-answer' ? '정해진 공고 안에서 내용을 찾고 답변한 결과예요. 실제 서비스의 공고 검색 성능은 알 수 없어요.' : '평가 범위를 확인할 수 없어 검색 성능으로 해석할 수 없어요.'
const measurement = (value: number | null) => value === null ? '미측정' : value.toLocaleString('ko-KR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
function ComparisonResult({ comparison }: { comparison: NonNullable<EvaluationRun['comparison']> }) {
  if (comparison.schema_version === 3) return <RagComparisonResult comparison={comparison} />
  return <section className="grid min-w-0 gap-3" aria-label="이전 결과와 비교">
    <EvaluationHelp label="결과 비교" title={<p className="text-sm font-semibold">{comparison.comparison === 'self-replay' ? '같은 저장 답변을 다시 확인한 결과예요.' : '기준 결과와 이번 결과를 비교해요.'}</p>}>
      <p>{scopeNotice(comparison.scope)}</p><p>차이는 이번 결과에서 기준 결과를 뺀 값이에요. 비율 1은 100%이며, 확인하지 못한 값은 0으로 계산하지 않아요. 토큰은 AI가 처리한 글의 양을 세는 단위예요. 이 결과만으로 전체 모델의 품질을 판단할 수 없어요.</p>
      <p>비교한 질문: {comparison.case_ids.join(', ')} ({comparison.case_ids.length}개)</p>
    </EvaluationHelp>
    <ul aria-label="결과별 비교" className="grid min-w-0 list-none gap-3 p-0 sm:grid-cols-2">
      {comparison.metrics.map((metric) => <li key={metric.key} className="min-w-0 rounded-xl bg-surface-muted p-4">
        <p className="font-semibold">{metricLabels[metric.key]}</p>
        <dl className="mt-3 grid min-w-0 grid-cols-3 gap-2 text-sm">{([
          ['기준', measurement(metric.reference)], ['이번 결과', measurement(metric.candidate)],
          ['차이', metric.delta === null ? '비교 불가' : `${metric.delta > 0 ? '+' : ''}${measurement(metric.delta)}`],
        ] as [string, string][]).map(([label, value]) => <div key={label} className="min-w-0"><dt className="text-xs text-ink-muted">{label}</dt><dd className="mt-1 font-semibold [overflow-wrap:anywhere]">{value}</dd></div>)}</dl>
      </li>)}
    </ul>
    <details className="group/compare rounded-xl border border-line">
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-primary [&::-webkit-details-marker]:hidden"><span>비교한 실행의 모델과 기록 보기</span><span aria-hidden="true" className="shrink-0 text-xs text-brand-primary"><span className="group-open/compare:hidden">펼치기 +</span><span className="hidden group-open/compare:inline">접기 −</span></span></summary>
      <div className="grid gap-4 border-t border-line p-4 md:grid-cols-2">{([['기준', comparison.reference_execution], ['이번 결과', comparison.candidate_execution]] as const).map(([label, execution]) => <div className="min-w-0 rounded-xl bg-surface-muted p-4 text-xs leading-6 [overflow-wrap:anywhere]" key={label}>
        <h3 className="text-sm font-bold">{label} 실행 정보</h3><p>모델: {execution.model}</p><p>원 실행 시각: {date(execution.started_at)}</p><p>원본 사례: {execution.source_case_ids.join(', ')}</p><p>프롬프트: {execution.prompt_sha256 ?? '미확인'}</p><p>실행기: {execution.runner_sha256 ?? '미확인'}</p><p>캡처: {execution.capture_sha256}</p>
      </div>)}</div>
    </details>
    <details className="group/cases rounded-xl border border-line">
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-primary [&::-webkit-details-marker]:hidden"><span>질문별 결과 비교 보기</span><span aria-hidden="true" className="shrink-0 text-xs text-brand-primary"><span className="group-open/cases:hidden">펼치기 +</span><span className="hidden group-open/cases:inline">접기 −</span></span></summary>
      <ul className="grid gap-3 border-t border-line p-4 text-sm">{comparison.cases.map((item) => <li key={item.case_id} className="min-w-0 rounded-xl bg-surface-muted p-3">
        <h3 className="font-semibold">질문 {item.case_id}</h3>
        <p>기준: {{ success: '답변 있음', error: '실행 오류', missing: '답변 누락' }[item.reference.outcome]} · 이번 결과: {{ success: '답변 있음', error: '실행 오류', missing: '답변 누락' }[item.candidate.outcome]}</p>
        <p>답변 상태 일치: {measurement(item.reference.status_match)} → {measurement(item.candidate.status_match)}</p>
        <p>필요한 근거 표시: {measurement(item.reference.citation_recall)} → {measurement(item.candidate.citation_recall)}</p>
      </li>)}</ul>
    </details>
  </section>
}
