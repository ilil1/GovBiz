// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { Provider } from 'react-redux'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import App from './App'
import { appContainer } from './app/appContainer'
import { sessionRestored } from './presentation/shared/auth/state/authSlice'
import { createAppStore } from './app/store'
import { readPendingEvaluation, storePendingEvaluation } from './data/ops/pendingEvaluation'
import { getEvaluation, type EvaluationReview } from './data/ops/opsApi'

const id = '10000000-0000-4000-8000-000000000001'
const flowId = '20000000-0000-4000-8000-000000000002'
const capture = { id: 'target-coverage-20260907-v1', label: '저장 캡처' }
const liveConfig = { model: 'gpt-6-luna', fixture_sha256: 'c'.repeat(64), max_model_calls: 6, max_output_tokens: 2000 }
const executionProfiles = { replay: "d".repeat(64), live: "e".repeat(64) }
const dataset = { evaluation_scope: 'fixed-answer-context-only', execution_profiles: executionProfiles, baseline: null, fixture: 'target-coverage-fixture.json', live_config: liveConfig, id: capture.id, label: '지원 대상 근거 답변 · 저장된 가상 평가 6건', case_ids: ['TC01', 'TC02', 'TC03', 'TC04', 'TC05', 'TC06'], captures: [capture] }
const comparisonDataset = { evaluation_scope: 'fixed-answer-context-only', execution_profiles: executionProfiles, baseline: null, fixture: 'fixture.json', live_config: { ...liveConfig, max_model_calls: 1 }, id: 'fixed-context-e01-v1', label: '공통 E01 비교', case_ids: ['E01'], captures: [{ id: 'reference', label: '기준 프롬프트' }, { id: 'candidate', label: '후보 프롬프트' }] }
const completed = {
  evaluation_scope: 'fixed-answer-context-only',
  execution_mode: 'replay', live_config: null, trace_links: [],
  candidate_capture_id: capture.id, reference_capture_id: capture.id, candidate_label: capture.label, reference_label: capture.label, comparison: null,
  id, dataset_id: dataset.id, dataset_label: dataset.label, requested_by: 'operator@example.com', requested_by_id: 'core:99', can_retry: false,
  status: 'COMPLETED', status_label: '완료', created_at: '2026-09-27T00:00:00Z',
  started_at: null, finished_at: null, synced_at: null, error_code: '', error_message: '',
  summary: { caseCount: 6, observedCaseCount: 6, statusAccuracy: 1, referenceCitationRecall: 1, semanticFaithfulness: null },
  model_api_calls: 0, evaluation_run_id: 'a'.repeat(32), prefect_flow_run_id: flowId,
  prefect_url: `http://localhost:14200/v2/runs/flow-run/${flowId}`,
  langfuse_url: 'http://localhost:13000/project/development/scores?filter=test',
  report_url: `/api/v1/ops/evaluations/${id}/report`,
}
const reviewDefaults = {
  quality: null, can_promote: true,
  review_version: 0, can_approve: false, approval_current: false, baseline_requires_review: false,
  rubric: { version: 'evidence-review-v1', criteria: ['조건·근거·인용을 확인합니다.'] }, case_reviews: [],
}
let authenticated = true
let fetchMock: Mock<(path: string, options?: RequestInit) => Promise<Response>>
const session = () => ({ live_enabled: true, user: authenticated ? { id: 'core:99', username: 'operator@example.com' } : null, csrf_token: authenticated ? 'rotated-token' : 'anonymous-token' })
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const usageTotals = { calls: 7, inputTokens: 1200, cachedInputTokens: 200, outputTokens: 400, estimatedUsd: '0.012000', unpricedCalls: 0 }
const serviceUsage = {
  from: '2026-10-01', to: '2026-10-13', totals: usageTotals, actualUsd: null, actualConfigured: false, actualFetchedAt: null, krwPerUsd: null,
  byFeature: [{ key: 'AI_SEARCH', serviceTier: null, totals: usageTotals }],
  byModel: [{ key: 'gpt-6-luna', serviceTier: 'default', totals: usageTotals }],
  days: [{ date: '2026-10-13', calls: 7, estimatedUsd: '0.012000', actualUsd: null }],
  topAccounts: [{ accountId: 11, email: 'member@example.com', planCode: 'PLUS', totals: usageTotals }],
}

beforeEach(() => {
  authenticated = true
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  sessionStorage.clear()
  vi.spyOn(crypto, 'randomUUID').mockReturnValue(id)
  fetchMock = vi.fn(async (path: string, _options?: RequestInit) => {
    if (path === '/api/v1/ops/session') return json(session())
    if (path.startsWith('/api/v1/ops/trace-metrics?')) return json({ from_time: '2026-10-01T00:00:00Z', to_time: '2026-10-08T00:00:00Z', scope: 'observed-root-traces', environment: 'production', results: [] })
    if (path.startsWith('/api/v1/ops/model-trace-metrics?')) { const query = new URL(path, 'http://localhost').searchParams; return json({ from_time: query.get('from_time'), to_time: query.get('to_time'), scope: 'observed-model-generations', environment: query.get('environment'), results: [] }) }
    if (path.includes('/api/v1/admin/ai-request-metrics/jobs?')) { const query = new URL(path, 'http://localhost').searchParams; return json({ from: query.get('from'), to: query.get('to'), scope: 'stored-ai-jobs', features: [] }) }
    if (path.includes('/api/v1/admin/ai-request-metrics/daily?')) { const query = new URL(path, 'http://localhost').searchParams; return json({ from: query.get('from'), to: query.get('to'), scope: 'core-http-requests', days: [] }) }
    if (path.includes('/api/v1/admin/ai-request-metrics?')) { const query = new URL(path, 'http://localhost').searchParams; return json({ from: query.get('from'), to: query.get('to'), scope: 'core-http-requests', features: [] }) }
    if (path === '/api/v1/ops/evaluation-catalog') return json({ datasets: [dataset, comparisonDataset] })
    if (path === '/api/v1/ops/datasets') return json({ datasets: [], builtin_count: 10 })
    if (path.includes('/api/v1/admin/ai-costs?')) { const query = new URL(path, 'http://localhost').searchParams; return json({ ...serviceUsage, from: query.get('from'), to: query.get('to') }) }
    if (path.endsWith('/api/v1/admin/ai-costs/prices')) return json([])
    if (path === '/api/v1/ops/dashboard') return json({ as_of: '2026-10-07T00:00:00Z', configured_model: 'gpt-6-luna', window: { limit: 200, loaded: 0, total: 0, truncated: false }, states: { completed: 0, failed: 0, active: 0, cancelled: 0 }, excluded: { replay: 0, incomplete: 0, unverifiable: 0, duplicate: 0 }, series: [] })
    if (path.startsWith('/api/v1/ops/schedules?')) return json({ enabled: false, timezone: 'Asia/Seoul', page: 1, total: 0, results: [] })
    if (path === '/api/v1/ops/schedules/settings') return json({ enabled: false, revision: 0, source: 'environment', live_enabled: false, rag_live_enabled: false, changes: [] })
    if (path.startsWith('/api/v1/ops/budget/reservations')) return json({
      as_of: '2026-09-29T00:00:00Z', count: 0, next: null, previous: null, results: [],
      summary: { state: 'unconfigured', limits: null, allocated: null, remaining: null, breakdown: null,
        reservation_count: 0, legacy_live_run_count: 0, change_count: 0, recent_changes: [] },
    })
    if (path.endsWith('/budget')) return json({ as_of: '2026-09-29T00:00:00Z', state: 'not_applicable', reservation: null, calls: [] })
    if (String(path).endsWith('/api/v1/auth/logout')) { authenticated = false; return new Response(null, { status: 204 }) }
    if (path.startsWith('/api/v1/ops/evaluations?page=')) return json({ count: 1, next: null, previous: null, results: [completed] })
    if (path === `/api/v1/ops/evaluations/${id}/review`) return json({ ...reviewDefaults, is_baseline: false, baseline_version: 0, baseline_history: [], reviews: [], material: null, material_error: '' })
    if (path === `/api/v1/ops/evaluations/${id}`) return json(completed)
    if (path === '/api/v1/ops/evaluations') return json(completed, 202)
    if (/^\/api\/v1\/ops\/evaluations\/[a-f0-9-]+$/.test(path)) return json({}, 404)
    throw new Error(`예상하지 않은 호출: ${path}`)
  })
  vi.spyOn(appContainer.resolve('logInUseCase'), 'execute').mockImplementation(async () => {
    authenticated = true
    return { outcome: 'session', session: { account: { email: 'operator@example.com', role: 'ADMIN', tier: 'ADMIN', emailVerified: true, hasPassword: true, accountType: null, onboarded: true, company: null }, expiresAt: '2026-12-01T00:00:00+09:00' } }
  })
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

function open(path = '/ops/evaluations/new') {
  return render(<Provider store={createAppStore()}><MemoryRouter initialEntries={[path]}><App /></MemoryRouter></Provider>)
}

async function evaluationStep(target: 1 | 2 | 3) {
  await screen.findByRole('region', { name: '평가 실행' }, { timeout: 5000 })
  if (target < 3 && screen.queryByRole('button', { name: '이전: 답변 확인 방법' })) fireEvent.click(screen.getByRole('button', { name: '이전: 답변 확인 방법' }))
  if (target === 1 && screen.queryByRole('button', { name: '이전: 평가 자료' })) fireEvent.click(screen.getByRole('button', { name: '이전: 평가 자료' }))
  if (target > 1 && screen.queryByRole('button', { name: '다음: 답변 확인 방법' })) {
    const select = screen.getByRole('combobox', { name: '평가 자료' }) as HTMLSelectElement
    if (!select.value) fireEvent.change(select, { target: { value: select.querySelector('option[value]:not([value=""])')!.getAttribute('value')! } })
    fireEvent.click(screen.getByRole('button', { name: '다음: 답변 확인 방법' }))
  }
  if (target === 3 && screen.queryByRole('button', { name: '다음: 비교하고 실행' })) fireEvent.click(screen.getByRole('button', { name: '다음: 비교하고 실행' }))
}

function expectInlineHelp(button: HTMLElement) {
  const panelId = button.getAttribute('aria-controls')
  expect(panelId).toBeTruthy()
  const panel = document.getElementById(panelId!)!
  expect(panel).toBeTruthy()
  expect(button.parentElement?.nextElementSibling).toBe(panel)
  expect(panel.className).not.toMatch(/(?:^|\s)(?:absolute|fixed|overflow-y-auto)(?:\s|$)/)
  expect(panel.className).not.toMatch(/(?:^|\s)max-h-/)
  return panel
}

describe('운영 세션과 평가 자료 조회 분리', () => {
  it.each([
    ['/ops/dashboard', '성능 대시보드'], ['/ops/usage', '실사용 모니터링'],
    ['/ops/budget', '예산 관리'], ['/ops/evaluations', '평가 이력'], ['/ops/datasets', '평가 자료 관리'],
    [`/ops/evaluations/${id}`, '평가 실행 상세'],
  ])('%s 화면은 평가 자료 조회 없이 가벼운 세션으로 연다', async (path, title) => {
    open(path)
    expect(await screen.findByRole('heading', { level: 1, name: title })).toBeTruthy()
    expect(fetchMock.mock.calls.some(([url]) => url === '/api/v1/ops/evaluation-catalog')).toBe(false)
  })

  it('평가 자료 조회 중에도 메뉴를 이동하고 늦게 도착한 응답을 버린다', async () => {
    const original = fetchMock.getMockImplementation()!
    let resolveCatalog: (value: Response) => void = () => {}
    let catalogSignal: AbortSignal | null | undefined
    fetchMock.mockImplementation((path, options) => {
      if (path === '/api/v1/ops/evaluation-catalog') {
        catalogSignal = options?.signal
        return new Promise<Response>((resolve) => { resolveCatalog = resolve })
      }
      return original(path, options)
    })
    open()
    expect(await screen.findByText(/평가 자료와 실행 조건을 불러오고 있습니다/)).toBeTruthy()
    fireEvent.click(screen.getByRole('link', { name: '성능 대시보드' }))
    expect(await screen.findByRole('heading', { level: 1, name: '성능 대시보드' })).toBeTruthy()
    expect(catalogSignal?.aborted).toBe(true)
    await act(async () => resolveCatalog(json({ datasets: [dataset] })))
    expect(screen.queryByLabelText('평가 자료')).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('평가 자료 장애는 해당 화면에서 재시도하고 메뉴 재진입 시 새로 조회한다', async () => {
    const original = fetchMock.getMockImplementation()!
    let catalogs = 0
    fetchMock.mockImplementation((path, options) => path === '/api/v1/ops/evaluation-catalog'
      ? Promise.resolve(++catalogs < 3 ? json({ code: 'VECTOR_CACHE_UNAVAILABLE' }, 503) : json({ datasets: [dataset] }))
      : original(path, options))
    open()
    expect(await screen.findByText(/평가 자료를 불러오지 못했습니다/)).toBeTruthy()
    expect(screen.queryByText('운영자 세션을 확인하고 있습니다.')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '평가 자료 다시 불러오기' }))
    await waitFor(() => expect(catalogs).toBe(2))
    expect(await screen.findByText(/평가 자료를 불러오지 못했습니다/)).toBeTruthy()
    fireEvent.click(screen.getByRole('link', { name: '평가 이력' }))
    expect(await screen.findByRole('heading', { level: 1, name: '평가 이력' })).toBeTruthy()
    fireEvent.click(within(screen.getByRole('navigation', { name: 'LLMOps 작업 메뉴' })).getByRole('link', { name: '새 평가' }))
    expect(await screen.findByLabelText('평가 자료')).toHaveProperty('value', '')
    expect(catalogs).toBe(3)
    expect(fetchMock.mock.calls.filter(([path]) => path === '/api/v1/ops/session')).toHaveLength(1)
  })

  it('정기 실행도 자료가 필요할 때만 조회하며 실패 후 직접 재시도한다', async () => {
    const original = fetchMock.getMockImplementation()!
    let catalogs = 0
    fetchMock.mockImplementation((path, options) => path === '/api/v1/ops/evaluation-catalog'
      ? Promise.resolve(++catalogs === 1 ? json({}, 503) : json({ datasets: [dataset] }))
      : original(path, options))
    open('/ops/schedules')
    expect(await screen.findByText(/평가 자료를 불러오지 못했습니다/)).toBeTruthy()
    expect(await screen.findByRole('combobox', { name: '변경할 정기 접수 상태' })).toBeTruthy()
    expect(fetchMock.mock.calls.some(([path]) => path.startsWith('/api/v1/ops/schedules?'))).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: '평가 자료 다시 불러오기' }))
    await waitFor(() => expect(fetchMock.mock.calls.some(([path]) => path.startsWith('/api/v1/ops/schedules?'))).toBe(true))
    expect(catalogs).toBe(2)
    expect(screen.queryByRole('button', { name: '평가 자료 다시 불러오기' })).toBeNull()
  })

  it('관리자 정기 접수 설정 저장 후 계획 상태를 갱신하며 유료 평가를 켜지 않는다', async () => {
    const original = fetchMock.getMockImplementation()!
    let enabled = false
    const changes: Array<{ request_id: string; revision: number; enabled: boolean; previous_enabled: boolean; actor: string; reason: string; created_at: string }> = []
    const settings = () => ({ enabled, revision: changes.length, source: changes.length ? 'admin' : 'environment', live_enabled: false, rag_live_enabled: false, changes })
    fetchMock.mockImplementation(async (path, options) => {
      if (path === '/api/v1/ops/schedules/settings') {
        if (options?.method !== 'POST') return json(settings())
        const input = JSON.parse(options.body as string)
        const change = { request_id: input.request_id, revision: 1, enabled: input.enabled, previous_enabled: enabled, actor: 'core:99', reason: input.reason, created_at: '2026-10-14T00:00:00Z' }
        enabled = input.enabled; changes.push(change)
        return json({ ...settings(), change })
      }
      if (path.startsWith('/api/v1/ops/schedules?')) return json({ enabled, timezone: 'Asia/Seoul', page: 1, total: 0, results: [] })
      return original(path, options)
    })
    open('/ops/schedules')
    await screen.findByText(/정기 접수: 비활성화/)
    fireEvent.change(await screen.findByRole('combobox', { name: '변경할 정기 접수 상태' }), { target: { value: 'enabled' } })
    fireEvent.change(screen.getByRole('textbox', { name: '정기 접수 변경 사유' }), { target: { value: '실제 유료 평가 허용과 분리한 정기 접수 설정' } })
    fireEvent.click(screen.getByRole('button', { name: '정기 접수 변경 내용 확인' }))
    expect(fetchMock.mock.calls.some(([, options]) => options?.method === 'POST')).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: '확인한 정기 접수 설정 저장' }))
    expect(await screen.findByText('정기 접수: 활성화')).toBeTruthy()
    expect(screen.getAllByText('서버에서 차단됨')).toHaveLength(2)
    const posts = fetchMock.mock.calls.filter(([, options]) => options?.method === 'POST')
    expect(posts).toHaveLength(1)
    expect(posts[0][0]).toBe('/api/v1/ops/schedules/settings')
    expect(JSON.parse(posts[0][1]!.body as string)).toEqual({ request_id: id, expected_revision: 0, enabled: true, reason: '실제 유료 평가 허용과 분리한 정기 접수 설정' })
    expect(fetchMock.mock.calls.filter(([path]) => path.startsWith('/api/v1/ops/schedules?')).length).toBeGreaterThan(1)
  })
})

describe('React LLMOps 운영 화면', () => {
  it('이전 보관 요청이 없는 새 평가는 자료를 직접 선택하기 전까지 진행하지 않는다', async () => {
    open()
    const select = await screen.findByRole('combobox', { name: '평가 자료' })
    expect(select).toHaveProperty('value', '')
    expect(screen.getByRole('button', { name: '다음: 답변 확인 방법' })).toHaveProperty('disabled', true)
    expect(screen.queryByRole('region', { name: '선택한 평가 자료 설명' })).toBeNull()
    fireEvent.change(select, { target: { value: dataset.id } })
    fireEvent.click(screen.getByRole('button', { name: '다음: 답변 확인 방법' }))
    fireEvent.click(screen.getByRole('radio', { name: '새 응답 생성' }))
    expect(screen.getByLabelText('평가 모델')).toHaveProperty('value', liveConfig.model)
    fireEvent.click(screen.getByRole('button', { name: '다음: 비교하고 실행' }))
    expect(screen.getByLabelText('비교 기준 답변')).toHaveProperty('value', capture.id)
    expect(fetchMock.mock.calls.some(([, options]) => options?.method === 'POST')).toBe(false)
  })

  it('각 단계에서 필요한 선택만 보여주고 앞뒤로 이동해도 선택을 유지한다', async () => {
    open()
    expect(await screen.findByRole('heading', { name: '1. 평가 자료 선택' })).toBeTruthy()
    expect(screen.queryByRole('radio', { name: '새 응답 생성' })).toBeNull()
    expect(screen.queryByRole('button', { name: '평가 실행' })).toBeNull()
    fireEvent.submit(screen.getByRole('region', { name: '평가 실행' }).querySelector('form')!)
    expect(fetchMock.mock.calls.some(([, options]) => options?.method === 'POST')).toBe(false)
    fireEvent.change(screen.getByLabelText('평가 자료'), { target: { value: comparisonDataset.id } })
    fireEvent.click(screen.getByRole('button', { name: '다음: 답변 확인 방법' }))
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: '2. 답변 확인 방법 선택' }))
    expect(screen.queryByLabelText('평가 자료')).toBeNull()
    expect(screen.queryByRole('button', { name: '평가 실행' })).toBeNull()
    fireEvent.submit(screen.getByRole('region', { name: '평가 실행' }).querySelector('form')!)
    expect(fetchMock.mock.calls.some(([, options]) => options?.method === 'POST')).toBe(false)
    const live = screen.getByRole('radio', { name: '새 응답 생성' })
    expect(screen.getByRole('group', { name: '답변을 확인하는 방법' }).contains(live)).toBe(true)
    live.focus()
    expect(document.activeElement).toBe(live)
    fireEvent.click(live)
    fireEvent.click(screen.getByRole('button', { name: '이전: 평가 자료' }))
    expect(screen.getByLabelText('평가 자료')).toHaveProperty('value', comparisonDataset.id)
    fireEvent.click(screen.getByRole('button', { name: '다음: 답변 확인 방법' }))
    expect(screen.getByRole('radio', { name: '새 응답 생성' })).toHaveProperty('checked', true)
    fireEvent.click(screen.getByRole('button', { name: '다음: 비교하고 실행' }))
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: '3. 비교하고 실행' }))
    expect(screen.queryByRole('radio', { name: '새 응답 생성' })).toBeNull()
    const summary = within(screen.getByRole('region', { name: '평가 설정 요약' }))
    expect(summary.getByText(`${comparisonDataset.label} · 질문 1개`)).toBeTruthy()
    expect(summary.getByText(`새 응답 생성 · ${liveConfig.model}`)).toBeTruthy()
    const submit = screen.getByRole('button', { name: '새 응답 생성 및 평가' })
    expect(submit).toHaveProperty('disabled', true)
    fireEvent.click(screen.getByRole('checkbox', { name: /위 자료의 OpenAI 전송/ }))
    expect(submit).toHaveProperty('disabled', false)
    fireEvent.click(screen.getByRole('button', { name: '이전: 답변 확인 방법' }))
    expect(screen.getByRole('radio', { name: '새 응답 생성' })).toHaveProperty('checked', true)
    fireEvent.click(screen.getByRole('button', { name: '다음: 비교하고 실행' }))
    expect(screen.getByRole('checkbox', { name: /위 자료의 OpenAI 전송/ })).toHaveProperty('checked', true)
    expect(fetchMock.mock.calls.some(([, options]) => options?.method === 'POST')).toBe(false)
  })

  it('모델과 비교 답변 도움말을 열고 닫아도 선택이나 요청이 바뀌지 않는다', async () => {
    open()
    await evaluationStep(2)
    fireEvent.click(screen.getByRole('radio', { name: '새 응답 생성' }))
    expect(screen.getByText('자료를 OpenAI에 전송하며 비용이 발생할 수 있습니다.')).toBeTruthy()
    const model = screen.getByLabelText('평가 모델')
    const modelHelp = screen.getByRole('button', { name: '평가 모델 도움말' })
    expect(modelHelp.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(modelHelp)
    expect(modelHelp.getAttribute('aria-expanded')).toBe('true')
    const modelPanel = expectInlineHelp(modelHelp)
    expect(modelPanel.textContent).toContain('한 번에 선택한 모델 하나를 평가합니다.')
    expect(model).toHaveProperty('value', liveConfig.model)
    expect(screen.getByText('자료를 OpenAI에 전송하며 비용이 발생할 수 있습니다.')).toBeTruthy()
    fireEvent.click(modelHelp)
    expect(modelHelp.getAttribute('aria-expanded')).toBe('false')
    expect(document.body.contains(modelPanel)).toBe(false)
    await evaluationStep(3)
    expect(screen.getByRole('checkbox', { name: /위 자료의 OpenAI 전송/ })).toHaveProperty('checked', false)
    expect(screen.getByRole('button', { name: '새 응답 생성 및 평가' })).toHaveProperty('disabled', true)
    const referenceHelp = screen.getByRole('button', { name: '비교 기준 답변 도움말' })
    expect(referenceHelp.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(referenceHelp)
    expect(referenceHelp.getAttribute('aria-expanded')).toBe('true')
    const referencePanel = expectInlineHelp(referenceHelp)
    expect(referencePanel.textContent).toContain('비교 기준이라고 해서 정답으로 승인된 것은 아닙니다.')
    expect(screen.getByRole('checkbox', { name: /위 자료의 OpenAI 전송/ })).toHaveProperty('checked', false)
    expect(screen.getByRole('button', { name: '새 응답 생성 및 평가' })).toHaveProperty('disabled', true)
    fireEvent.click(referenceHelp)
    expect(referenceHelp.getAttribute('aria-expanded')).toBe('false')
    expect(document.body.contains(referencePanel)).toBe(false)
    expect(fetchMock.mock.calls.some(([, options]) => options?.method === 'POST')).toBe(false)
  })

  it('기존 답변 확인의 두 비교 도움말과 재현 경고를 확인해도 실행하지 않는다', async () => {
    open()
    await evaluationStep(3)
    expect(screen.getByText('같은 저장 답변을 비교합니다. 현재 AI 성능 측정이 아닌 재현 확인입니다.')).toBeTruthy()
    for (const [label, description] of [['비교 기준 답변 도움말', '비교 기준이라고 해서 정답으로 승인된 것은 아닙니다.'], ['다시 확인할 답변 도움말', '같은 답변을 고르면 결과가 다시 계산되는지만 확인합니다.']] as const) {
      const help = screen.getByRole('button', { name: label })
      expect(help.getAttribute('aria-expanded')).toBe('false')
      fireEvent.click(help)
      expect(help.getAttribute('aria-expanded')).toBe('true')
      const panel = expectInlineHelp(help)
      expect(panel.textContent).toContain(description)
      expect(screen.getByText('같은 저장 답변을 비교합니다. 현재 AI 성능 측정이 아닌 재현 확인입니다.')).toBeTruthy()
      fireEvent.click(help)
      expect(help.getAttribute('aria-expanded')).toBe('false')
      expect(document.body.contains(panel)).toBe(false)
    }
    expect(screen.getByLabelText('비교 기준 답변')).toHaveProperty('value', capture.id)
    expect(screen.getByLabelText('다시 확인할 답변')).toHaveProperty('value', capture.id)
    expect(fetchMock.mock.calls.some(([, options]) => options?.method === 'POST')).toBe(false)
  })

  it('새 응답이 비활성화된 이유는 모델 도움말을 열고 닫아도 보인다', async () => {
    const original = fetchMock.getMockImplementation()!
    fetchMock.mockImplementation((path, options) => path === '/api/v1/ops/session'
      ? Promise.resolve(json({ ...session(), live_enabled: false })) : original(path, options))
    open()
    await evaluationStep(2)
    fireEvent.click(screen.getByRole('radio', { name: '새 응답 생성' }))
    const help = screen.getByRole('button', { name: '평가 모델 도움말' })
    fireEvent.click(help)
    expect(help.getAttribute('aria-expanded')).toBe('true')
    const panel = expectInlineHelp(help)
    expect(screen.getByText(/새 응답 생성이 비활성화되어 있습니다/)).toBeTruthy()
    expect(screen.getByRole('button', { name: '다음: 비교하고 실행' })).toHaveProperty('disabled', true)
    fireEvent.click(help)
    expect(help.getAttribute('aria-expanded')).toBe('false')
    expect(document.body.contains(panel)).toBe(false)
    expect(screen.getByText(/새 응답 생성이 비활성화되어 있습니다/)).toBeTruthy()
    expect(fetchMock.mock.calls.some(([, options]) => options?.method === 'POST')).toBe(false)
  })

  it('설정 요약에서 같은 저장 답변을 비교하면 재현 확인임을 알린다', async () => {
    open()
    await evaluationStep(3)
    let summary = within(screen.getByRole('region', { name: '평가 설정 요약' }))
    expect(summary.getByText(`${dataset.label} · 질문 6개`)).toBeTruthy()
    expect(summary.getAllByText(capture.label)).toHaveLength(2)
    expect(summary.getByText('같은 저장 답변을 비교합니다. 현재 AI 성능 측정이 아닌 재현 확인입니다.')).toBeTruthy()
    await evaluationStep(1)
    fireEvent.change(screen.getByLabelText('평가 자료'), { target: { value: comparisonDataset.id } })
    await evaluationStep(3)
    summary = within(screen.getByRole('region', { name: '평가 설정 요약' }))
    expect(summary.getByText(`${comparisonDataset.label} · 질문 1개`)).toBeTruthy()
    expect(summary.getByText('기준 프롬프트')).toBeTruthy()
    expect(summary.getByText('후보 프롬프트')).toBeTruthy()
    expect(summary.queryByText('같은 저장 답변을 비교합니다. 현재 AI 성능 측정이 아닌 재현 확인입니다.')).toBeNull()
    fireEvent.change(screen.getByLabelText('다시 확인할 답변'), { target: { value: 'reference' } })
    expect(summary.getByText('같은 저장 답변을 비교합니다. 현재 AI 성능 측정이 아닌 재현 확인입니다.')).toBeTruthy()
    expect(fetchMock.mock.calls.some(([, options]) => options?.method === 'POST')).toBe(false)
  })

  it('자료를 용도별로 묶고 선택한 자료의 설명과 기존 비교 대상을 함께 바꾼다', async () => {
    const development = { ...dataset, selection_guide: { category: 'development', title: '지원 조건 가상 사례', purpose: '가상 공고로 지원 조건 누락을 확인합니다.', material: '가상 질문 6개와 저장 응답', limitations: '실제 공고 전체의 품질을 대표하지 않습니다.' } }
    const historical = { ...comparisonDataset, selection_guide: { category: 'historical', title: '이전 프롬프트 비교', purpose: '이전 지시문의 응답 차이를 비교합니다.', material: 'E01 과거 응답 두 개', limitations: '한 질문의 과거 비교입니다.' } }
    const quality = { ...comparisonDataset, id: 'official-answer-20260907-v3', selection_guide: { category: 'quality', title: '실제 공고 답변 · 참조 보완 v3', purpose: '주어진 실제 공고 근거로 답변 품질을 평가합니다.', material: '저장 원문과 참조 조건', limitations: '검색은 평가하지 않습니다.' } }
    const original = fetchMock.getMockImplementation()!
    fetchMock.mockImplementation((path, options) => path === '/api/v1/ops/evaluation-catalog'
      ? Promise.resolve(json({ ...session(), datasets: [development, historical, quality] })) : original(path, options))
    open()
    await evaluationStep(1)
    const select = await screen.findByLabelText('평가 자료')
    expect(within(select).getAllByRole('group').map((group) => group.getAttribute('label'))).toEqual(['실제 품질 평가용', '개발 검증용', '과거 자료'])
    expect(select).toHaveProperty('value', '')
    fireEvent.change(select, { target: { value: development.id } })
    expect(within(screen.getByRole('region', { name: '선택한 평가 자료 설명' })).getByText(development.selection_guide.purpose)).toBeTruthy()
    fireEvent.change(select, { target: { value: quality.id } })
    const explanation = within(screen.getByRole('region', { name: '선택한 평가 자료 설명' }))
    expect(explanation.getByRole('heading', { name: quality.selection_guide.title })).toBeTruthy()
    fireEvent.click(explanation.getByRole('button', { name: '선택한 평가 자료 도움말' }))
    expect(explanation.getByText(quality.selection_guide.material)).toBeTruthy()
    expect(explanation.getByText(quality.selection_guide.limitations)).toBeTruthy()
    expect(explanation.queryByText(development.selection_guide.purpose)).toBeNull()
    await evaluationStep(3)
    expect(screen.getByLabelText('비교 기준 답변')).toHaveProperty('value', 'reference')
    await evaluationStep(3)
    expect(screen.getByLabelText('다시 확인할 답변')).toHaveProperty('value', 'candidate')
    await evaluationStep(2)
    expect(screen.getByRole('radio', { name: '기존 답변 다시 확인' })).toHaveProperty('checked', true)
    fireEvent.click(screen.getByRole('link', { name: '평가 이력' }))
    await screen.findByRole('region', { name: '평가 실행 이력' })
    fireEvent.click(within(screen.getByRole('navigation', { name: 'LLMOps 작업 메뉴' })).getByRole('link', { name: '새 평가' }))
    await evaluationStep(1)
    expect(await screen.findByLabelText('평가 자료')).toHaveProperty('value', quality.id)
    fireEvent.click(screen.getByRole('button', { name: '선택한 평가 자료 도움말' }))
    expect(screen.getByText(quality.selection_guide.limitations)).toBeTruthy()
    expect(fetchMock.mock.calls.some(([, options]) => options?.method === 'POST')).toBe(false)
  })

  it('용도 설명이 없는 이전 세션 응답은 품질 자료로 추정하지 않고 기존 선택을 유지한다', async () => {
    open()
    await evaluationStep(1)
    const select = await screen.findByLabelText('평가 자료')
    expect(within(select).getByRole('group', { name: '분류 확인 필요' })).toBeTruthy()
    expect(select).toHaveProperty('value', '')
    fireEvent.change(select, { target: { value: dataset.id } })
    expect(screen.getByText('이 자료의 용도 설명이 아직 제공되지 않았습니다. 자료 이름만으로 실제 품질 평가용인지 판단하지 마세요.')).toBeTruthy()
    await evaluationStep(3)
    expect(screen.getByRole('button', { name: '평가 실행' })).toHaveProperty('disabled', false)
  })

  it('그룹이 다른 자료를 고르면 유료 실행 동의를 해제하며 저장 전용 자료는 재평가로 전환한다', async () => {
    const quality = { ...dataset, selection_guide: { category: 'quality', title: '공식 공고 답변', purpose: '답변 확인', material: '등록된 공고 원문', limitations: '검색 미평가' } }
    const historical = { ...comparisonDataset, live_config: null, live_options: [], execution_profiles: { ...executionProfiles, live: null }, selection_guide: { category: 'historical', title: 'Core 저장 기록', purpose: '저장 기록 재평가', material: '기존 Core 응답', limitations: '저장 응답 재평가만 가능' } }
    const original = fetchMock.getMockImplementation()!
    fetchMock.mockImplementation((path, options) => path === '/api/v1/ops/evaluation-catalog'
      ? Promise.resolve(json({ ...session(), datasets: [quality, historical] })) : original(path, options))
    open()
    await evaluationStep(2)
    fireEvent.click(await screen.findByRole('radio', { name: '새 응답 생성' }))
    await evaluationStep(3)
    fireEvent.click(screen.getByRole('checkbox', { name: /위 자료의 OpenAI 전송/ }))
    await evaluationStep(3)
    expect(screen.getByRole('button', { name: '새 응답 생성 및 평가' })).toHaveProperty('disabled', false)
    await evaluationStep(1)
    fireEvent.change(screen.getByLabelText('평가 자료'), { target: { value: historical.id } })
    await evaluationStep(2)
    expect(screen.getByRole('radio', { name: '기존 답변 다시 확인' })).toHaveProperty('checked', true)
    await evaluationStep(2)
    expect(screen.getByRole('radio', { name: '새 응답 생성' })).toHaveProperty('disabled', true)
    await evaluationStep(1)
    fireEvent.click(screen.getByRole('button', { name: '선택한 평가 자료 도움말' }))
    expect(screen.getByText('저장 응답 재평가만 가능')).toBeTruthy()
    await evaluationStep(1)
    fireEvent.change(screen.getByLabelText('평가 자료'), { target: { value: quality.id } })
    await evaluationStep(2)
    fireEvent.click(screen.getByRole('radio', { name: '새 응답 생성' }))
    await evaluationStep(3)
    expect(screen.getByRole('checkbox', { name: /위 자료의 OpenAI 전송/ })).toHaveProperty('checked', false)
    await evaluationStep(3)
    expect(screen.getByRole('button', { name: '새 응답 생성 및 평가' })).toHaveProperty('disabled', true)
    expect(fetchMock.mock.calls.some(([, options]) => options?.method === 'POST')).toBe(false)
  })

  it('운영 표본 품질 메뉴는 관리자 세션으로 별도 표본 API를 조회한다', async () => {
    const original = fetchMock.getMockImplementation()!
    fetchMock.mockImplementation((path, options) => path === '/api/v1/ops/production-quality?page=1'
      ? Promise.resolve(json({ scope: 'support-program-evidence-answer', enabled: false, retention_days: 14, daily_limit: 100,
        summary: { stored: 0, checked: 0, pending: 0, reviewed: 0, issues: 0, unassessable: 0 }, days: [], results: [], count: 0, next: false, page: 1 }))
      : original(path, options))
    open('/ops/dashboard')
    fireEvent.click(await screen.findByRole('link', { name: '운영 표본 품질' }))
    expect(await screen.findByRole('heading', { level: 1, name: '운영 표본 품질' })).toBeTruthy()
    expect(fetchMock.mock.calls.some(([path]) => path === '/api/v1/ops/evaluation-catalog')).toBe(false)
    expect(await screen.findByText('아직 저장된 운영 표본이 없습니다.')).toBeTruthy()
    expect(document.title).toBe('GovBiz · 운영 표본 품질')
    expect(screen.getByRole('link', { name: '운영 표본 품질' }).getAttribute('aria-current')).toBe('page')
    expect(fetchMock.mock.calls.some(([, options]) => options?.method === 'POST')).toBe(false)
  })

  it('운영 표본 주소에 비로그인으로 접근하면 표본을 조회하지 않고 기존 로그인으로 이동한다', async () => {
    authenticated = false
    open('/ops/production-quality')
    expect(await screen.findByRole('heading', { name: '로그인' })).toBeTruthy()
    expect(fetchMock.mock.calls.some(([path]) => path.includes('/production-quality'))).toBe(false)
  })

  it('실사용 첫 화면에서 핵심 수치를 확인하고 요청 상세로 이동한다', async () => {
    open('/ops/usage')
    const overview = await screen.findByRole('region', { name: '주요 모니터링 수치' })
    const requests = within(overview).getByRole('link', { name: /서버 오류 응답/ })
    await waitFor(() => expect(requests.textContent).toContain('기록 없음'))
    expect(within(overview).getByRole('link', { name: /수집된 모델 실행 오류/ }).getAttribute('href')).toBe('/ops/usage/models')
    expect(within(overview).getByRole('link', { name: /완료된 작업/ }).getAttribute('href')).toBe('/ops/usage/jobs')
    expect(within(overview).getByRole('link', { name: /앱 기록 추정 비용/ }).getAttribute('href')).toBe('/ops/usage/costs')
    expect(screen.getByRole('region', { name: '날짜별 요청 추세' })).toBeTruthy()
    expect(screen.queryByRole('region', { name: 'AI 기능 HTTP 요청 집계' })).toBeNull()
    fireEvent.click(requests)
    expect(await screen.findByRole('heading', { level: 1, name: '요청과 서버 오류' })).toBeTruthy()
    expect(await screen.findByRole('region', { name: 'AI 기능 HTTP 요청 집계' })).toBeTruthy()
    fireEvent.click(screen.getByRole('link', { name: '전체 현황으로 돌아가기' }))
    expect(await screen.findByRole('region', { name: '주요 모니터링 수치' })).toBeTruthy()
  })

  it('실사용 요약에서 조회 실패를 확인하고 상세에서 재시도한다', async () => {
    const original = fetchMock.getMockImplementation()!
    let failed = true
    fetchMock.mockImplementation((path, options) => failed && path.includes('/api/v1/admin/ai-request-metrics?')
      ? Promise.resolve(json({}, 503)) : original(path, options))
    open('/ops/usage')
    const overview = await screen.findByRole('region', { name: '주요 모니터링 수치' })
    const errors = within(overview).getByRole('link', { name: /서버 오류 응답/ })
    await waitFor(() => expect(errors.textContent).toContain('조회 실패'))
    fireEvent.click(errors)
    const requests = await screen.findByRole('region', { name: 'AI 기능 HTTP 요청 집계' })
    expect((await within(requests).findByRole('alert')).textContent).toContain('서버 상태')
    failed = false
    fireEvent.click(within(requests).getByRole('button', { name: '다시 조회' }))
    expect(await within(requests).findByText('이 기간에 저장된 요청 기록이 없습니다.')).toBeTruthy()
  })

  it('실사용 비용 상세에서 Core 사용량, 기간 조회와 회원 상세를 확인한다', async () => {
    open('/ops/dashboard')
    fireEvent.click(await screen.findByRole('link', { name: '실사용 모니터링' }))
    const overview = await screen.findByRole('region', { name: '주요 모니터링 수치' })
    const cost = within(overview).getByRole('link', { name: /앱 기록 추정 비용/ })
    await waitFor(() => expect(cost.textContent).toContain('0.012'))
    fireEvent.click(cost)
    const stats = await screen.findByRole('region', { name: '앱 사용량 요약' })
    expect(within(stats).getByText('7회')).toBeTruthy()
    expect(within(screen.getByRole('region', { name: '기능별' })).getByText('AI 대화 검색')).toBeTruthy()
    expect(within(screen.getByRole('region', { name: '모델별' })).getByText('gpt-6-luna')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'member@example.com' }).getAttribute('href')).toBe('/app/admin/accounts/detail?accountId=11')
    expect(screen.getByRole('link', { name: '실사용 모니터링', current: 'page' }).getAttribute('aria-current')).toBe('page')
    fireEvent.change(screen.getByLabelText('시작일', { selector: 'input[name="from"]' }), { target: { value: '2026-10-01' } })
    fireEvent.change(screen.getByLabelText('종료일'), { target: { value: '2026-10-13' } })
    fireEvent.click(screen.getByRole('button', { name: '조회' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/api/v1/admin/ai-costs?from=2026-10-01&to=2026-10-13'),
      expect.objectContaining({ credentials: 'include', cache: 'no-store' })))
    expect(fetchMock.mock.calls.some(([path]) => path.startsWith('/api/v1/ops/evaluations') || path.includes('/budget/'))).toBe(false)
    expect(fetchMock.mock.calls.some(([, options]) => options?.method === 'POST')).toBe(false)
  })

  it('실사용 비용 상세 주소를 바로 열면 빈 사용량을 표시한다', async () => {
    const original = fetchMock.getMockImplementation()!
    fetchMock.mockImplementation((path, options) => path.includes('/api/v1/admin/ai-costs?')
      ? Promise.resolve(json({ ...serviceUsage, totals: { calls: 0, inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, estimatedUsd: '0.000000', unpricedCalls: 0 }, byFeature: [], byModel: [], days: [], topAccounts: [] }))
      : original(path, options))
    open('/ops/usage/costs')
    expect(await screen.findByRole('heading', { level: 1, name: '사용량과 비용' })).toBeTruthy()
    expect(await screen.findByText('회원에게 붙은 AI 호출이 없어요.')).toBeTruthy()
    expect(screen.queryByRole('region', { name: '실측 결과 추이' })).toBeNull()
    expect(fetchMock.mock.calls.some(([path]) => path === '/api/v1/ops/dashboard')).toBe(false)
  })

  it.each([
    ['requests', '요청과 서버 오류'], ['jobs', '작업 결과'], ['models', '모델 실행'],
    ['traces', '추적 수집과 연결'], ['costs', '사용량과 비용'],
  ])('모니터링 상세 %s 주소로 직접 진입하고 전체 현황으로 돌아간다', async (section, title) => {
    open(`/ops/usage/${section}`)
    expect(await screen.findByRole('heading', { level: 1, name: title })).toBeTruthy()
    expect(screen.getByRole('link', { name: '실사용 모니터링', current: 'page' }).getAttribute('aria-current')).toBe('page')
    fireEvent.click(screen.getByRole('link', { name: '실사용 모니터링', current: 'page' }))
    expect(await screen.findByRole('heading', { level: 1, name: '실사용 모니터링' })).toBeTruthy()
  })

  it('전체 모니터링과 개별 실행 조사를 오가며 각 화면의 데이터만 조회한다', async () => {
    const original = fetchMock.getMockImplementation()!
    fetchMock.mockImplementation((path, options) => path === '/api/v1/ops/traces'
      ? Promise.resolve(json({ results: [], next_cursor: null, from_time: '2026-10-07T00:00:00Z', to_time: '2026-10-14T00:00:00Z' }))
      : original(path, options))
    open('/ops/usage')
    await screen.findByRole('region', { name: '주요 모니터링 수치' })
    await waitFor(() => expect(fetchMock.mock.calls.some(([path]) => path.includes('/model-trace-metrics'))).toBe(true))
    expect(fetchMock.mock.calls.some(([path]) => path.startsWith('/api/v1/ops/traces'))).toBe(false)
    fetchMock.mockClear()
    fireEvent.click(screen.getByRole('link', { name: '개별 실행 조사' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'AI 실행 추적' })).toBeTruthy()
    expect(await screen.findByText('이 기간에 기록된 실행이 없습니다.')).toBeTruthy()
    expect(fetchMock.mock.calls.some(([path]) => path === '/api/v1/ops/traces')).toBe(true)
    expect(fetchMock.mock.calls.some(([path]) => path.includes('/ai-request-metrics') || path.includes('/model-trace-metrics') || path.includes('/ai-costs'))).toBe(false)
    fireEvent.click(screen.getByRole('link', { name: '전체 현황 보기' }))
    expect(await screen.findByRole('heading', { level: 1, name: '실사용 모니터링' })).toBeTruthy()
  })

  it('예시 모드는 페이지 이동과 사이드바에서 유지되고 실제 API와 가격 쓰기를 차단한다', async () => {
    open('/ops/usage')
    const overview = await screen.findByRole('region', { name: '주요 모니터링 수치' })
    await waitFor(() => expect(within(overview).getByRole('link', { name: /앱 기록 추정 비용/ }).textContent).toContain('0.012'))
    const callsBefore = fetchMock.mock.calls.length
    fireEvent.click(screen.getByRole('button', { name: '예시 데이터로 살펴보기' }))
    expect(await screen.findByText('예시 화면을 보고 있습니다')).toBeTruthy()
    const exampleOverview = screen.getByRole('region', { name: '주요 모니터링 수치' })
    fireEvent.click(within(exampleOverview).getByRole('link', { name: /수집된 모델 실행 오류/ }))
    const modelMetrics = await screen.findByRole('region', { name: '수집된 모델 실행 현황' })
    expect(await within(modelMetrics).findByText('공고 검색 순위')).toBeTruthy()
    expect(within(modelMetrics).getByText(/예시 데이터 · 실제 모델 실행 기록이 아닙니다/)).toBeTruthy()
    expect(screen.getByRole('link', { name: '전체 현황으로 돌아가기' }).getAttribute('href')).toBe('/ops/usage?example=1')
    fireEvent.click(screen.getByRole('link', { name: '전체 현황으로 돌아가기' }))
    fireEvent.click(within(await screen.findByRole('region', { name: '주요 모니터링 수치' })).getByRole('link', { name: /앱 기록 추정 비용/ }))
    expect(await screen.findByText(/예시 데이터 · 아래 사용량과 비용/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: '사용량·비용 가져오기' })).toBeNull()
    expect(screen.queryByRole('form', { name: '가격 추가' })).toBeNull()
    const sidebar = screen.getByRole('link', { name: '실사용 모니터링', current: 'page' })
    expect(sidebar.getAttribute('aria-current')).toBe('page')
    expect(sidebar.getAttribute('href')).toBe('/ops/usage?example=1')
    fireEvent.click(sidebar)
    expect(await screen.findByText('예시 화면을 보고 있습니다')).toBeTruthy()
    expect(screen.queryByRole('link', { name: '개별 실행 조사' })).toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(callsBefore)
    fireEvent.click(screen.getByRole('button', { name: '실제 데이터로 돌아가기' }))
    expect(await screen.findByText('저장된 데이터로 보고 있습니다')).toBeTruthy()
    expect(await screen.findByRole('link', { name: '개별 실행 조사' })).toBeTruthy()
    await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThan(callsBefore))
  })

  it('예시 상세 주소로 바로 열어도 실제 모니터링 API를 호출하지 않는다', async () => {
    open('/ops/usage/models?example=1')
    expect(await screen.findByText('예시 화면을 보고 있습니다')).toBeTruthy()
    expect(await screen.findByText('공고 검색 순위')).toBeTruthy()
    expect(fetchMock.mock.calls.some(([path]) => path.includes('/model-trace-metrics') || path.includes('/ai-costs') || path.includes('/ai-request-metrics'))).toBe(false)
  })

  it('모델 실행 조회가 실패해도 다른 주요 수치를 볼 수 있다', async () => {
    const original = fetchMock.getMockImplementation()!
    fetchMock.mockImplementation((path, options) => path.startsWith('/api/v1/ops/model-trace-metrics?')
      ? Promise.resolve(json({}, 503)) : original(path, options))
    open('/ops/usage')
    const overview = await screen.findByRole('region', { name: '주요 모니터링 수치' })
    const model = within(overview).getByRole('link', { name: /수집된 모델 실행 오류/ })
    await waitFor(() => expect(model.textContent).toContain('조회 실패'))
    await waitFor(() => expect(within(overview).getByRole('link', { name: /앱 기록 추정 비용/ }).textContent).toContain('0.012'))
    expect(within(overview).getByRole('link', { name: /서버 오류 응답/ })).toBeTruthy()
    fireEvent.click(model)
    const modelMetrics = await screen.findByRole('region', { name: '수집된 모델 실행 현황' })
    expect((await within(modelMetrics).findByRole('alert')).textContent).toContain('서버 상태')
  })

  it('실사용 비용 조회 장애는 빈 결과로 숨기지 않고 상세에서 다시 조회한다', async () => {
    const original = fetchMock.getMockImplementation()!
    let failed = true
    fetchMock.mockImplementation((path, options) => failed && path.includes('/api/v1/admin/ai-costs?')
      ? Promise.resolve(json({}, 503)) : original(path, options))
    open('/ops/usage')
    const overview = await screen.findByRole('region', { name: '주요 모니터링 수치' })
    const cost = within(overview).getByRole('link', { name: /앱 기록 추정 비용/ })
    await waitFor(() => expect(cost.textContent).toContain('조회 실패'))
    fireEvent.click(cost)
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', expect.stringContaining('AI 비용을 불러오지 못했어요.'))
    expect(screen.queryByRole('region', { name: '비용 요약' })).toBeNull()
    failed = false
    fireEvent.click(screen.getByRole('button', { name: '다시 시도' }))
    expect(await screen.findByRole('region', { name: '비용 요약' })).toBeTruthy()
  })

  it.each(['summary', 'sync', 'price'] as const)('실사용 %s 요청의 세션이 만료되면 비용을 지우고 로그인으로 돌아간다', async (operation) => {
    const original = fetchMock.getMockImplementation()!
    fetchMock.mockImplementation((path, options) => {
      if ((operation === 'summary' && path.includes('/api/v1/admin/ai-costs?'))
        || (operation === 'sync' && path.endsWith('/ai-costs/sync'))
        || (operation === 'price' && path.endsWith('/ai-costs/prices') && options?.method === 'POST')) {
        authenticated = false
        return Promise.resolve(json({}, 401))
      }
      if (path.includes('/api/v1/admin/ai-costs?')) return Promise.resolve(json({ ...serviceUsage, actualConfigured: true }))
      return original(path, options)
    })
    open('/ops/usage/costs')
    if (operation !== 'summary') {
      await screen.findByRole('region', { name: '비용 요약' })
      if (operation === 'sync') fireEvent.click(screen.getByRole('button', { name: '사용량·비용 가져오기' }))
      else {
        fireEvent.click(screen.getByText('모델 가격표와 단가 설정'))
        const form = within(screen.getByRole('form', { name: '가격 추가' }))
        fireEvent.change(form.getByLabelText('모델'), { target: { value: 'gpt-6-luna' } })
        fireEvent.change(form.getByLabelText('입력'), { target: { value: '1' } })
        fireEvent.change(form.getByLabelText('출력'), { target: { value: '2' } })
        fireEvent.click(form.getByRole('button', { name: '가격 추가' }))
      }
    }
    expect(await screen.findByRole('heading', { name: '로그인' })).toBeTruthy()
    expect(screen.queryByRole('region', { name: '비용 요약' })).toBeNull()
    expect(screen.queryByText('member@example.com')).toBeNull()
  })

  it('Core에서 실사용 조회 권한을 거절하면 회원 정보를 표시하지 않는다', async () => {
    const original = fetchMock.getMockImplementation()!
    fetchMock.mockImplementation((path, options) => path.includes('/api/v1/admin/ai-costs?')
      ? Promise.resolve(json({}, 403)) : original(path, options))
    open('/ops/usage/costs')
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', expect.stringContaining('관리자 권한이 필요해요.'))
    expect(screen.queryByRole('region', { name: '비용 요약' })).toBeNull()
    expect(screen.queryByRole('region', { name: '가격표' })).toBeNull()
  })

  it('실행 상세의 Prefect 로그 버튼은 localhost 대신 관리자 API로 조회한다', async () => {
    const original = fetchMock.getMockImplementation()!
    fetchMock.mockImplementation((path, options) => path === `/api/v1/ops/evaluations/${id}/logs?offset=0`
      ? Promise.resolve(json({ run_id: id, prefect_flow_run_id: flowId, offset: 0, next_offset: null, results: [] }))
      : original(path, options))
    open(`/ops/evaluations/${id}`)
    fireEvent.click(await screen.findByText('보고서와 Prefect 실행 로그 보기'))
    fireEvent.click(screen.getByRole('button', { name: '기록 불러오기' }))
    await screen.findByText('저장된 기록이 없습니다.')
    expect(screen.queryByRole('link', { name: '기록 불러오기' })).toBeNull()
    expect(fetchMock.mock.calls.some(([path]) => path.startsWith('http://localhost:14200'))).toBe(false)
  })

  it.each([['limits', false], ['legacy', false], ['limits', true], ['daily', false], ['daily', true]] as const)('%s 저장 후 이전 사전 점검을 지우며 늦은 조회=%s도 무시한다', async (kind, delayed) => {
    const at = '2026-10-03T01:00:00Z'
    const readiness = {
      as_of: at, dataset_id: dataset.id, execution_profile: executionProfiles.live,
      evaluation_scope: dataset.evaluation_scope, model: liveConfig.model, state: 'checked',
      required: { calls: 6, input_tokens: 196608, output_tokens: 12000 },
      remaining: { calls: 12, input_tokens: 400000, output_tokens: 24000 }, blockers: [], warnings: [],
    }
    const usage = { calls: 1, input_tokens: 100, output_tokens: 50 }
    const zero = { calls: 0, input_tokens: 0, output_tokens: 0 }
    let resolve!: (response: Response) => void
    const pending = new Promise<Response>((done) => { resolve = done })
    const original = fetchMock.getMockImplementation()!
    fetchMock.mockImplementation(async (path, options) => {
      if (path.includes('/live-readiness?')) return delayed ? pending : json(readiness)
      if (path.startsWith('/api/v1/ops/budget/reservations')) return json({
        as_of: at, count: 0, next: null, previous: null, results: [], summary: {
          state: 'consistent', limits_revision: 'a'.repeat(64), limits: readiness.remaining,
          allocated: zero, remaining: readiness.remaining, breakdown: null,
          reservation_count: 0, legacy_live_run_count: 1, change_count: 0, recent_changes: [],
          daily: { limits_revision: 'b'.repeat(64), state: 'disabled', timezone: 'Asia/Seoul', period_start: '2026-10-03T00:00:00+09:00', period_end: '2026-10-04T00:00:00+09:00', limits: null, current_day: null, carried: null, allocated: null, remaining: null, recent_changes: [] },
        },
      })
      if (path.includes('/unaccounted-runs')) return json({ as_of: at, count: 1, next: null, previous: null,
        results: [{ run_id: id, dataset_id: dataset.id, dataset_label: '과거 평가', status: 'COMPLETED', status_label: '완료', created_at: at }] })
      if (path.endsWith('/legacy-usage-preview')) return json({ as_of: at, run_id: id, applied: false, state: 'verified', can_apply: true, blockers: [],
        source: 'SAVED_CAPTURE', provider_receipt_verified: false, capture_sha256: 'b'.repeat(64), evidence_sha256: 'c'.repeat(64), usage, before: zero, after: usage })
      if (path.endsWith('/legacy-usage')) return json({ applied: true, replayed: false, record: {
        ...JSON.parse(options!.body as string), run_id: id, actor: 'core:99', actor_source: 'CORE_ADMIN', created_at: at,
        source: 'SAVED_CAPTURE', provider_receipt_verified: false, capture_sha256: 'b'.repeat(64), usage, before: zero, after: usage,
      } })
      if (path.endsWith('/budget/limits')) {
        const value = JSON.parse(options!.body as string)
        return json({ change: { request_id: value.request_id, actor: 'core:99', source: 'CORE_ADMIN', reason: value.reason,
          previous_limits: readiness.remaining, limits: { calls: value.calls, input_tokens: value.input_tokens, output_tokens: value.output_tokens }, created_at: at } })
      }
      if (path.endsWith('/budget/daily-limits')) {
        const value = JSON.parse(options!.body as string)
        return json({ change: { request_id: value.request_id, expected_revision: value.expected_revision, actor: 'core:99', source: 'CORE_ADMIN', reason: value.reason,
          previous: null, policy: { enabled: true, limits: { calls: value.calls, input_tokens: value.input_tokens, output_tokens: value.output_tokens } }, created_at: at } })
      }
      return original(path, options)
    })
    open()
    await evaluationStep(2)
    fireEvent.click(await screen.findByRole('radio', { name: '새 응답 생성' }))
    await evaluationStep(3)
    fireEvent.click(screen.getByRole('button', { name: '실행 설정·예산 점검' }))
    if (!delayed) await screen.findByText('현재 점검에서 차단된 항목은 없어요.')
    fireEvent.click(screen.getByRole('link', { name: '예산 관리' }))
    if (kind === 'limits') {
      fireEvent.click(await screen.findByRole('button', { name: '전체 한도 변경하기' }))
      fireEvent.click(screen.getByRole('button', { name: '필요량 확인 없이 직접 입력' }))
      fireEvent.change(screen.getByLabelText('한도 변경 사유'), { target: { value: '실행 준비 한도 검토' } })
      fireEvent.click(screen.getByRole('button', { name: '입력 내용 확인' }))
      fireEvent.click(screen.getByRole('button', { name: '확인한 한도 저장' }))
      await screen.findByText('누적 한도 변경 이력을 저장했습니다.')
    } else if (kind === 'daily') {
      expect(await screen.findByRole('heading', { name: '하루 평가 한도' })).toBeTruthy()
      fireEvent.click(await screen.findByRole('button', { name: '하루 한도 설정하기' }))
      fireEvent.change(screen.getByLabelText('AI 요청 (회)'), { target: { value: '12' } })
      fireEvent.change(screen.getByLabelText('AI에 보내는 내용 (입력 토큰)'), { target: { value: '400000' } })
      fireEvent.change(screen.getByLabelText('AI 답변 (출력 토큰)'), { target: { value: '24000' } })
      fireEvent.change(screen.getByLabelText('일별 한도 변경 사유'), { target: { value: '일별 한도 확인' } })
      fireEvent.click(screen.getByRole('button', { name: '일별 변경 내용 확인' }))
      fireEvent.click(screen.getByRole('button', { name: '확인한 일별 정책 저장' }))
      await screen.findByText('일별 정책 변경 이력을 저장했습니다.')
    } else {
      fireEvent.click(await screen.findByRole('button', { name: '이전 평가 기록 확인하기' }))
      fireEvent.click(await screen.findByRole('button', { name: `사용량 확인 ${id}` }))
      fireEvent.change(await screen.findByLabelText('사용량 검토 사유'), { target: { value: '전체 응답 검토' } })
      fireEvent.click(screen.getByRole('checkbox', { name: /위 사용량과 출처를 확인/ }))
      fireEvent.click(screen.getByRole('button', { name: '검토한 사용량 반영' }))
      await screen.findByText('검토한 과거 사용량을 장부에 반영했습니다.')
    }
    expect(screen.getByRole('region', { name: '평가 예산' }).id).toBe('evaluation-budget')
    fireEvent.click(screen.getByRole('link', { name: '새 평가' }))
    if (delayed) await act(async () => { resolve(json(readiness)); await pending })
    expect(screen.queryByText('현재 점검에서 차단된 항목은 없어요.')).toBeNull()
    await evaluationStep(3)
    expect(await screen.findByRole('button', { name: '실행 설정·예산 점검' })).toHaveProperty('disabled', false)
    expect(fetchMock.mock.calls.filter(([path]) => path.includes('/live-readiness?'))).toHaveLength(1)
    expect(fetchMock.mock.calls.some(([path, options]) => path === '/api/v1/ops/evaluations' && options?.method === 'POST')).toBe(false)
    expect(screen.queryByRole('region', { name: '평가 예산' })).toBeNull()
  })

  it('선택한 새 모델 평가의 설정·예산만 점검하고 전송 승인을 대신하지 않는다', async () => {
    const original = fetchMock.getMockImplementation()!
    fetchMock.mockImplementation((path, options) => path.includes('/live-readiness?') ? Promise.resolve(json({
      as_of: '2026-10-03T01:00:00Z', dataset_id: dataset.id, execution_profile: executionProfiles.live,
      evaluation_scope: dataset.evaluation_scope, model: liveConfig.model, state: 'checked',
      required: { calls: 6, input_tokens: 196608, output_tokens: 12000 },
      remaining: { calls: 12, input_tokens: 400000, output_tokens: 24000 }, blockers: [], warnings: [],
    })) : original(path, options))
    open()
    await evaluationStep(2)
    const live = await screen.findByRole('radio', { name: '새 응답 생성' })
    expect(screen.queryByRole('button', { name: '실행 설정·예산 점검' })).toBeNull()
    fireEvent.click(live)
    expect(fetchMock.mock.calls.some(([path]) => path.includes('/live-readiness?'))).toBe(false)
    await evaluationStep(3)
    fireEvent.click(screen.getByRole('button', { name: '실행 설정·예산 점검' }))
    await screen.findByText('현재 점검에서 차단된 항목은 없어요.')
    await evaluationStep(3)
    expect((screen.getByRole('button', { name: '새 응답 생성 및 평가' }) as HTMLButtonElement).disabled).toBe(true)
    expect(fetchMock.mock.calls.some(([, options]) => options?.method === 'POST')).toBe(false)
    expect(readPendingEvaluation('core:99')).toBeNull()
    await evaluationStep(1)
    fireEvent.change(screen.getByLabelText('평가 자료'), { target: { value: comparisonDataset.id } })
    expect(screen.queryByText('현재 점검에서 차단된 항목은 없어요.')).toBeNull()
    expect(fetchMock.mock.calls.filter(([path]) => path.includes('/live-readiness?'))).toHaveLength(1)
  })

  it('실행 상세의 모바일 메뉴는 필요할 때 열어 이동한다', async () => {
    open(`/ops/evaluations/${id}`)
    const menu = await screen.findByText('운영 메뉴 보기')
    expect(menu.closest('details')).toHaveProperty('open', false)
    fireEvent.click(menu)
    expect(menu.closest('details')).toHaveProperty('open', true)
    expect(within(menu.closest('details')!).getByRole('link', { name: '평가 이력' })).toHaveProperty('pathname', '/ops/evaluations')
  })

  it('실행 상세에서 평가 개요와 결과를 먼저 안내한다', async () => {
    open(`/ops/evaluations/${id}`)
    const overview = await screen.findByRole('region', { name: '이번 평가 한눈에 보기' })
    expect(within(overview).getByText(dataset.label + ' · ' + new Date(completed.created_at).toLocaleString('ko-KR'))).toBeTruthy()
    expect(within(overview).queryByText(/실제 서비스의 공고 검색 성능은 측정하지 않았어요/)).toBeNull()
    const result = screen.getByRole('region', { name: '평가 결과' })
    expect(within(result).getByRole('heading', { name: '결과 요약' })).toBeTruthy()
    expect(within(result).queryByText(/답변과 공고 내용을 직접 확인/)).toBeNull()
    expect(screen.queryByRole('button', { name: '상태 다시 확인' })).toBeNull()
    const help = within(result).getByRole('button', { name: '필요한 근거 표시 도움말' })
    expect(help.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByText(/필요하다고 정한 근거를 답변에 표시/)).toBeNull()
    fireEvent.click(help)
    expect(help.getAttribute('aria-expanded')).toBe('true')
    const explanation = await screen.findByText(/필요하다고 정한 근거를 답변에 표시/)
    expect(result.contains(explanation)).toBe(false)
    expect(help.getAttribute('aria-controls')).toBe(explanation.parentElement?.id)
    expect(help.getAttribute('aria-describedby')).toBe(explanation.parentElement?.id)
    const otherHelp = within(result).getByRole('button', { name: '확인한 질문 도움말' })
    fireEvent.pointerDown(otherHelp)
    fireEvent.click(otherHelp)
    expect(help.getAttribute('aria-expanded')).toBe('false')
    expect(otherHelp.getAttribute('aria-expanded')).toBe('true')
    expect(screen.queryByText(/필요하다고 정한 근거를 답변에 표시/)).toBeNull()
    expect(await screen.findByText('평가할 질문 중 결과를 확인한 질문 수예요.')).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(otherHelp.getAttribute('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(otherHelp)
    expect(screen.getByText('AI 사용량 보기').closest('details')).toHaveProperty('open', false)
    expect(screen.getByText('보고서와 Prefect 실행 로그 보기').closest('details')).toHaveProperty('open', false)
    expect(result.compareDocumentPosition(await screen.findByRole('region', { name: '응답 검토와 기준 지정' })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('추가 정보는 같은 펼침 UI로 표시하고 필요한 기록만 직접 불러온다', async () => {
    const execution = { run_id: 'a'.repeat(32), model: 'test-model', prompt_sha256: 'p'.repeat(64), runner_sha256: 'r'.repeat(64), capture_sha256: 'c'.repeat(64), started_at: null, source_case_ids: ['E01'] }
    const comparison = { schema_version: 2, comparison: 'candidate-reference', case_ids: ['E01'], reference_execution: execution, candidate_execution: execution, metrics: [], cases: [] }
    const postprocessing = { inputs_ready: true, stage: 'completed', can_recover: false, blocked_reason: '', can_reassess: true, reassessment_blocked_reason: '', attempts: [] }
    const original = fetchMock.getMockImplementation()!
    fetchMock.mockImplementation((path, options) => {
      if (path === `/api/v1/ops/evaluations/${id}`) return Promise.resolve(json({ ...completed, comparison, postprocessing }))
      if (path === `/api/v1/ops/evaluations/${id}/logs?offset=0`) return Promise.resolve(json({ run_id: id, prefect_flow_run_id: flowId, offset: 0, next_offset: null, results: [] }))
      return original(path, options)
    })
    open(`/ops/evaluations/${id}`)
    const titles = ['AI 사용량 보기', '이전 결과와 비교하기', '보고서와 Prefect 실행 로그 보기']
    const panels = await Promise.all(titles.map(async (title) => {
      const label = await screen.findByText(title)
      const details = label.closest('details')!
      const summary = details.querySelector('summary')!
      expect(details.open).toBe(false)
      expect(summary.className).toContain('min-h-11')
      expect(within(summary).getByText('펼치기 +')).toBeTruthy()
      expect(within(summary).getByText('접기 −')).toBeTruthy()
      return { title, details, summary }
    }))
    expect(fetchMock.mock.calls.some(([path]) => path.includes('/logs?'))).toBe(false)
    fireEvent.click(panels[0].summary)
    expect(panels.map(({ details }) => details.open)).toEqual([true, false, false])
    fireEvent.click(panels[2].summary)
    expect(panels.map(({ details }) => details.open)).toEqual([true, false, true])
    expect(fetchMock.mock.calls.some(([path]) => path.includes('/logs?'))).toBe(false)
    expect(within(panels[2].details).getByRole('link', { name: '평가 보고서 보기' })).toHaveProperty('pathname', `/ops/evaluations/${id}/report`)
    expect(within(panels[2].details).getByRole('link', { name: '상세 점수 보기' }).getAttribute('href')).toBe(completed.langfuse_url)
    fireEvent.click(within(panels[2].details).getByRole('button', { name: '기록 불러오기' }))
    await waitFor(() => expect(fetchMock.mock.calls.filter(([path]) => path.includes('/logs?'))).toHaveLength(1))
    expect(await within(panels[2].details).findByText('저장된 기록이 없습니다.')).toBeTruthy()
    const overview = screen.getByRole('region', { name: '이번 평가 한눈에 보기' })
    expect(within(overview).getByRole('button', { name: '저장 답변 다시 평가' })).toBeTruthy()
    expect(within(overview).getByText('AI를 추가로 호출하지 않고 별도 기록으로 저장해요.')).toBeTruthy()
    expect(screen.queryByText('추가 작업과 처리 기록 보기')).toBeNull()
    expect(fetchMock.mock.calls.some(([, options]) => options?.method === 'POST')).toBe(false)
  })

  it('비교 기록과 추가 작업이 없는 실행에는 해당 펼침을 표시하지 않는다', async () => {
    open(`/ops/evaluations/${id}`)
    await screen.findByText('AI 사용량 보기')
    expect(screen.queryByText('추가 작업과 처리 기록 보기')).toBeNull()
    expect(screen.queryByText('이전 결과와 비교하기')).toBeNull()
    expect(screen.getByText('보고서와 Prefect 실행 로그 보기')).toBeTruthy()
  })

  it('완료된 평가는 불필요한 처리 정보와 차단 안내를 숨긴다', async () => {
    const original = fetchMock.getMockImplementation()!
    fetchMock.mockImplementation((path, options) => path === `/api/v1/ops/evaluations/${id}`
      ? Promise.resolve(json({ ...completed, postprocessing: {
        inputs_ready: false, stage: 'completed', can_recover: false,
        blocked_reason: '실행 종료 상태를 확인한 뒤 실패한 후처리만 복구할 수 있습니다.',
        can_reassess: false, reassessment_blocked_reason: '평가가 종료된 후 재평가할 수 있습니다.', attempts: [],
      } })) : original(path, options))
    open(`/ops/evaluations/${id}`)
    const overview = await screen.findByRole('region', { name: '이번 평가 한눈에 보기' })
    expect(within(overview).queryByText('평가가 끝난 뒤 결과를 다시 정리할 수 있어요.')).toBeNull()
    expect(within(overview).queryByText('평가가 끝난 뒤 다시 평가할 수 있어요.')).toBeNull()
    expect(within(overview).queryByRole('region', { name: '관련 평가 기록' })).toBeNull()
    fireEvent.click(within(overview).getByText('관리자용 기술 정보'))
    expect(within(overview).queryByRole('region', { name: '처리 정보' })).toBeNull()
    expect(within(overview).queryByText(/자료 확인:/)).toBeNull()
    expect(within(overview).queryByText(/마지막 단계:/)).toBeNull()
    expect(within(overview).queryByText(/결과 정리: 실행 종료 상태를 확인한 뒤/)).toBeNull()
    expect(within(overview).queryByText(/다시 평가: 평가가 종료된 후/)).toBeNull()
  })

  it.each([
    ['report', true, '보고서 생성'],
    ['publish', false, '결과 등록'],
    ['completed', true, '결과 정리 완료'],
    ['unverified', false, '확인할 수 없음'],
  ] as const)('실패한 평가의 %s 단계와 복구 자료 확인 여부 %s를 구분한다', async (stage, inputsReady, stageLabel) => {
    const original = fetchMock.getMockImplementation()!
    fetchMock.mockImplementation((path, options) => path === `/api/v1/ops/evaluations/${id}`
      ? Promise.resolve(json({ ...completed, status: 'FAILED', status_label: '실패', postprocessing: {
        inputs_ready: inputsReady, stage, can_recover: false, blocked_reason: '',
        can_reassess: false, reassessment_blocked_reason: '', attempts: [],
      } })) : original(path, options))
    open(`/ops/evaluations/${id}`)
    const technical = await screen.findByText('관리자용 기술 정보')
    fireEvent.click(technical)
    const info = within(technical.closest('details')!)
    expect(info.getByText(`저장된 답변으로 결과를 다시 정리할 자료: ${inputsReady ? '확인됨' : '확인할 수 없음'}`)).toBeTruthy()
    expect(info.getByText(`결과 처리에서 마지막으로 기록된 단계: ${stageLabel}`)).toBeTruthy()
    expect(info.queryByText(/자료 확인:/)).toBeNull()
    expect(info.queryByText(/마지막 단계:/)).toBeNull()
    expect(fetchMock.mock.calls.some(([, options]) => options?.method === 'POST')).toBe(false)
  })

  it('완료된 평가에서 관련 이력과 실제 재평가 제한 사유는 보존한다', async () => {
    const original = fetchMock.getMockImplementation()!
    const child = '30000000-0000-4000-8000-000000000003'
    fetchMock.mockImplementation((path, options) => path === `/api/v1/ops/evaluations/${id}`
      ? Promise.resolve(json({ ...completed, postprocessing: {
        inputs_ready: true, stage: 'completed', can_recover: false, blocked_reason: '',
        can_reassess: false, reassessment_blocked_reason: '같은 평가기로 재평가한 기록이 있습니다. 결과 또는 실패 원인을 확인해 주세요.',
        attempts: [{ id: child, status: 'FAILED', status_label: '실패', recovery_kind: 'reassessment' }],
      } })) : original(path, options))
    open(`/ops/evaluations/${id}`)
    const overview = await screen.findByRole('region', { name: '이번 평가 한눈에 보기' })
    expect(within(overview).getByRole('link', { name: '1번째 다시 평가 · 실패' }).getAttribute('href')).toBe(`/ops/evaluations/${child}`)
    fireEvent.click(within(overview).getByText('관리자용 기술 정보'))
    expect(within(overview).getByText(/같은 평가기로 재평가한 기록이 있습니다/)).toBeTruthy()
  })

  it.each([
    { status_stale: true },
    { error_code: 'PREFECT_STATUS_UNAVAILABLE' },
    { can_retry: true },
  ])('완료된 실행의 재평가 버튼은 기존 표시 조건을 유지한다: %j', async (changes) => {
    const original = fetchMock.getMockImplementation()!
    fetchMock.mockImplementation((path, options) => path === `/api/v1/ops/evaluations/${id}`
      ? Promise.resolve(json({ ...completed, ...changes, postprocessing: {
        inputs_ready: true, stage: 'completed', can_recover: false, blocked_reason: '',
        can_reassess: true, reassessment_blocked_reason: '', attempts: [],
      } })) : original(path, options))
    open(`/ops/evaluations/${id}`)
    const overview = await screen.findByRole('region', { name: '이번 평가 한눈에 보기' })
    expect(within(overview).getAllByRole('button', { name: '저장 답변 다시 평가' })).toHaveLength(1)
  })

  it('완료 안내는 반복하지 않고 저장된 답변의 평가 정보를 구분한다', async () => {
    open(`/ops/evaluations/${id}`)
    const overview = await screen.findByRole('region', { name: '이번 평가 한눈에 보기' })
    expect(within(overview).queryByText('아래 결과를 보고 답변을 확인해 주세요.')).toBeNull()
    expect(within(overview).getByText(/현재 모델의 성능을 새로 측정한 것은 아니에요/)).toBeTruthy()
    const toggle = within(overview).getByText('평가 정보 보기')
    expect(toggle.closest('details')).toHaveProperty('open', false)
    fireEvent.click(toggle)
    const info = within(toggle.closest('details')!)
    expect(info.getByText('평가 방법').nextElementSibling?.textContent).toBe('저장된 답변 확인')
    expect(info.getByText('확인한 범위').nextElementSibling?.textContent).toContain('준비된 공고 내용으로 답변 확인')
    expect(info.getByText('비교 기준').nextElementSibling?.textContent).toBe(capture.label)
    expect(info.getByText('확인한 답변').nextElementSibling?.textContent).toBe(capture.label)
    expect(info.getByText('요청한 사람').nextElementSibling?.textContent).toBe('operator@example.com')
    expect(info.queryByText('답변 모델')).toBeNull()
    expect(info.queryByText('관리자용 기술 정보')).toBeNull()
    const technical = within(overview).getByText('관리자용 기술 정보')
    expect(technical.closest('details')).toHaveProperty('open', false)
    fireEvent.click(technical)
    const technicalInfo = within(technical.closest('details')!)
    expect(technicalInfo.getByRole('heading', { name: '처리 시간' })).toBeTruthy()
    expect(technicalInfo.getByRole('heading', { name: '평가 설정과 호출 한도' })).toBeTruthy()
    expect(technicalInfo.getByRole('heading', { name: '식별 번호' })).toBeTruthy()
    expect(technicalInfo.getByText('시작 시각').nextElementSibling?.textContent).toBe('기록 없음')
    expect(technicalInfo.getByText('요청 번호').nextElementSibling?.textContent).toBe(id)
    const help = technicalInfo.getByRole('button', { name: '식별 번호 도움말' })
    expect(help.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(help)
    expect(help.getAttribute('aria-expanded')).toBe('true')
    expect(technicalInfo.getByText(/문제 확인이나 기록 대조에 사용하는 번호/)).toBeTruthy()
  })

  it('기술 정보는 평가 정보를 열지 않고 확인하며 미확인 호출을 0회로 표시하지 않는다', async () => {
    const original = fetchMock.getMockImplementation()!
    fetchMock.mockImplementation((path, options) => path === `/api/v1/ops/evaluations/${id}`
      ? Promise.resolve(json({ ...completed, status: 'FAILED', status_label: '실패', model_api_calls: null })) : original(path, options))
    open(`/ops/evaluations/${id}`)
    const technical = await screen.findByText('관리자용 기술 정보')
    fireEvent.click(technical)
    const info = within(technical.closest('details')!)
    expect(info.getByText('AI 호출 시도').nextElementSibling?.textContent).toBe('아직 확인되지 않음')
    expect(screen.getByText('평가 정보 보기').closest('details')).toHaveProperty('open', false)
  })

  it('새로 만든 답변의 평가 정보에는 기록된 모델을 표시한다', async () => {
    const original = fetchMock.getMockImplementation()!
    fetchMock.mockImplementation((path, options) => path === `/api/v1/ops/evaluations/${id}`
      ? Promise.resolve(json({ ...completed, execution_mode: 'live', live_config: liveConfig })) : original(path, options))
    open(`/ops/evaluations/${id}`)
    fireEvent.click(await screen.findByText('평가 정보 보기'))
    const info = within(screen.getByText('평가 정보 보기').closest('details')!)
    expect(info.getByText('평가 방법').nextElementSibling?.textContent).toBe('새 답변을 만들어 평가')
    expect(info.getByText('답변 모델').nextElementSibling?.textContent).toBe(liveConfig.model)
    fireEvent.click(screen.getByText('관리자용 기술 정보'))
    const technicalInfo = within(screen.getByText('관리자용 기술 정보').closest('details')!)
    expect(technicalInfo.getByText('허용된 최대 호출').nextElementSibling?.textContent).toBe('6회')
    expect(technicalInfo.getByText('한 번에 입력할 수 있는 양').nextElementSibling?.textContent).toBe('기록 없음')
    expect(technicalInfo.getByRole('button', { name: '평가 설정과 호출 한도 도움말' }).getAttribute('aria-expanded')).toBe('false')
    expect(within(screen.getByRole('region', { name: '이번 평가 한눈에 보기' })).queryByText(/실제 서비스의 공고 검색 성능은 측정하지 않았어요/)).toBeNull()
  })

  it.each([
    ['fixed-answer-context-only', 'replay', '미리 준비한 공고 내용으로 답변을 확인해요. 실제 서비스의 공고 검색 성능은 측정하지 않았어요.'],
    ['fixed-answer-context-only', 'live', '미리 준비한 공고 내용으로 답변을 확인해요. 실제 서비스의 공고 검색 성능은 측정하지 않았어요.'],
    ['source-chunks-retrieval-answer', 'replay', '정해진 공고 안에서 내용을 찾고 답변한 결과를 확인해요. 실제 서비스의 공고 검색 성능은 측정하지 않았어요.'],
    ['source-chunks-retrieval-answer', 'live', '정해진 공고 안에서 내용을 찾고 답변한 결과를 확인해요. 실제 서비스의 공고 검색 성능은 측정하지 않았어요.'],
    [null, 'replay', '평가 범위가 기록되지 않아 무엇을 확인했는지 알 수 없어요.'],
  ] as const)('평가 범위 %s와 방식 %s의 설명은 평가 정보 도움말에서만 연다', async (scope, mode, explanation) => {
    const original = fetchMock.getMockImplementation()!
    fetchMock.mockImplementation((path, options) => path === `/api/v1/ops/evaluations/${id}`
      ? Promise.resolve(json({ ...completed, evaluation_scope: scope, execution_mode: mode, live_config: mode === 'live' ? liveConfig : null }))
      : original(path, options))
    open(`/ops/evaluations/${id}`)
    const overview = await screen.findByRole('region', { name: '이번 평가 한눈에 보기' })
    expect(within(overview).queryByText(/실제 서비스의 공고 검색 성능은 측정하지 않았어요/)).toBeNull()
    if (mode === 'replay') expect(within(overview).getByText(/현재 모델의 성능을 새로 측정한 것은 아니에요/)).toBeTruthy()
    fireEvent.click(within(overview).getByText('평가 정보 보기'))
    const info = within(within(overview).getByText('평가 정보 보기').closest('details')!)
    const help = info.getByRole('button', { name: '확인한 범위 도움말' })
    expect(help.getAttribute('aria-expanded')).toBe('false')
    expect(info.queryByText(explanation)).toBeNull()
    fireEvent.click(help)
    expect(help.getAttribute('aria-expanded')).toBe('true')
    expect(info.getByText(explanation)).toBeTruthy()
    fireEvent.click(help)
    expect(help.getAttribute('aria-expanded')).toBe('false')
    expect(info.queryByText(explanation)).toBeNull()
  })

  it('범위 도움말을 열고 닫아도 항목은 위쪽에 고정되고 도움말에 초점이 유지된다', async () => {
    open(`/ops/evaluations/${id}`)
    const overview = await screen.findByRole('region', { name: '이번 평가 한눈에 보기' })
    fireEvent.click(within(overview).getByText('평가 정보 보기'))
    const info = within(within(overview).getByText('평가 정보 보기').closest('details')!)
    const label = info.getByText('확인한 범위')
    const help = info.getByRole('button', { name: '확인한 범위 도움말' })
    expect(label.classList.contains('self-start')).toBe(true)
    help.focus()
    fireEvent.click(help)
    expect(help.getAttribute('aria-expanded')).toBe('true')
    expect(info.getByText('확인한 범위')).toBe(label)
    expect(label.classList.contains('self-start')).toBe(true)
    expect(document.activeElement).toBe(help)
    fireEvent.click(help)
    expect(help.getAttribute('aria-expanded')).toBe('false')
    expect(info.getByText('확인한 범위')).toBe(label)
    expect(label.classList.contains('self-start')).toBe(true)
    expect(document.activeElement).toBe(help)
  })

  it('실패하면 가능한 다음 행동과 오류 내용을 구분해서 보여준다', async () => {
    const original = fetchMock.getMockImplementation()!
    fetchMock.mockImplementation((path, options) => path === `/api/v1/ops/evaluations/${id}`
      ? Promise.resolve(json({ ...completed, status: 'FAILED', status_label: '실패', error_message: '보고서를 저장할 수 없습니다.', postprocessing: { inputs_ready: true, stage: 'report', can_recover: true, blocked_reason: '', attempts: [] } }))
      : original(path, options))
    open(`/ops/evaluations/${id}`)
    expect(await screen.findByRole('heading', { name: '평가를 끝내지 못했어요' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '결과 정리 다시 시도' })).toBeTruthy()
    expect(screen.getByText('이미 만든 답변으로 결과를 다시 정리해요. AI를 추가로 호출하지 않아요.')).toBeTruthy()
    expect(screen.getByText('문제 자세히 보기').closest('details')).toHaveProperty('open', false)
    expect(screen.queryByRole('region', { name: '평가 결과' })).toBeNull()
  })

  it.each(['FAILED', 'CRASHED'] as const)('%s에서는 결과 정리를 우선 안내하고 명시적으로 요청하기 전에는 실행하지 않는다', async (status) => {
    const original = fetchMock.getMockImplementation()!
    fetchMock.mockImplementation((path, options) => path === `/api/v1/ops/evaluations/${id}`
      ? Promise.resolve(json({ ...completed, status, error_message: '보고서를 저장할 수 없습니다.', postprocessing: {
        inputs_ready: true, stage: 'report', can_recover: true, blocked_reason: '', can_reassess: true,
        reassessment_blocked_reason: '', attempts: [],
      } })) : original(path, options))
    open(`/ops/evaluations/${id}`)
    const overview = await screen.findByRole('region', { name: '이번 평가 한눈에 보기' })
    expect(within(overview).getByRole('heading', { name: '평가를 끝내지 못했어요' })).toBeTruthy()
    expect(within(overview).getByRole('button', { name: '결과 정리 다시 시도' })).toBeTruthy()
    expect(within(overview).queryByRole('button', { name: '저장 답변 다시 평가' })).toBeNull()
    expect(within(overview).queryByRole('link', { name: '새 평가 만들기' })).toBeNull()
    expect(within(overview).getByText('문제 자세히 보기').closest('details')).toHaveProperty('open', false)
    expect(fetchMock.mock.calls.some(([, options]) => options?.method === 'POST')).toBe(false)
  })

  it('접수 확인이 필요하면 우선 안내하고 가능한 결과 정리도 보존한다', async () => {
    const original = fetchMock.getMockImplementation()!
    fetchMock.mockImplementation((path, options) => path === `/api/v1/ops/evaluations/${id}`
      ? Promise.resolve(json({ ...completed, status: 'FAILED', can_retry: true, postprocessing: {
        inputs_ready: true, stage: 'report', can_recover: true, blocked_reason: '', can_reassess: true,
        reassessment_blocked_reason: '', attempts: [],
      } })) : original(path, options))
    open(`/ops/evaluations/${id}`)
    const overview = await screen.findByRole('region', { name: '이번 평가 한눈에 보기' })
    const retry = within(overview).getByRole('button', { name: '접수 다시 확인' })
    const recover = within(overview).getByRole('button', { name: '결과 정리 다시 시도' })
    expect(retry.compareDocumentPosition(recover) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(within(overview).getByText('이미 만든 답변으로 결과를 다시 정리할 수도 있어요. AI를 추가로 호출하지 않아요.')).toBeTruthy()
    expect(within(overview).queryByRole('button', { name: '저장 답변 다시 평가' })).toBeNull()
    expect(fetchMock.mock.calls.some(([, options]) => options?.method === 'POST')).toBe(false)
  })

  it('복구할 수 없는 중단에는 새 평가를 안내하고 원인을 추측하지 않는다', async () => {
    const original = fetchMock.getMockImplementation()!
    fetchMock.mockImplementation((path, options) => path === `/api/v1/ops/evaluations/${id}`
      ? Promise.resolve(json({ ...completed, status: 'CRASHED', error_code: '', error_message: '', postprocessing: {
        inputs_ready: false, stage: 'unverified', can_recover: false, blocked_reason: '완료된 응답을 확인할 수 없습니다.',
        can_reassess: false, reassessment_blocked_reason: '', attempts: [],
      } })) : original(path, options))
    open(`/ops/evaluations/${id}`)
    const overview = await screen.findByRole('region', { name: '이번 평가 한눈에 보기' })
    expect(within(overview).getByRole('alert').textContent).toBe('평가 중 문제가 생겼어요.')
    expect(within(overview).getByText('평가를 다시 시작하려면 새 평가를 만들어 주세요.')).toBeTruthy()
    expect(within(overview).getByRole('link', { name: '새 평가 만들기' }).getAttribute('href')).toBe('/ops/evaluations/new')
    const details = within(overview).getByText('문제 자세히 보기').closest('details')!
    expect(details.open).toBe(false)
    expect(within(details).getByText('지금은 결과를 다시 정리할 수 없어요. 자세한 내용은 관리자에게 확인해 주세요.')).toBeTruthy()
    expect(fetchMock.mock.calls.some(([, options]) => options?.method === 'POST')).toBe(false)
  })

  it('결과 정리 요청 중 중복 요청을 막고 실패하면 화면과 다시 시도할 방법을 유지한다', async () => {
    const original = fetchMock.getMockImplementation()!
    let finish: (response: Response) => void = () => {}
    fetchMock.mockImplementation((path, options) => {
      if (path === `/api/v1/ops/evaluations/${id}`) return Promise.resolve(json({ ...completed, status: 'FAILED', postprocessing: {
        inputs_ready: true, stage: 'report', can_recover: true, blocked_reason: '', attempts: [],
      } }))
      if (path === `/api/v1/ops/evaluations/${id}/recover`) return new Promise<Response>((resolve) => { finish = resolve })
      return original(path, options)
    })
    open(`/ops/evaluations/${id}`)
    fireEvent.click(await screen.findByRole('button', { name: '결과 정리 다시 시도' }))
    const submitting = await screen.findByRole('button', { name: '요청 중…' })
    expect(submitting).toHaveProperty('disabled', true)
    fireEvent.click(submitting)
    expect(fetchMock.mock.calls.filter(([path]) => path.endsWith('/recover'))).toHaveLength(1)
    await act(async () => finish(json({ detail: '다시 시도해 주세요.' }, 503)))
    expect(await screen.findByRole('heading', { name: '평가를 끝내지 못했어요' })).toBeTruthy()
    expect(await screen.findByRole('button', { name: '결과 정리 다시 시도' })).toHaveProperty('disabled', false)
    expect(screen.getByText('운영 서버 응답을 확인할 수 없습니다.')).toBeTruthy()
  })

  it('평가 설정 오류는 쉬운 해결 방법을 먼저 보여주고 원본은 보존한다', async () => {
    const original = fetchMock.getMockImplementation()!
    fetchMock.mockImplementation((path, options) => path === `/api/v1/ops/evaluations/${id}`
      ? Promise.resolve(json({ ...completed, status: 'FAILED', status_label: '실패', error_code: 'EXECUTION_SPEC_MISMATCH', error_message: '접수 당시 명세와 실행 환경이 달라 모델 호출 전에 차단했습니다.' }))
      : original(path, options))
    open(`/ops/evaluations/${id}`)
    expect((await screen.findByRole('alert')).textContent).toBe('평가 설정이 바뀌어 시작하지 못했어요. 설정을 확인한 뒤 새 평가를 만들어 주세요.')
    fireEvent.click(screen.getByText('문제 자세히 보기'))
    const originalMessage = screen.getByText('관리자용 원본 메시지')
    expect(originalMessage.closest('details')).toHaveProperty('open', false)
    fireEvent.click(originalMessage)
    expect(screen.getByText('접수 당시 명세와 실행 환경이 달라 모델 호출 전에 차단했습니다.')).toBeTruthy()
  })

  it('상태 확인이 지연되면 실행 실패로 단정하지 않는다', async () => {
    const original = fetchMock.getMockImplementation()!
    fetchMock.mockImplementation((path, options) => path === `/api/v1/ops/evaluations/${id}`
      ? Promise.resolve(json({ ...completed, status: 'FAILED', status_stale: true, error_code: 'PREFECT_STATUS_UNAVAILABLE', status_label: '상태 확인 실패', error_message: '실행 서버 연결 실패' }))
      : original(path, options))
    open(`/ops/evaluations/${id}`)
    expect(await screen.findByRole('heading', { name: '현재 상태를 확인할 수 없어요' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '상태 다시 확인' })).toBeTruthy()
    expect(screen.queryByRole('link', { name: '새 평가 만들기' })).toBeNull()
  })

  it('자동으로 상태를 확인하는 실행에는 수동 버튼을 보이지 않는다', async () => {
    const original = fetchMock.getMockImplementation()!
    fetchMock.mockImplementation((path, options) => path === `/api/v1/ops/evaluations/${id}`
      ? Promise.resolve(json({ ...completed, status: 'RUNNING', status_label: '실행 중', report_url: null }))
      : original(path, options))
    open(`/ops/evaluations/${id}`)
    expect(await screen.findByText('상태를 자동으로 확인하고 있어요.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: '상태 다시 확인' })).toBeNull()
  })

  it('자동 조회를 할 수 없는 대기 상태에는 상태 확인 버튼을 제공한다', async () => {
    const original = fetchMock.getMockImplementation()!
    fetchMock.mockImplementation((path, options) => path === `/api/v1/ops/evaluations/${id}`
      ? Promise.resolve(json({ ...completed, status: 'QUEUED', status_label: '실행 대기', prefect_flow_run_id: null, can_retry: false, report_url: null }))
      : original(path, options))
    open(`/ops/evaluations/${id}`)
    expect(await screen.findByRole('button', { name: '상태 다시 확인' })).toBeTruthy()
  })

  it('첫 조회에 실패하면 다시 불러올 수 있다', async () => {
    const original = fetchMock.getMockImplementation()!
    let reads = 0
    fetchMock.mockImplementation((path, options) => path === `/api/v1/ops/evaluations/${id}`
      ? Promise.resolve(++reads === 1 ? json({}, 503) : json(completed))
      : original(path, options))
    open(`/ops/evaluations/${id}`)
    fireEvent.click(await screen.findByRole('button', { name: '다시 불러오기' }))
    expect(await screen.findByRole('heading', { name: '평가가 끝났어요' })).toBeTruthy()
    expect(reads).toBe(2)
  })

  it('고정 근거 답변의 인용 지표를 검색 품질과 구분한다', async () => {
    open(`/ops/evaluations/${id}`)
    const overview = await screen.findByRole('region', { name: '이번 평가 한눈에 보기' })
    expect(within(overview).queryByText(/실제 서비스의 공고 검색 성능은 측정하지 않았어요/)).toBeNull()
    fireEvent.click(within(overview).getByText('평가 정보 보기'))
    const info = within(within(overview).getByText('평가 정보 보기').closest('details')!)
    expect(info.getByText('준비된 공고 내용으로 답변 확인')).toBeTruthy()
    fireEvent.click(info.getByRole('button', { name: '확인한 범위 도움말' }))
    expect(info.getByText(/실제 서비스의 공고 검색 성능은 측정하지 않았어요/)).toBeTruthy()
  })

  it('평가 범위가 없는 세션에서는 새 평가를 접수하지 않는다', async () => {
    const original = fetchMock.getMockImplementation()!
    fetchMock.mockImplementation((path, options) => path === '/api/v1/ops/evaluation-catalog'
      ? Promise.resolve(json({ ...session(), datasets: [{ ...dataset, evaluation_scope: null }] }))
      : original(path, options))
    open()
    const button = await screen.findByRole('button', { name: '다음: 답변 확인 방법' })
    fireEvent.change(screen.getByRole('combobox', { name: '평가 자료' }), { target: { value: dataset.id } })
    expect(button).toHaveProperty('disabled', true)
    expect(screen.getByText(/평가 범위를 확인할 수 없어 실행할 수 없습니다/)).toBeTruthy()
    fireEvent.click(button)
    expect(fetchMock.mock.calls.some(([path, options]) => path === '/api/v1/ops/evaluations' && options?.method === 'POST')).toBe(false)
  })

  it('범위가 기록되지 않은 과거 실행에 검색 평가를 추정해 표시하지 않는다', async () => {
    const original = fetchMock.getMockImplementation()!
    fetchMock.mockImplementation((path, options) => path === `/api/v1/ops/evaluations/${id}`
      ? Promise.resolve(json({ ...completed, evaluation_scope: null }))
      : original(path, options))
    open(`/ops/evaluations/${id}`)
    const overview = await screen.findByRole('region', { name: '이번 평가 한눈에 보기' })
    expect(within(overview).getByText(/평가 범위를 확인할 수 없/)).toBeTruthy()
    fireEvent.click(within(overview).getByText('평가 정보 보기'))
    const info = within(within(overview).getByText('평가 정보 보기').closest('details')!)
    expect(info.getByText('확인한 범위').nextElementSibling?.textContent).toContain('기록 없음')
    expect(info.queryByText('준비된 공고 내용으로 답변 확인')).toBeNull()
  })

  it('관리자 세션으로 내부 실행 추적을 열고 외부 Langfuse 링크를 사용하지 않는다', async () => {
    const original = fetchMock.getMockImplementation()!
    fetchMock.mockImplementation((path, options) => {
      if (path === '/api/v1/ops/session') return Promise.resolve(json({ ...session(), search_traces_url: 'https://blocked.cloudfront.net/project/test/traces' }))
      if (path === '/api/v1/ops/traces') return Promise.resolve(json({ results: [], next_cursor: null, from_time: '2026-10-07T00:00:00Z', to_time: '2026-10-14T00:00:00Z' }))
      return original(path, options)
    })
    open('/ops/dashboard')
    await screen.findByRole('navigation', { name: 'LLMOps 작업 메뉴' })
    const link = within(screen.getByRole('navigation', { name: '운영 메뉴' })).getByRole('link', { name: 'AI 실행 추적' })
    expect(link.getAttribute('href')).toBe('/ops/traces')
    expect(link.getAttribute('target')).toBeNull()
    fireEvent.click(link)
    expect(await screen.findByRole('heading', { name: '이 기간에 기록된 실행이 없습니다.' })).toBeTruthy()
    expect(within(screen.getByRole('navigation', { name: 'LLMOps 작업 메뉴' })).getByRole('link', { name: 'AI 실행 추적' }).getAttribute('aria-current')).toBe('page')
    expect(fetchMock.mock.calls.some(([url]) => url.includes('cloudfront.net'))).toBe(false)
  })

  it('평가 취소를 CSRF와 함께 접수하고 종료 확인까지 취소 요청 중으로 표시한다', async () => {
    const original = fetchMock.getMockImplementation()!
    let run = { ...completed, status: 'RUNNING', status_label: '실행 중', can_cancel: true,
      cancel_requested_at: null as string | null, cancel_requested_by: null as string | null, report_url: null }
    let finish: ((value: Response) => void) | undefined
    fetchMock.mockImplementation(async (path, options) => {
      if (path === `/api/v1/ops/evaluations/${id}`) return json(run)
      if (path.endsWith('/cancel')) return new Promise<Response>((resolve) => { finish = resolve })
      return original(path, options)
    })
    open(`/ops/evaluations/${id}`)
    fireEvent.click(await screen.findByText('평가 취소하기'))
    const button = screen.getByRole('button', { name: '평가 취소 요청' })
    fireEvent.click(button)
    await waitFor(() => expect(finish).toBeTruthy())
    expect(button).toHaveProperty('disabled', true)
    fireEvent.click(button)
    const calls = fetchMock.mock.calls.filter(([path]) => path.endsWith('/cancel'))
    expect(calls).toHaveLength(1)
    expect(calls[0][1]).toMatchObject({ method: 'POST', credentials: 'same-origin',
      headers: { 'X-CSRFToken': 'rotated-token' }, body: '{}' })
    run = { ...run, status: 'CANCELLING', status_label: '취소 요청 중', can_cancel: false,
      cancel_requested_at: '2026-09-29T00:00:00Z', cancel_requested_by: 'operator@example.com' }
    await act(async () => { finish!(json(run, 202)) })
    expect(await screen.findByText('취소 요청 중')).toBeTruthy()
    expect(screen.queryByRole('button', { name: '평가 취소 요청' })).toBeNull()
    expect(screen.getByText(/종료 확인 중/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: '접수 다시 확인' })).toBeNull()
  })

  it('취소 응답 유실을 완료로 표시하지 않고 같은 실행에 재요청할 수 있다', async () => {
    const original = fetchMock.getMockImplementation()!
    fetchMock.mockImplementation(async (path, options) => {
      if (path === `/api/v1/ops/evaluations/${id}`) return json({ ...completed, status: 'RUNNING', status_label: '실행 중', can_cancel: true, report_url: null })
      if (path.endsWith('/cancel')) throw new Error('connection lost')
      return original(path, options)
    })
    open(`/ops/evaluations/${id}`)
    fireEvent.click(await screen.findByText('평가 취소하기'))
    fireEvent.click(screen.getByRole('button', { name: '평가 취소 요청' }))
    expect(await screen.findByText(/취소 접수 여부는 상태를 다시 확인하세요/)).toBeTruthy()
    expect(screen.queryByText('취소')).toBeNull()
    await waitFor(() => expect(screen.getByRole('button', { name: '평가 취소 요청' })).toHaveProperty('disabled', false))
    fireEvent.click(screen.getByRole('button', { name: '평가 취소 요청' }))
    await waitFor(() => expect(fetchMock.mock.calls.filter(([path]) => path.endsWith('/cancel'))).toHaveLength(2))
  })

  it('실행 ID를 찾는 중인 취소 요청도 자동 갱신해 실제 취소 완료를 확인한다', async () => {
    const original = fetchMock.getMockImplementation()!
    let reads = 0
    fetchMock.mockImplementation(async (path, options) => {
      if (path === `/api/v1/ops/evaluations/${id}`) return json({ ...completed,
        status: ++reads === 1 ? 'CANCELLING' : 'CANCELLED', status_label: reads === 1 ? '취소 요청 중' : '취소',
        prefect_flow_run_id: null, prefect_url: null, report_url: null,
        cancel_requested_at: '2026-09-29T00:00:00Z', cancel_requested_by: 'operator@example.com' })
      return original(path, options)
    })
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    open(`/ops/evaluations/${id}`)
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(screen.getByText('취소 요청 중')).toBeTruthy()
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000) })
    expect(screen.getByText('취소')).toBeTruthy()
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000) })
    expect(reads).toBe(2)
  })

  it('취소 버튼을 누르기 전에 계정이 바뀌면 취소를 전송하지 않는다', async () => {
    const original = fetchMock.getMockImplementation()!
    let changed = false
    fetchMock.mockImplementation(async (path, options) => {
      if (path === '/api/v1/ops/session' && changed) return json({ ...session(), user: { id: 'core:100', username: 'other' } })
      if (path === `/api/v1/ops/evaluations/${id}`) return json({ ...completed, status: 'RUNNING', status_label: '실행 중', can_cancel: true, report_url: null })
      return original(path, options)
    })
    open(`/ops/evaluations/${id}`)
    fireEvent.click(await screen.findByText('평가 취소하기'))
    const button = screen.getByRole('button', { name: '평가 취소 요청' })
    changed = true
    fireEvent.click(button)
    expect(await screen.findByText(/로그인 계정이 변경되었습니다/)).toBeTruthy()
    expect(fetchMock.mock.calls.some(([path]) => path.endsWith('/cancel'))).toBe(false)
  })

  it('같은 자료의 실행을 방식과 상태로 구분하고 각각의 상세로 이동한다', async () => {
    const original = fetchMock.getMockImplementation()!
    const failedId = '20000000-0000-4000-8000-000000000002'
    const staleId = '30000000-0000-4000-8000-000000000003'
    const runs = [completed,
      { ...completed, id: failedId, execution_mode: 'live', live_config: liveConfig, status: 'FAILED', status_label: '실패', error_message: '내부 오류 원문' },
      { ...completed, id: staleId, status: 'RUNNING', status_label: '실행 중', status_stale: true, error_message: '상태 조회 오류' },
    ]
    fetchMock.mockImplementation((path, options) => path.startsWith('/api/v1/ops/evaluations?page=')
      ? Promise.resolve(json({ count: runs.length, next: null, previous: null, results: runs })) : original(path, options))
    open('/ops/evaluations')
    const list = await screen.findByRole('list', { name: '평가 실행 목록' })
    const rows = within(list).getAllByRole('listitem')
    expect(rows).toHaveLength(3)
    expect(within(rows[0]).getByText('저장 답변 다시 확인')).toBeTruthy()
    expect(within(rows[1]).getByText('새 답변 생성 · gpt-6-luna')).toBeTruthy()
    expect(within(rows[1]).getByText('실패')).toBeTruthy()
    expect(within(rows[1]).queryByText('내부 오류 원문')).toBeNull()
    expect(within(rows[2]).getByText('마지막 상태')).toBeTruthy()
    expect(within(rows[2]).getByText(/상태 확인 지연 · 현재 상태 미확정/)).toBeTruthy()
    expect(within(rows[2]).getByText(/마지막 확인: 아직 확인되지 않음/)).toBeTruthy()
    const links = rows.map((row) => within(row).getByRole('link'))
    expect(links.map((link) => link.getAttribute('href'))).toEqual(runs.map((run) => `/ops/evaluations/${run.id}`))
    expect(new Set(links.map((link) => link.getAttribute('aria-label'))).size).toBe(3)
    expect(list.textContent).not.toContain(id)
    expect(fetchMock.mock.calls.every(([, options]) => !options?.method || options.method === 'GET')).toBe(true)
  })

  it('이력 목록의 모바일 메뉴는 필요할 때 열어 사용할 수 있다', async () => {
    open('/ops/evaluations')
    await screen.findByRole('list', { name: '평가 실행 목록' })
    const menu = screen.getByText('운영 메뉴 보기')
    expect(menu.closest('details')).toHaveProperty('open', false)
    fireEvent.click(menu)
    expect(menu.closest('details')).toHaveProperty('open', true)
    expect(within(menu.closest('details')!).getByRole('link', { name: '평가 이력' }).getAttribute('aria-current')).toBe('page')
  })

  it('결과 확인 실패는 실행 실패와 구분하고 요청된 실행 방식을 표시한다', async () => {
    const original = fetchMock.getMockImplementation()!
    fetchMock.mockImplementation((path, options) => path.startsWith('/api/v1/ops/evaluations?page=')
      ? Promise.resolve(json({ count: 2, next: null, previous: null, results: [
        { ...completed, status: 'RESULT_ERROR', status_label: '결과 확인 실패', error_message: '결과 파일을 확인할 수 없습니다.' },
        { ...completed, id: '20000000-0000-4000-8000-000000000002', execution_mode: 'recovery', recovery_kind: 'reassessment', status: 'CANCELLED', status_label: '취소' },
      ] })) : original(path, options))
    open('/ops/evaluations')
    const rows = within(await screen.findByRole('list', { name: '평가 실행 목록' })).getAllByRole('listitem')
    expect(within(rows[0]).getByText('결과 확인 실패')).toBeTruthy()
    expect(within(rows[0]).queryByText('실패')).toBeNull()
    expect(within(rows[1]).getByText('저장 답변 다시 평가')).toBeTruthy()
    expect(within(rows[1]).getByText('취소')).toBeTruthy()
  })

  it('상세를 열지 않아도 목록을 갱신하고 상태 확인 지연과 복구를 표시한다', async () => {
    const original = fetchMock.getMockImplementation()!
    let reads = 0
    fetchMock.mockImplementation(async (path, options) => {
      if (path.startsWith('/api/v1/ops/evaluations?page=')) return json({ count: 1, next: null, previous: null, results: [++reads === 1
        ? { ...completed, status: 'RUNNING', status_label: '실행 중', status_stale: true,
            error_message: '실행 서버에 연결할 수 없습니다.', report_url: null }
        : { ...completed, synced_at: '2026-09-27T00:01:00Z', status_stale: false }] })
      return original(path, options)
    })
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const view = open('/ops/evaluations')
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(screen.getByText('실행 중')).toBeTruthy()
    expect(screen.getByText(/상태 확인 지연/)).toBeTruthy()
    expect(screen.getByText(/마지막 확인: 아직 확인되지 않음/)).toBeTruthy()
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000) })
    expect(screen.getByText('완료')).toBeTruthy()
    expect(screen.queryByText(/상태 확인 지연/)).toBeNull()
    expect(fetchMock.mock.calls.some(([path]) => path === `/api/v1/ops/evaluations/${id}`)).toBe(false)
    view.unmount()
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000) })
    expect(reads).toBe(2)
  })

  it('목록 자동 갱신 실패 때 기존 결과를 유지하고 다음 조회로 복구한다', async () => {
    const original = fetchMock.getMockImplementation()!
    let reads = 0
    fetchMock.mockImplementation(async (path, options) => {
      if (path.startsWith('/api/v1/ops/evaluations?page=')) {
        if (++reads === 2) return json({}, 503)
        return json({ count: 1, next: null, previous: null, results: [completed] })
      }
      return original(path, options)
    })
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    open('/ops/evaluations')
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000) })
    expect(screen.getByRole('alert')).toBeTruthy()
    expect(screen.getByText('완료')).toBeTruthy()
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000) })
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('실패 후처리를 새 이력으로 복구하고 원본 연결과 추가 호출 0회를 표시한다', async () => {
    const original = fetchMock.getMockImplementation()!
    const child = '30000000-0000-4000-8000-000000000003'
    const recovered = { ...completed, id: child, execution_mode: 'recovery', source_run_id: id, report_url: `/api/v1/ops/evaluations/${child}/report` }
    fetchMock.mockImplementation(async (path, options) => {
      if (path === `/api/v1/ops/evaluations/${id}`) return json({ ...completed, status: 'FAILED', report_url: null, postprocessing: {
        inputs_ready: true, stage: 'publish', can_recover: true, blocked_reason: '', attempts: [],
      } })
      if (path === `/api/v1/ops/evaluations/${id}/recover`) return json(recovered, 202)
      if (path === `/api/v1/ops/evaluations/${child}`) return json(recovered)
      if (path === `/api/v1/ops/evaluations/${child}/review`) return json({ ...reviewDefaults, is_baseline: false, baseline_version: 0, baseline_history: [], reviews: [], material: null, material_error: '' })
      return original(path, options)
    })
    await act(async () => { open(`/ops/evaluations/${id}`) })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '결과 정리 다시 시도' })) })
    const link = screen.getByRole('link', { name: '원본 실행과 실패 기록 보기' })
    expect(link.getAttribute('href')).toBe(`/ops/evaluations/${id}`)
    expect(screen.getByText(/AI를 추가로 호출하지 않았어요/)).toBeTruthy()
    const options = fetchMock.mock.calls.find(([path]) => path.endsWith('/recover'))![1]!
    expect(Object.keys(JSON.parse(String(options.body)))).toEqual(['request_id'])
    expect(options.credentials).toBe('same-origin')
    expect(options.headers).toMatchObject({ 'X-CSRFToken': 'rotated-token' })
    expect(fetchMock.mock.calls.some(([path]) => path === '/api/v1/ops/evaluations')).toBe(false)
  })

  it('복구 접수 응답 유실과 재확인 모두 같은 UUID와 복구 API를 사용한다', async () => {
    vi.mocked(crypto.randomUUID).mockReturnValue('30000000-0000-4000-8000-000000000003')
    const original = fetchMock.getMockImplementation()!
    const requests: string[] = []
    let child = ''
    const pending = () => ({ ...completed, id: child, execution_mode: 'recovery', source_run_id: id,
      status: 'REQUESTED', can_retry: true, prefect_flow_run_id: null, report_url: null })
    fetchMock.mockImplementation(async (path, options) => {
      if (path === `/api/v1/ops/evaluations/${id}`) return json({ ...completed, status: 'FAILED', postprocessing: {
        inputs_ready: true, stage: 'report', can_recover: true, blocked_reason: '', attempts: [],
      } })
      if (path === `/api/v1/ops/evaluations/${id}/recover`) {
        child = JSON.parse(String(options?.body)).request_id
        requests.push(child)
        if (requests.length === 1) throw new TypeError('response lost')
        return json(pending(), 503)
      }
      if (child && path === `/api/v1/ops/evaluations/${child}`) return json(pending())
      return original(path, options)
    })
    open(`/ops/evaluations/${id}`)
    fireEvent.click(await screen.findByRole('button', { name: '결과 정리 다시 시도' }))
    expect(await screen.findByText(/연결할 수 없습니다/)).toBeTruthy()
    const recoverAgain = screen.getByRole('button', { name: '결과 정리 다시 시도' })
    await waitFor(() => expect(recoverAgain).toHaveProperty('disabled', false))
    fireEvent.click(recoverAgain)
    await waitFor(() => expect(requests).toHaveLength(2))
    const retry = await screen.findByRole('button', { name: '접수 다시 확인' })
    await waitFor(() => expect(retry).toHaveProperty('disabled', false))
    fireEvent.click(retry)
    await waitFor(() => expect(requests).toHaveLength(3))
    expect(new Set(requests).size).toBe(1)
    expect(fetchMock.mock.calls.some(([path]) => path === '/api/v1/ops/evaluations')).toBe(false)
  })

  it('저장된 답변을 추가 모델 호출 없이 별도 재평가하고 원본·평가기 버전을 구분한다', async () => {
    const original = fetchMock.getMockImplementation()!
    const child = '30000000-0000-4000-8000-000000000003'
    const reassessed = { ...completed, id: child, execution_mode: 'recovery', recovery_kind: 'reassessment', source_run_id: id,
      source_evaluator_version: 'a'.repeat(64), source_approved_evaluator_version: 'b'.repeat(64),
      execution_spec: { dataset: { case_ids: ['TC01'], fixture_sha256: 'c'.repeat(64) }, evaluation: { sha256: 'd'.repeat(64) }, generation: null },
      report_url: `/api/v1/ops/evaluations/${child}/report` }
    fetchMock.mockImplementation(async (path, options) => {
      if (path === `/api/v1/ops/evaluations/${id}`) return json({ ...completed, status: 'FAILED', report_url: null, postprocessing: {
        inputs_ready: false, stage: 'publish', can_recover: false, blocked_reason: '이전 평가기와 다릅니다.',
        can_reassess: true, reassessment_blocked_reason: '', attempts: [],
      } })
      if (path === `/api/v1/ops/evaluations/${id}/reassess`) return json(reassessed, 202)
      if (path === `/api/v1/ops/evaluations/${child}`) return json(reassessed)
      if (path === `/api/v1/ops/evaluations/${child}/review`) return json({ ...reviewDefaults, is_baseline: false, baseline_version: 0, baseline_history: [], reviews: [], material: null, material_error: '' })
      return original(path, options)
    })
    open(`/ops/evaluations/${id}`)
    expect(await screen.findByText(/저장된 답변을 다시 평가해 별도 기록으로 남겨요/)).toBeTruthy()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '저장 답변 다시 평가' })) })
    const originalLink = await screen.findByRole('link', { name: '원본 실행과 실패 기록 보기' }, { timeout: 5000 })
    expect(originalLink.getAttribute('href')).toBe(`/ops/evaluations/${id}`)
    expect(within(screen.getByRole('region', { name: '이번 평가 한눈에 보기' })).getByText(/저장된 답변을 다시 평가했어요/)).toBeTruthy()
    fireEvent.click(screen.getByText('관리자용 기술 정보'))
    expect(screen.getByText('원본에 기록된 평가기 버전').nextElementSibling?.textContent).toBe('a'.repeat(64))
    expect(screen.getByText('원본 접수 시 승인된 평가기 버전').nextElementSibling?.textContent).toBe('b'.repeat(64))
    const options = fetchMock.mock.calls.find(([path]) => path.endsWith('/reassess'))![1]!
    expect(Object.keys(JSON.parse(String(options.body)))).toEqual(['request_id'])
    expect(options.credentials).toBe('same-origin')
    expect(fetchMock.mock.calls.some(([path]) => path === '/api/v1/ops/evaluations')).toBe(false)
  })

  it('완료된 재평가에서 기준 응답의 버전이 없으면 미확인으로 표시한다', async () => {
    const original = fetchMock.getMockImplementation()!
    const execution = { run_id: 'a'.repeat(32), model: 'test-model', prompt_sha256: 'p'.repeat(64), runner_sha256: 'r'.repeat(64), capture_sha256: 'c'.repeat(64), started_at: null, source_case_ids: ['E01'] }
    const comparison = { schema_version: 2, comparison: 'candidate-reference', case_ids: ['E01'], candidate_execution: execution,
      reference_execution: { ...execution, prompt_sha256: null, runner_sha256: null }, metrics: [], cases: [] }
    fetchMock.mockImplementation((path, options) => path === `/api/v1/ops/evaluations/${id}`
      ? Promise.resolve(json({ ...completed, execution_mode: 'recovery', recovery_kind: 'reassessment', comparison })) : original(path, options))
    open(`/ops/evaluations/${id}`)
    expect(await screen.findByRole('heading', { name: '평가가 끝났어요' })).toBeTruthy()
    fireEvent.click(screen.getByText('이전 결과와 비교하기'))
    fireEvent.click(screen.getByText('비교한 실행의 모델과 기록 보기'))
    expect(screen.getByText('프롬프트: 미확인')).toBeTruthy()
    expect(screen.getByText('실행기: 미확인')).toBeTruthy()
  })

  it('재평가 응답 유실과 접수 재확인에 같은 요청 ID와 재평가 API만 사용한다', async () => {
    vi.mocked(crypto.randomUUID).mockReturnValue('30000000-0000-4000-8000-000000000003')
    const original = fetchMock.getMockImplementation()!
    const requests: string[] = []
    let child = ''
    const pending = () => ({ ...completed, id: child, execution_mode: 'recovery', recovery_kind: 'reassessment', source_run_id: id,
      status: 'REQUESTED', can_retry: true, prefect_flow_run_id: null, report_url: null })
    fetchMock.mockImplementation(async (path, options) => {
      if (path === `/api/v1/ops/evaluations/${id}`) return json({ ...completed, status: 'FAILED', postprocessing: {
        inputs_ready: false, stage: 'publish', can_recover: false, blocked_reason: '이전 평가기와 다릅니다.',
        can_reassess: true, reassessment_blocked_reason: '', attempts: [],
      } })
      if (path === `/api/v1/ops/evaluations/${id}/reassess`) {
        child = JSON.parse(String(options?.body)).request_id
        requests.push(child)
        if (requests.length === 1) throw new TypeError('response lost')
        return json(pending(), 503)
      }
      if (child && path === `/api/v1/ops/evaluations/${child}`) return json(pending())
      return original(path, options)
    })
    open(`/ops/evaluations/${id}`)
    fireEvent.click(await screen.findByRole('button', { name: '저장 답변 다시 평가' }))
    expect(await screen.findByText(/연결할 수 없습니다/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '저장 답변 다시 평가' }))
    await waitFor(() => expect(requests).toHaveLength(2))
    const retry = await screen.findByRole('button', { name: '접수 다시 확인' })
    await waitFor(() => expect(retry).toHaveProperty('disabled', false))
    fireEvent.click(retry)
    await waitFor(() => expect(requests).toHaveLength(3))
    expect(new Set(requests).size).toBe(1)
    expect(fetchMock.mock.calls.some(([path]) => path.endsWith('/recover') || path === '/api/v1/ops/evaluations')).toBe(false)
  })

  it('같은 평가기로 이미 재평가했다면 재접수를 막고 그 이력을 보여 준다', async () => {
    const original = fetchMock.getMockImplementation()!
    const child = '30000000-0000-4000-8000-000000000003'
    fetchMock.mockImplementation(async (path, options) => path === `/api/v1/ops/evaluations/${id}`
      ? json({ ...completed, status: 'FAILED', postprocessing: {
        inputs_ready: false, stage: 'publish', can_recover: false, blocked_reason: '이전 평가기와 다릅니다.',
        can_reassess: false, reassessment_blocked_reason: '같은 평가기로 재평가한 기록이 있습니다. 결과 또는 실패 원인을 확인해 주세요.',
        attempts: [{ id: child, status: 'FAILED', status_label: '실패', recovery_kind: 'reassessment' }],
      } }) : original(path, options))
    open(`/ops/evaluations/${id}`)
    expect(await screen.findByText('이미 다시 평가한 기록이 있어요. 아래 기록을 확인해 주세요.')).toBeTruthy()
    expect(screen.getByText(/같은 평가기로 재평가한 기록이 있습니다/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: '저장 답변 다시 평가' })).toBeNull()
    expect(screen.getByRole('link', { name: '1번째 다시 평가 · 실패' }).getAttribute('href')).toBe(`/ops/evaluations/${child}`)
  })

  it('불완전한 입력은 복구 버튼을 숨기고 이전 복구 이력을 보여 준다', async () => {
    const original = fetchMock.getMockImplementation()!
    const child = '30000000-0000-4000-8000-000000000003'
    fetchMock.mockImplementation(async (path, options) => path === `/api/v1/ops/evaluations/${id}`
      ? json({ ...completed, status: 'FAILED', postprocessing: {
        inputs_ready: false, stage: 'unverified', can_recover: false, blocked_reason: '완료된 응답을 확인할 수 없습니다.',
        attempts: [{ id: child, status: 'CRASHED', status_label: '실행 중단' }],
      } }) : original(path, options))
    open(`/ops/evaluations/${id}`)
    expect(await screen.findByText(/완료된 응답을 확인할 수 없습니다/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: '결과 정리 다시 시도' })).toBeNull()
    expect(screen.getByRole('link', { name: '1번째 결과 정리 · 실행 중단' }).getAttribute('href')).toBe(`/ops/evaluations/${child}`)
  })

  it('기존 로그인 화면으로 갔다가 같은 Ops 상세로 돌아오고 Core 로그아웃을 실행한다', async () => {
    authenticated = false
    open(`/ops/evaluations/${id}`)
    expect(await screen.findByRole('heading', { name: '로그인' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'LLMOps 로그인' })).toBeNull()
    fireEvent.change(screen.getByLabelText('이메일'), { target: { value: 'operator@example.com' } })
    fireEvent.change(screen.getByLabelText('비밀번호'), { target: { value: 'valid-password' } })
    fireEvent.click(screen.getByRole('button', { name: '이메일로 로그인' }))
    expect(await screen.findByRole('region', { name: '평가 결과' })).toBeTruthy()
    expect(appContainer.resolve('logInUseCase').execute).toHaveBeenCalledWith({ email: 'operator@example.com', password: 'valid-password', rememberMe: false })
    fireEvent.click(screen.getByRole('button', { name: '로그아웃' }))
    expect(await screen.findByRole('heading', { name: '로그인' })).toBeTruthy()
    const logoutOptions = fetchMock.mock.calls.find(([path]) => path.endsWith('/api/v1/auth/logout'))?.[1]
    expect(logoutOptions?.credentials).toBe('include')
    expect(fetchMock.mock.calls.some(([path]) => path.endsWith('/api/v1/ops/login'))).toBe(false)
  })

  it('일반 회원은 기존 서비스 로그인 상태를 유지하면서 Ops 접근이 차단된다', async () => {
    fetchMock.mockResolvedValue(json({ detail: 'denied' }, 403))
    const store = createAppStore()
    store.dispatch(sessionRestored({ email: 'member@example.com', role: 'USER', tier: 'MEMBER', emailVerified: true, hasPassword: true, accountType: null, onboarded: true, company: null }))
    render(<Provider store={store}><MemoryRouter initialEntries={['/ops/evaluations']}><App /></MemoryRouter></Provider>)
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', expect.stringContaining('관리자 계정만'))
    expect(screen.queryByRole('button', { name: '평가 실행' })).toBeNull()
    expect(screen.getByRole('button', { name: '로그아웃' })).toBeTruthy()
  })

  it('완료 결과와 인증 보고서·외부 기록 링크를 표시한다', async () => {
    open(`/ops/evaluations/${id}`)
    fireEvent.click(await screen.findByText('보고서와 Prefect 실행 로그 보기'))
    expect(screen.getByRole('link', { name: '평가 보고서 보기' })).toHaveProperty('pathname', `/ops/evaluations/${id}/report`)
    expect(screen.getByRole('link', { name: '상세 점수 보기' }).getAttribute('href')).toBe(completed.langfuse_url)
    expect(screen.getByText('6 / 6개')).toBeTruthy()
    expect(screen.getAllByText('100%')).toHaveLength(2)
    expect(screen.queryByText(/답변과 공고 내용을 직접 확인/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '답변 여부가 예상과 일치 도움말' }))
    expect(screen.getByText(/답변하지 않았는지가 예상과 일치한 비율/)).toBeTruthy()
  })

  it('보고서 경로는 관리자 세션으로 열고 과거 비교 기록이 없으면 원본을 안내한다', async () => {
    open(`/ops/evaluations/${id}/report`)
    expect(await screen.findByRole('heading', { name: 'Evidently 평가 보고서' })).toBeTruthy()
    const chart = await screen.findByRole('link', { name: '원본 차트 새 탭에서 보기 ↗' })
    expect(chart).toHaveProperty('pathname', completed.report_url)
    expect(chart).toHaveProperty('search', '?view=compact')
    expect(screen.getByText(/비교 기록이 없습니다/)).toBeTruthy()
    expect(fetchMock.mock.calls.every(([, options]) => !options?.method || options.method === 'GET')).toBe(true)
  })

  it('접수 응답 유실 뒤 같은 UUID로 재시도하며 503의 저장 요청 상세를 연다', async () => {
    const original = fetchMock.getMockImplementation()!
    const requests: string[] = []
    fetchMock.mockImplementation(async (path, options) => {
      if (path === `/api/v1/ops/evaluations/${id}` && requests.length < 2) return json({}, 404)
      if (path === '/api/v1/ops/evaluations') {
        requests.push(JSON.parse(String(options?.body)).request_id)
        if (requests.length === 1) throw new TypeError('connection lost')
        return json({ ...completed, status: 'REQUESTED', status_label: '접수 중', can_retry: true, prefect_flow_run_id: null, report_url: null }, 503)
      }
      return original(path, options)
    })
    open()
    await evaluationStep(3)
    fireEvent.click(await screen.findByRole('button', { name: '평가 실행' }))
    expect(await screen.findByRole('button', { name: '같은 요청으로 재시도' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '같은 요청으로 재시도' }))
    expect(await screen.findByRole('heading', { name: '평가 실행 상세' })).toBeTruthy()
    expect(requests).toHaveLength(2)
    expect(requests[0]).toBe(requests[1])
  })

  it('실행 중 상태를 조회하다 완료되면 자동 조회를 멈춘다', async () => {
    const original = fetchMock.getMockImplementation()!
    let reads = 0
    fetchMock.mockImplementation(async (path, options) => {
      if (path === `/api/v1/ops/evaluations/${id}`) return json(++reads === 1 ? { ...completed, status: 'RUNNING', status_label: '실행 중', report_url: null } : completed)
      return original(path, options)
    })
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    open(`/ops/evaluations/${id}`)
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(screen.getByText('실행 중')).toBeTruthy()
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000) })
    expect(screen.getByRole('heading', { name: '평가가 끝났어요' })).toBeTruthy()
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000) })
    expect(reads).toBe(2)
  })

  it('목록 실패를 빈 목록으로 숨기지 않고 재조회하며 페이지를 이동한다', async () => {
    const original = fetchMock.getMockImplementation()!
    let lists = 0
    fetchMock.mockImplementation(async (path, options) => {
      if (path.startsWith('/api/v1/ops/evaluations?page=')) {
        if (++lists === 1) return json({}, 502)
        return json({ count: 26, next: path.endsWith('page=1') ? '?page=2' : null, previous: null, results: [completed] })
      }
      return original(path, options)
    })
    open('/ops/evaluations')
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(screen.queryByText('아직 실행한 평가가 없습니다.')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '목록 새로고침' }))
    await screen.findByRole('heading', { name: '실행 이력 · 26건' })
    fireEvent.click(screen.getByRole('button', { name: '다음' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/v1/ops/evaluations?page=2', expect.anything()))
  })

  it('실행 이력 설명은 도움말에서 볼 수 있고 목록을 이동하지 않는다', async () => {
    open('/ops/evaluations')
    const history = await screen.findByRole('region', { name: '평가 실행 이력' })
    const help = within(history).getByRole('button', { name: '실행 이력 도움말' })
    const explanation = '자료를 선택하면 자세한 결과를 볼 수 있어요. 실행 완료가 품질 합격을 뜻하지는 않아요.'
    expect(screen.queryByText(explanation)).toBeNull()
    expect(help.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(help)
    const content = screen.getByText(explanation)
    expect(help.getAttribute('aria-expanded')).toBe('true')
    expect(content.closest('[id]')?.id).toBe(help.getAttribute('aria-controls'))
    expect(history.contains(content)).toBe(false)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByText(explanation)).toBeNull()
    expect(document.activeElement).toBe(help)
  })

  it('세션 만료 시 결과 대신 운영자 로그인을 보여 준다', async () => {
    const original = fetchMock.getMockImplementation()!
    fetchMock.mockImplementation(async (path, options) => {
      if (path.includes('/evaluations')) { authenticated = false; return json({}, 401) }
      return original(path, options)
    })
    open(`/ops/evaluations/${id}`)
    expect(await screen.findByRole('heading', { name: '로그인' })).toBeTruthy()
    expect(screen.queryByRole('region', { name: '평가 결과' })).toBeNull()
  })

  it('결과 파일 오류를 완료로 표시하지 않고 접수 재확인에도 기존 요청을 쓴다', async () => {
    const original = fetchMock.getMockImplementation()!
    let submitted = false
    fetchMock.mockImplementation(async (path, options) => {
      if (path === '/api/v1/ops/evaluations') {
        expect(JSON.parse(String(options?.body))).toEqual({ request_id: id, dataset_id: dataset.id, candidate_capture_id: capture.id, reference_capture_id: capture.id, execution_mode: 'replay', live_config: {}, confirm_paid_run: false, baseline_version: null, execution_profile: null })
        submitted = true
        return json({ ...completed, status: 'QUEUED', status_label: '실행 대기', report_url: null })
      }
      if (path === `/api/v1/ops/evaluations/${id}`) return json(submitted
        ? { ...completed, status: 'RESULT_ERROR', status_label: '결과 확인 실패', report_url: null, error_code: 'RESULTS_UNAVAILABLE', error_message: '결과 파일을 확인할 수 없습니다.' }
        : { ...completed, status: 'REQUESTED', status_label: '접수 중', can_retry: true, prefect_flow_run_id: null, report_url: null })
      return original(path, options)
    })
    open(`/ops/evaluations/${id}`)
    fireEvent.click(await screen.findByRole('button', { name: '접수 다시 확인' }))
    expect(await screen.findByText('결과 확인 실패')).toBeTruthy()
    expect(screen.getByRole('alert').textContent).toBe('결과를 가져오지 못했어요. 다시 확인하고 계속되면 관리자에게 알려 주세요.')
    fireEvent.click(screen.getByText('문제 원인과 해결 방법'))
    expect(screen.getByText('결과 파일을 확인할 수 없습니다.')).toBeTruthy()
    expect(screen.queryByRole('link', { name: '평가 보고서 보기' })).toBeNull()
    expect(screen.queryByRole('region', { name: '평가 결과' })).toBeNull()
  })

  it('잘못된 응답이나 실행 가능한 외부 링크를 렌더링하지 않는다', async () => {
    fetchMock.mockResolvedValue(json({ ...completed, langfuse_url: 'javascript:alert(1)' }))
    await expect(getEvaluation(id)).rejects.toThrow('운영 서버 응답을 확인할 수 없습니다.')
  })
  it('자료에 맞는 기준·후보를 선택하고 접수 재시도에서도 두 선택을 유지한다', async () => {
    const original = fetchMock.getMockImplementation()!
    const bodies: unknown[] = []
    fetchMock.mockImplementation(async (path, options) => {
      if (path === `/api/v1/ops/evaluations/${id}`) return json({}, 404)
      if (path === '/api/v1/ops/evaluations') {
        bodies.push(JSON.parse(String(options?.body)))
        throw new TypeError('connection lost')
      }
      return original(path, options)
    })
    open()
    await evaluationStep(1)
    const select = await screen.findByLabelText('평가 자료')
    fireEvent.change(select, { target: { value: comparisonDataset.id } })
    await evaluationStep(3)
    expect((screen.getByLabelText('비교 기준 답변') as HTMLSelectElement).value).toBe('reference')
    await evaluationStep(3)
    expect((screen.getByLabelText('다시 확인할 답변') as HTMLSelectElement).value).toBe('candidate')
    const scopeHelp = screen.getByRole('button', { name: '비교 범위 도움말' })
    expect(scopeHelp.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(scopeHelp)
    expect(scopeHelp.getAttribute('aria-expanded')).toBe('true')
    const scopePanel = expectInlineHelp(scopeHelp)
    expect(scopePanel.textContent).toContain('E01')
    fireEvent.click(scopeHelp)
    expect(scopeHelp.getAttribute('aria-expanded')).toBe('false')
    expect(document.body.contains(scopePanel)).toBe(false)
    await evaluationStep(3)
    fireEvent.click(screen.getByRole('button', { name: '평가 실행' }))
    await screen.findByRole('button', { name: '같은 요청으로 재시도' })
    await evaluationStep(3)
    expect((screen.getByLabelText('다시 확인할 답변') as HTMLSelectElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: '같은 요청으로 재시도' }))
    await waitFor(() => expect(bodies).toHaveLength(2))
    expect(bodies[0]).toEqual(bodies[1])
    expect(bodies[0]).toMatchObject({ dataset_id: comparisonDataset.id, reference_capture_id: 'reference', candidate_capture_id: 'candidate' })
  })

  it('지표 차이와 원본 범위를 표시하고 미측정을 0으로 바꾸지 않는다', async () => {
    const execution = { run_id: 'a'.repeat(32), model: 'test-model', prompt_sha256: 'p'.repeat(64), runner_sha256: 'r'.repeat(64), capture_sha256: 'c'.repeat(64), started_at: null, source_case_ids: ['E01'] }
    const comparison = { schema_version: 2, comparison: 'candidate-reference', case_ids: ['E01'],
      reference_execution: execution, candidate_execution: { ...execution, source_case_ids: ['E01', 'E07', 'E10', 'E12'] },
      metrics: [
        { key: 'meanOutputTokens', reference: 128, candidate: 91, delta: -37 },
        { key: 'statusAccuracy', reference: 0, candidate: 1, delta: 1 },
        { key: 'semanticFaithfulness', reference: null, candidate: null, delta: null },
      ], cases: [{ case_id: 'E01', reference: { outcome: 'success', status_match: 1, citation_recall: 0.5 }, candidate: { outcome: 'missing', status_match: null, citation_recall: null } }],
    }
    const original = fetchMock.getMockImplementation()!
    fetchMock.mockImplementation(async (path, options) => path === `/api/v1/ops/evaluations/${id}` ? json({ ...completed, comparison }) : original(path, options))
    open(`/ops/evaluations/${id}`)
    fireEvent.click(await screen.findByText('이전 결과와 비교하기'))
    expect(await screen.findByRole('region', { name: '이전 결과와 비교' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: '두 결과 비교' })).toBeNull()
    expect(screen.getByText('기준 결과와 이번 결과를 비교해요.')).toBeTruthy()
    const comparisonHelp = screen.getByRole('button', { name: '결과 비교 도움말' })
    expect(comparisonHelp.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(comparisonHelp)
    expect(comparisonHelp.getAttribute('aria-expanded')).toBe('true')
    expect(expectInlineHelp(comparisonHelp).textContent).toContain('차이')
    expect(screen.getByText('예상대로 답변하거나 보류한 비율')).toBeTruthy()
    const cards = within(screen.getByRole('list', { name: '결과별 비교' })).getAllByRole('listitem')
    expect(within(cards[0]).getByText('128.00')).toBeTruthy()
    expect(within(cards[0]).getByText('91.00')).toBeTruthy()
    expect(within(cards[0]).getByText('-37.00')).toBeTruthy()
    expect(screen.getByText('-37.00')).toBeTruthy()
    expect(screen.getByText('+1.00')).toBeTruthy()
    expect(screen.getByText('비교 불가')).toBeTruthy()
    expect(screen.getAllByText('미측정')).toHaveLength(2)
    fireEvent.click(screen.getByText('질문별 결과 비교 보기'))
    expect(screen.getByText('기준: 답변 있음 · 이번 결과: 답변 누락')).toBeTruthy()
    expect(screen.getByText('답변 상태 일치: 1.00 → 미측정')).toBeTruthy()
    expect(screen.getByText('필요한 근거 표시: 0.50 → 미측정')).toBeTruthy()
    fireEvent.click(screen.getByText('비교한 실행의 모델과 기록 보기'))
    expect(screen.getByText('원본 사례: E01, E07, E10, E12')).toBeTruthy()
  })

})

it('새 모델 평가는 전송 자료와 호출 예산 확인 후 한 번만 접수한다', async () => {
  open()
  await evaluationStep(2)
  fireEvent.click(await screen.findByRole('radio', { name: '새 응답 생성' }))
  expect(screen.getByLabelText('평가 모델')).toHaveProperty('value', 'gpt-6-luna')
  await evaluationStep(3)
  const button = screen.getByRole('button', { name: '새 응답 생성 및 평가' })
  expect(button).toHaveProperty('disabled', true)
  expect(screen.queryByLabelText('다시 확인할 답변')).toBeNull()
  fireEvent.click(screen.getByRole('checkbox'))
  expect(button).toHaveProperty('disabled', false)
  fireEvent.click(button)
  await screen.findByRole('heading', { name: '평가 실행 상세' })
  const posts = fetchMock.mock.calls.filter(([path, options]) => path === '/api/v1/ops/evaluations' && options?.method === 'POST')
  expect(posts).toHaveLength(1)
  expect(JSON.parse(posts[0][1]!.body as string)).toMatchObject({ execution_mode: 'live', candidate_capture_id: 'new-model-response', live_config: liveConfig, confirm_paid_run: true })
})

const modelOptions = [
  { live_config: liveConfig, execution_profile: executionProfiles.live },
  { live_config: { ...liveConfig, model: 'gpt-6-sol', max_output_tokens: 4000 }, execution_profile: 'f'.repeat(64) },
  { live_config: { ...liveConfig, model: 'gpt-5.6-luna' }, execution_profile: 'a'.repeat(64) },
]

it.each([1, 2])('허용 모델 %i를 선택하면 해당 모델 설정과 실행 명세를 점검·접수한다', async (index) => {
  const original = fetchMock.getMockImplementation()!
  const option = modelOptions[index]
  fetchMock.mockImplementation(async (path, options) => {
    if (path === '/api/v1/ops/evaluation-catalog') return json({ datasets: [{ ...dataset, live_options: modelOptions }] })
    if (path.includes('/live-readiness?')) return json({
      as_of: '2026-10-03T01:00:00Z', dataset_id: dataset.id, execution_profile: option.execution_profile,
      evaluation_scope: dataset.evaluation_scope, model: option.live_config.model, state: 'checked',
      required: { calls: 6, input_tokens: 196608, output_tokens: 24000 },
      remaining: { calls: 12, input_tokens: 400000, output_tokens: 48000 }, blockers: [], warnings: [],
    })
    return original(path, options)
  })
  open()
  await evaluationStep(2)
  fireEvent.click(await screen.findByRole('radio', { name: '새 응답 생성' }))
  await evaluationStep(2)
  expect(within(screen.getByLabelText('평가 모델')).getAllByRole('option')).toHaveLength(3)
  await evaluationStep(3)
  fireEvent.click(screen.getByRole('checkbox'))
  await evaluationStep(2)
  fireEvent.change(screen.getByLabelText('평가 모델'), { target: { value: option.live_config.model } })
  await evaluationStep(3)
  expect(screen.getByRole('checkbox')).toHaveProperty('checked', false)
  await evaluationStep(3)
  expect(screen.getByRole('button', { name: '새 응답 생성 및 평가' })).toHaveProperty('disabled', true)
  await evaluationStep(3)
  fireEvent.click(screen.getByRole('button', { name: '실행 설정·예산 점검' }))
  await screen.findByText('현재 점검에서 차단된 항목은 없어요.')
  expect(fetchMock.mock.calls.find(([path]) => path.includes('/live-readiness?'))?.[0]).toBe(
    `/api/v1/ops/evaluations/live-readiness?dataset_id=${dataset.id}&execution_profile=${option.execution_profile}&model=${option.live_config.model}`,
  )
  fireEvent.click(screen.getByRole('checkbox'))
  await evaluationStep(3)
  fireEvent.click(screen.getByRole('button', { name: '새 응답 생성 및 평가' }))
  await screen.findByRole('heading', { name: '평가 실행 상세' })
  const posts = fetchMock.mock.calls.filter(([path, options]) => path === '/api/v1/ops/evaluations' && options?.method === 'POST')
  expect(posts).toHaveLength(1)
  expect(JSON.parse(String(posts[0][1]?.body))).toMatchObject({ live_config: option.live_config, execution_profile: option.execution_profile, confirm_paid_run: true })
})

it('모델 선택은 메뉴 이동 후 유지하고 다른 자료에서 사라진 모델은 자동 대체하지 않는다', async () => {
  const original = fetchMock.getMockImplementation()!
  fetchMock.mockImplementation((path, options) => path === '/api/v1/ops/evaluation-catalog'
    ? Promise.resolve(json({ ...session(), datasets: [{ ...dataset, live_options: modelOptions }, comparisonDataset] })) : original(path, options))
  open()
  await evaluationStep(2)
  fireEvent.click(await screen.findByRole('radio', { name: '새 응답 생성' }))
  await evaluationStep(2)
  fireEvent.change(screen.getByLabelText('평가 모델'), { target: { value: 'gpt-6-sol' } })
  await evaluationStep(3)
  fireEvent.click(screen.getByRole('checkbox'))
  fireEvent.click(screen.getByRole('link', { name: '예산 관리' }))
  await screen.findByRole('region', { name: '평가 예산' })
  fireEvent.click(screen.getByRole('link', { name: '새 평가' }))
  await evaluationStep(2)
  expect(await screen.findByLabelText('평가 모델')).toHaveProperty('value', 'gpt-6-sol')
  await evaluationStep(3)
  expect(screen.getByRole('checkbox')).toHaveProperty('checked', false)
  await evaluationStep(1)
  fireEvent.change(screen.getByLabelText('평가 자료'), { target: { value: comparisonDataset.id } })
  await evaluationStep(2)
  expect(screen.getByLabelText('평가 모델')).toHaveProperty('value', 'gpt-6-sol')
  expect(screen.getByRole('alert').textContent).toContain('허용된 평가 모델을 다시 선택하세요')
  expect(screen.getByRole('button', { name: '다음: 비교하고 실행' })).toHaveProperty('disabled', true)
  expect(screen.queryByRole('button', { name: '실행 설정·예산 점검' })).toBeNull()
  await evaluationStep(2)
  fireEvent.change(screen.getByLabelText('평가 모델'), { target: { value: 'gpt-6-luna' } })
  expect(screen.queryByRole('alert')).toBeNull()
  await evaluationStep(3)
  expect(screen.getByRole('checkbox')).toHaveProperty('checked', false)
  expect(fetchMock.mock.calls.some(([, options]) => options?.method === 'POST')).toBe(false)
})

it('서버가 빈 허용 목록을 내려주면 이전 기본 모델로 실행하지 않는다', async () => {
  const original = fetchMock.getMockImplementation()!
  fetchMock.mockImplementation((path, options) => path === '/api/v1/ops/evaluation-catalog'
    ? Promise.resolve(json({ ...session(), datasets: [{ ...dataset, live_options: [] }] })) : original(path, options))
  open()
  await evaluationStep(2)
  expect(await screen.findByRole('radio', { name: '새 응답 생성' })).toHaveProperty('disabled', true)
  expect(fetchMock.mock.calls.some(([, options]) => options?.method === 'POST')).toBe(false)
})

it('평가 자료를 바꾸면 기존 예산 확인을 해제한다', async () => {
  open()
  await evaluationStep(2)
  fireEvent.click(await screen.findByRole('radio', { name: '새 응답 생성' }))
  await evaluationStep(3)
  fireEvent.click(screen.getByRole('checkbox'))
  await evaluationStep(1)
  fireEvent.change(screen.getByLabelText('평가 자료'), { target: { value: comparisonDataset.id } })
  await evaluationStep(3)
  expect(screen.getByRole('checkbox')).toHaveProperty('checked', false)
  await evaluationStep(3)
  expect(screen.getByRole('button', { name: '새 응답 생성 및 평가' })).toHaveProperty('disabled', true)
  expect(screen.getByText(/최대 1회/)).toBeTruthy()
})

it('서버에서 비활성화한 새 모델 평가를 접수하지 않는다', async () => {
  const fallback = fetchMock.getMockImplementation()!
  fetchMock.mockImplementation((path, options) => path === '/api/v1/ops/session' ? Promise.resolve(json({ ...session(), live_enabled: false })) : fallback(path, options))
  open()
  await evaluationStep(2)
  fireEvent.click(await screen.findByRole('radio', { name: '새 응답 생성' }))
  expect(screen.getByText(/새 응답 생성이 비활성화되어 있습니다/)).toBeTruthy()
  expect(screen.getByRole('button', { name: '다음: 비교하고 실행' })).toHaveProperty('disabled', true)
  expect(screen.queryByRole('checkbox')).toBeNull()
})

it('새 평가의 호출 수와 사례별 추적 링크를 표시하고 과거 재현 문구를 쓰지 않는다', async () => {
  const original = fetchMock.getMockImplementation()!
  fetchMock.mockImplementation((path, options) => path === `/api/v1/ops/evaluations/${id}`
    ? Promise.resolve(json({ ...completed, execution_mode: 'live', live_config: liveConfig, model_api_calls: 6, langfuse_url: null, trace_links: [{ case_id: 'TC01', url: `${window.location.origin}/ops/traces/abc` }] }))
    : original(path, options))
  await act(async () => { open(`/ops/evaluations/${id}`) })
  const link = await screen.findByRole('link', { name: 'TC01 실행 추적' })
  expect(link.getAttribute('href')).toBe('/ops/traces/abc')
  expect(link.getAttribute('target')).toBeNull()
  expect(screen.queryByText(/새 모델 호출은 없으며/)).toBeNull()
  expect(screen.getAllByText('6회').length).toBeGreaterThan(0)
})

it('다른 기기에서도 localhost 실행 추적 링크를 현재 접속 주소의 화면으로 연다', async () => {
  const original = fetchMock.getMockImplementation()!
  const traceId = 'd'.repeat(32)
  fetchMock.mockImplementation((path, options) => path === `/api/v1/ops/evaluations/${id}`
    ? Promise.resolve(json({ ...completed, trace_links: [
      { case_id: 'E01', url: `http://localhost:5173/ops/traces/${traceId}` },
      { case_id: 'E02', url: `http://127.0.0.1:5173/ops/traces/${traceId}` },
      { case_id: 'E03', url: `http://[::1]:5173/ops/traces/${traceId}` },
      { case_id: 'E04', url: `${window.location.origin}/ops/traces/${traceId}?from=evaluation#detail` },
      { case_id: 'E05', url: `https://traces.example.org/ops/traces/${traceId}` },
      { case_id: 'E06', url: 'https://traces.example.org/project/trace/123' },
    ] })) : original(path, options))
  await act(async () => { open(`/ops/evaluations/${id}`) })
  for (const caseId of ['E01', 'E02', 'E03', 'E04']) {
    const link = await screen.findByRole('link', { name: `${caseId} 실행 추적` })
    expect(link.getAttribute('href')).toBe(`/ops/traces/${traceId}`)
    expect(link.getAttribute('target')).toBeNull()
  }
  const matchingExternal = screen.getByRole('link', { name: 'E05 실행 추적 ↗' })
  expect(matchingExternal.getAttribute('href')).toBe(`https://traces.example.org/ops/traces/${traceId}`)
  expect(matchingExternal.getAttribute('target')).toBe('_blank')
  const external = screen.getByRole('link', { name: 'E06 실행 추적 ↗' })
  expect(external.getAttribute('href')).toBe('https://traces.example.org/project/trace/123')
  expect(external.getAttribute('target')).toBe('_blank')
})

const reviewMaterial = {
  capture_sha256: 'd'.repeat(64), fixture_sha256: 'c'.repeat(64),
  cases: [{ case_id: 'E01', question: '지원 대상은 누구인가요?', document_title: '가상 공고',
    evidence: [{ order: 0, text: '서울 소재 법인만 가능합니다.' }],
    answer: '<script>후보 답변은 텍스트로 표시</script>', answer_status: 'ANSWERED', cited_orders: [0],
    reference_answer: '과거 기준 답변', expected_status: 'ANSWERED', expected_citation_orders: [0],
    reference_facts: ['서울 소재 법인'], forbidden_claims: ['개인도 신청 가능'],
  }],
}

const qualityState: NonNullable<EvaluationReview['quality']> = {
  status: 'NOT_EVALUATED', is_current: false, current_id: null, input_sha256: '9'.repeat(64),
  policy: { definition: { version: 'fixed-evidence-quality-v1' }, code_sha256: '8'.repeat(64) },
  fixture_version: 0, fixture_rubric_version: 'fixture-reference-review-v1', fixture_reviews: [],
  blocked_reason: '', history: [],
}

function selectFixedReviewArea(name: '평가 기준' | '답변 확인' | '전체·비교') {
  const navigation = screen.getByRole('navigation', { name: '답변 검토 영역' })
  fireEvent.click(within(navigation).getByRole('button', { name: new RegExp(`^${name}`) }))
}

it('금지 주장 기준이 없는 평가 자료는 검토 기준 미설정으로 표시한다', async () => {
  const original = fetchMock.getMockImplementation()!
  const material = { ...reviewMaterial, cases: [{ ...reviewMaterial.cases[0], forbidden_claims: [] }] }
  const state: EvaluationReview = { ...reviewDefaults, quality: qualityState, material, material_error: '', is_baseline: false, baseline_version: 0, baseline_history: [], reviews: [] }
  fetchMock.mockImplementation((path, options) => path.endsWith('/review') ? Promise.resolve(json(state)) : original(path, options))
  open(`/ops/evaluations/${id}`)
  expect(await screen.findByText('포함하면 안 되는 주장: 검토 기준 미설정')).toBeTruthy()
  expect(fetchMock.mock.calls.some(([, options]) => options?.method === 'POST')).toBe(false)
})

it.each(['case', 'fixture', 'overall'] as const)('검토 새로고침은 %s 초안을 확인 없이 버리지 않고 취소 또는 명시적 재조회를 선택한다', async (kind) => {
  const original = fetchMock.getMockImplementation()!
  const state: EvaluationReview = { ...reviewDefaults, quality: qualityState, material: reviewMaterial, material_error: '', is_baseline: false, baseline_version: 0, baseline_history: [], reviews: [] }
  let reads = 0
  fetchMock.mockImplementation(async (path, options) => {
    if (path.endsWith('/review')) { reads += 1; return json(state) }
    return original(path, options)
  })
  await act(async () => { open(`/ops/evaluations/${id}`) })
  const panel = within(screen.getByRole('region', { name: '응답 검토와 기준 지정' }))
  if (kind === 'case') selectFixedReviewArea('답변 확인')
  if (kind === 'overall') selectFixedReviewArea('전체·비교')
  const label = { case: /^E01 (어떤 문제가 있나요|무엇을 더 확인해야 하나요)\?$/, fixture: '판단하기 어려운 이유', overall: '검토 의견' }[kind]
  if (kind === 'fixture') fireEvent.change(panel.getByLabelText('평가 기준이 맞나요?'), { target: { value: 'DEFERRED' } })
  if (kind === 'case') fireEvent.change(panel.getByLabelText('E01 판단'), { target: { value: 'DEFERRED' } })
  fireEvent.change(panel.getByLabelText(label), { target: { value: '검토 중인 근거' } })
  if (kind === 'fixture') {
    expect(panel.getByLabelText('E01 판단')).toHaveProperty('disabled', true)
    selectFixedReviewArea('전체·비교')
    expect(panel.getByRole('button', { name: '결과 판정하기' })).toHaveProperty('disabled', true)
    expect(panel.getByText(/작성 중인 기준 확인을 먼저 저장하거나 입력을 비워 주세요/)).toBeTruthy()
    selectFixedReviewArea('평가 기준')
  }
  fireEvent.click(panel.getByRole('button', { name: '검토 새로고침' }))
  expect(panel.getByRole('button', { name: '입력 버리고 새로고침' })).toBeTruthy()
  expect(reads).toBe(1)
  expect(panel.getByLabelText(label)).toHaveProperty('value', '검토 중인 근거')
  fireEvent.click(panel.getByRole('button', { name: '계속 작성' }))
  expect(panel.queryByRole('button', { name: '입력 버리고 새로고침' })).toBeNull()
  expect(panel.getByLabelText(label)).toHaveProperty('value', '검토 중인 근거')
  fireEvent.click(panel.getByRole('button', { name: '검토 새로고침' }))
  await act(async () => { fireEvent.click(panel.getByRole('button', { name: '입력 버리고 새로고침' })) })
  expect(reads).toBe(2)
  expect(panel.getByRole('button', { name: '검토 새로고침' })).toHaveProperty('disabled', false)
  if (kind === 'fixture' || kind === 'case') expect(panel.queryByLabelText(label)).toBeNull()
  else expect(panel.getByLabelText(label)).toHaveProperty('value', '')
  expect(panel.getByLabelText('E01 판단')).toHaveProperty('disabled', false)
  expect(panel.getByLabelText('모든 질문의 공고 내용과 평가 기준을 확인했어요.')).toHaveProperty('checked', false)
  expect(panel.getByLabelText('모든 질문과 공고 내용, 답변을 확인했어요.')).toHaveProperty('checked', false)
  if (kind === 'fixture') {
    fireEvent.change(panel.getByLabelText('평가 기준이 맞나요?'), { target: { value: 'DEFERRED' } })
    expect(panel.getByLabelText(label)).toHaveProperty('value', '')
  }
  expect(fetchMock.mock.calls.some(([, options]) => options?.method === 'POST' || options?.method === 'DELETE')).toBe(false)
})

it('검토 재조회 중과 실패 후에는 이전 자료의 판정·기준 지정·입력을 잠그고 성공 후에만 다시 연다', async () => {
  const original = fetchMock.getMockImplementation()!
  const state: EvaluationReview = { ...reviewDefaults, approval_current: true, quality: qualityState, material: reviewMaterial, material_error: '', is_baseline: false, baseline_version: 0, baseline_history: [], reviews: [] }
  let resolve!: (value: Response) => void
  const pending = new Promise<Response>((done) => { resolve = done })
  let reads = 0
  fetchMock.mockImplementation(async (path, options) => {
    if (path.endsWith('/review')) return ++reads === 2 ? pending : json(state)
    return original(path, options)
  })
  open(`/ops/evaluations/${id}`)
  await screen.findByRole('navigation', { name: '답변 검토 영역' })
  selectFixedReviewArea('전체·비교')
  const promote = screen.getByRole('button', { name: '비교 기준으로 지정' })
  expect(promote).toHaveProperty('disabled', false)
  fireEvent.click(screen.getByRole('button', { name: '검토 새로고침' }))
  expect(promote).toHaveProperty('disabled', true)
  expect(screen.getByLabelText('E01 판단')).toHaveProperty('disabled', true)
  expect(screen.getByRole('button', { name: '결과 판정하기' })).toHaveProperty('disabled', true)
  await act(async () => { resolve(json({}, 503)); await pending })
  await waitFor(() => expect(screen.getByRole('button', { name: '검토 새로고침' })).toHaveProperty('disabled', false))
  expect(promote).toHaveProperty('disabled', true)
  expect(screen.getByLabelText('평가 기준이 맞나요?')).toHaveProperty('disabled', true)
  fireEvent.click(promote)
  fireEvent.click(screen.getByRole('button', { name: '결과 판정하기' }))
  expect(fetchMock.mock.calls.some(([, options]) => options?.method === 'POST')).toBe(false)
  fireEvent.click(screen.getByRole('button', { name: '검토 새로고침' }))
  await waitFor(() => expect(promote).toHaveProperty('disabled', false))
  expect(screen.getByLabelText('E01 판단')).toHaveProperty('disabled', false)
})

it.each(['case', 'fixture', 'quality'] as const)('검토 %s 저장 충돌은 입력을 보존하고 재조회 전 재전송을 차단한다', async (kind) => {
  const original = fetchMock.getMockImplementation()!
  const state: EvaluationReview = { ...reviewDefaults, quality: qualityState, material: reviewMaterial, material_error: '', is_baseline: false, baseline_version: 0, baseline_history: [], reviews: [] }
  const endpoint = { case: '/case-review', fixture: '/fixture-review', quality: '/quality' }[kind]
  const buttonName = { case: 'E01 검토 저장', fixture: '평가 기준 저장', quality: '결과 판정하기' }[kind]
  fetchMock.mockImplementation(async (path, options) => {
    if (path.endsWith('/review')) return json(state)
    if (path.endsWith(endpoint)) return json({}, 409)
    return original(path, options)
  })
  open(`/ops/evaluations/${id}`)
  await screen.findByRole('navigation', { name: '답변 검토 영역' })
  selectFixedReviewArea(kind === 'fixture' ? '평가 기준' : kind === 'quality' ? '전체·비교' : '답변 확인')
  if (kind === 'case') {
    fireEvent.change(screen.getByLabelText('E01 판단'), { target: { value: 'DEFERRED' } })
    fireEvent.change(screen.getByLabelText(/^E01 (어떤 문제가 있나요|무엇을 더 확인해야 하나요)\?$/), { target: { value: '원문 재확인 중' } })
  } else if (kind === 'fixture') {
    fireEvent.change(screen.getByLabelText('평가 기준이 맞나요?'), { target: { value: 'DEFERRED' } })
    fireEvent.change(screen.getByLabelText('판단하기 어려운 이유'), { target: { value: '원문 재확인 중' } })
    fireEvent.click(screen.getByLabelText('모든 질문의 공고 내용과 평가 기준을 확인했어요.'))
  }
  const save = screen.getByRole('button', { name: buttonName, hidden: true })
  fireEvent.click(save)
  await screen.findByText(/검토 기록이 변경되었습니다/)
  await waitFor(() => expect(screen.getByRole('button', { name: '검토 새로고침' })).toHaveProperty('disabled', false))
  expect(save).toHaveProperty('disabled', true)
  if (kind !== 'quality') expect(screen.getByLabelText(kind === 'case' ? /^E01 (어떤 문제가 있나요|무엇을 더 확인해야 하나요)\?$/ : '판단하기 어려운 이유')).toHaveProperty('value', '원문 재확인 중')
  fireEvent.click(save)
  expect(fetchMock.mock.calls.filter(([path]) => path.endsWith(endpoint))).toHaveLength(1)
  fireEvent.click(screen.getByRole('button', { name: '검토 새로고침' }))
  if (kind !== 'quality') fireEvent.click(screen.getByRole('button', { name: '입력 버리고 새로고침' }))
  selectFixedReviewArea('전체·비교')
  await waitFor(() => expect(screen.getByRole('button', { name: '결과 판정하기' })).toHaveProperty('disabled', false))
  expect(screen.queryByLabelText(/^E01 (어떤 문제가 있나요|무엇을 더 확인해야 하나요)\?$/)).toBeNull()
  expect(screen.queryByLabelText('판단하기 어려운 이유')).toBeNull()
  fireEvent.change(screen.getByLabelText('평가 기준이 맞나요?'), { target: { value: 'DEFERRED' } })
  expect(screen.getByLabelText('판단하기 어려운 이유')).toHaveProperty('value', '')
})

it.each([false, true])('전체 검토와 기준 해제(%s) 충돌은 사유를 보존하고 재저장을 막는다', async (clear) => {
  const original = fetchMock.getMockImplementation()!
  const state: EvaluationReview = { ...reviewDefaults, quality: qualityState, material: reviewMaterial, material_error: '', is_baseline: clear, baseline_version: 1, baseline_history: [], reviews: [] }
  fetchMock.mockImplementation(async (path, options) => {
    if (path.endsWith('/review') && options?.method !== 'POST') return json(state)
    if (path.endsWith('/review') || path.endsWith('/baseline')) return json({}, 409)
    return original(path, options)
  })
  open(`/ops/evaluations/${id}`)
  await screen.findByRole('navigation', { name: '답변 검토 영역' })
  selectFixedReviewArea('전체·비교')
  if (clear) fireEvent.click(screen.getByText('비교 기준 해제하기'))
  const reason = clear ? '기준 해제 이유' : '검토 의견'
  fireEvent.change(await screen.findByLabelText(reason), { target: { value: '수정할 조건을 재확인해야 함' } })
  if (!clear) fireEvent.click(screen.getByLabelText('모든 질문과 공고 내용, 답변을 확인했어요.'))
  const save = screen.getByRole('button', { name: clear ? '비교 기준 해제' : '수정 필요 저장' })
  fireEvent.click(save)
  await screen.findByText(/검토 기록이 변경되었습니다/)
  await waitFor(() => expect(screen.getByRole('button', { name: '검토 새로고침' })).toHaveProperty('disabled', false))
  expect(screen.getByLabelText(reason)).toHaveProperty('value', '수정할 조건을 재확인해야 함')
  expect(save).toHaveProperty('disabled', true)
  fireEvent.click(save)
  expect(fetchMock.mock.calls.filter(([, options]) => options?.method === (clear ? 'DELETE' : 'POST'))).toHaveLength(1)
})

it('평가 기준을 바로 확인할 수 있고 보기만 해서는 승인 요청을 보내지 않는다', async () => {
  const original = fetchMock.getMockImplementation()!
  fetchMock.mockImplementation((path, options) => path.endsWith('/review')
    ? Promise.resolve(json({ ...reviewDefaults, quality: qualityState, material: reviewMaterial, material_error: '', is_baseline: false, baseline_version: 0, baseline_history: [], reviews: [] }))
    : original(path, options))
  open(`/ops/evaluations/${id}`)
  await screen.findByRole('button', { name: '평가 기준 저장' })
  expect(within(screen.getByRole('navigation', { name: '답변 검토 영역' })).getByRole('button', { name: /^평가 기준 ·/ }).getAttribute('aria-pressed')).toBe('true')
  expect(screen.queryByRole('button', { name: '평가 기준 확인하기' })).toBeNull()
  expect(screen.getByRole('button', { name: '평가 기준 저장' })).toHaveProperty('disabled', true)
  expect(fetchMock.mock.calls.some(([, options]) => options?.method === 'POST')).toBe(false)
})

it('완료 실행도 미판정으로 표시하고 현재 근거 해시로만 품질 판정을 저장한다', async () => {
  const original = fetchMock.getMockImplementation()!
  let state: EvaluationReview = { ...reviewDefaults, can_promote: false, quality: qualityState, material: reviewMaterial, material_error: '', is_baseline: false, baseline_version: 0, baseline_history: [], reviews: [] }
  fetchMock.mockImplementation(async (path, options) => {
    if (path.endsWith('/review')) return json(state)
    if (path.endsWith('/quality')) {
      expect(JSON.parse(String(options?.body))).toEqual({ input_sha256: qualityState.input_sha256 })
      expect(options?.headers).toMatchObject({ 'X-CSRFToken': 'rotated-token' })
      state = { ...state, quality: { ...qualityState, status: 'NEEDS_REVIEW', is_current: true, current_id: 1,
        history: [{ id: 1, status: 'NEEDS_REVIEW', policy: qualityState.policy!, policy_sha256: '7'.repeat(64), input_sha256: qualityState.input_sha256!,
          assessed_by: 'operator@example.com', created_at: completed.created_at, reasons: [{ code: 'FIXTURE_REVIEW_REQUIRED', case_id: null, message: '평가 기준 자료의 사람 검토가 필요합니다.' }] }] } }
      return json(state)
    }
    return original(path, options)
  })
  open(`/ops/evaluations/${id}`)
  await screen.findByRole('navigation', { name: '답변 검토 영역' })
  selectFixedReviewArea('전체·비교')
  const finalResult = document.getElementById('quality-review')!
  expect(screen.getByRole('heading', { name: '평가가 끝났어요' })).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '결과 판정하기' }))
  await waitFor(() => expect(finalResult.textContent).toContain('확인 필요'))
  expect(within(finalResult).queryByRole('button', { name: /결과 .*판정하기/ })).toBeNull()
  expect(within(finalResult).getByRole('button', { name: '평가 기준 확인하기' })).toBeTruthy()
  selectFixedReviewArea('전체·비교')
  expect(screen.getByRole('button', { name: '비교 기준으로 지정' })).toHaveProperty('disabled', true)
  expect(fetchMock.mock.calls.some(([path, options]) => path === '/api/v1/ops/evaluations' && options?.method === 'POST')).toBe(false)
})

it('평가 기준 자료 검토는 사유와 확인 후 저장하며 후보 답변 승인을 대신하지 않는다', async () => {
  const original = fetchMock.getMockImplementation()!
  const state: EvaluationReview = { ...reviewDefaults, can_promote: false, quality: qualityState, material: reviewMaterial, material_error: '', is_baseline: false, baseline_version: 0, baseline_history: [], reviews: [] }
  fetchMock.mockImplementation(async (path, options) => {
    if (path.endsWith('/review')) return json(state)
    if (path.endsWith('/fixture-review')) {
      expect(JSON.parse(String(options?.body))).toEqual({
        decision: 'DEFERRED', comment: '예외 조건의 근거 재검토', fixture_sha256: reviewMaterial.fixture_sha256,
        case_ids: ['E01'], rubric_version: qualityState.fixture_rubric_version, fixture_version: 0,
      })
      return json(state)
    }
    return original(path, options)
  })
  open(`/ops/evaluations/${id}`)
  const button = await screen.findByRole('button', { name: '평가 기준 저장', hidden: true })
  expect(button).toHaveProperty('disabled', true)
  fireEvent.change(screen.getByLabelText('평가 기준이 맞나요?'), { target: { value: 'DEFERRED' } })
  fireEvent.change(screen.getByLabelText('판단하기 어려운 이유'), { target: { value: '예외 조건의 근거 재검토' } })
  expect(button).toHaveProperty('disabled', true)
  fireEvent.click(screen.getByLabelText('모든 질문의 공고 내용과 평가 기준을 확인했어요.'))
  fireEvent.click(button)
  await waitFor(() => expect(fetchMock.mock.calls.filter(([path]) => path.endsWith('/fixture-review'))).toHaveLength(1))
  expect(fetchMock.mock.calls.some(([path, options]) => path.endsWith('/review') && options?.method === 'POST')).toBe(false)
})

it('과거 품질 합격이 있어도 근거가 바뀌면 기준 지정이 차단되고 이력이 유지된다', async () => {
  const original = fetchMock.getMockImplementation()!
  const state = { ...reviewDefaults, approval_current: true, can_promote: false, quality: { ...qualityState, status: 'NEEDS_REVIEW', history: [{
    id: 1, status: 'PASS', policy: qualityState.policy, policy_sha256: '7'.repeat(64), input_sha256: '6'.repeat(64),
    assessed_by: 'operator@example.com', created_at: completed.created_at, reasons: [],
  }] }, material: reviewMaterial, material_error: '', is_baseline: false, baseline_version: 0, baseline_history: [], reviews: [] }
  fetchMock.mockImplementation(async (path, options) => path.endsWith('/review') ? json(state) : original(path, options))
  open(`/ops/evaluations/${id}`)
  await screen.findByRole('navigation', { name: '답변 검토 영역' })
  selectFixedReviewArea('전체·비교')
  expect(screen.getByText('판정에 사용한 내용이 바뀌어 다시 판정해야 해요.')).toBeTruthy()
  expect(screen.getByText('결과 확인 이력 · 1건')).toBeTruthy()
  selectFixedReviewArea('전체·비교')
  expect(screen.getByRole('button', { name: '비교 기준으로 지정' })).toHaveProperty('disabled', true)
})

it('근거·응답을 검토한 후 의견과 승인 기록을 저장하고 기준을 지정한다', async () => {
  const original = fetchMock.getMockImplementation()!
  let state: EvaluationReview = { ...reviewDefaults, material: reviewMaterial, material_error: '', is_baseline: false, baseline_version: 0, baseline_history: [], reviews: [] }
  fetchMock.mockImplementation(async (path, options) => {
    if (path === `/api/v1/ops/evaluations/${id}/review`) {
      if (options?.method === 'POST') {
        expect(options.headers).toMatchObject({ 'X-CSRFToken': 'rotated-token' })
        const input = JSON.parse(String(options.body))
        state = { ...state, review_version: 2, approval_current: true, reviews: [{ ...input, id: 1, version: 2, case_review_ids: [1], reviewed_by: 'operator@example.com', created_at: completed.created_at }] }
      }
      return json(state)
    }
    if (path === `/api/v1/ops/evaluations/${id}/case-review`) {
      const input = JSON.parse(String(options?.body))
      expect(input).toMatchObject({ case_id: 'E01', decision: 'SUITABLE', comment: '', review_version: 0, rubric_version: reviewDefaults.rubric.version, fixture_sha256: reviewMaterial.fixture_sha256 })
      state = { ...state, review_version: 1, can_approve: true, case_reviews: [{ ...input, id: 1, version: 1, reviewed_by: 'operator@example.com', created_at: completed.created_at }] }
      return json(state)
    }
    if (path === `/api/v1/ops/evaluations/${id}/baseline`) {
      expect(JSON.parse(String(options?.body))).toEqual({ review_id: 1, baseline_version: 0 })
      state = { ...state, is_baseline: true }
      return json(state)
    }
    return original(path, options)
  })
  open(`/ops/evaluations/${id}`)
  expect(await screen.findByText('서울 소재 법인만 가능합니다.')).toBeTruthy()
  expect(screen.getByText('<script>후보 답변은 텍스트로 표시</script>')).toBeTruthy()
  expect(document.querySelector('script')).toBeNull()
  selectFixedReviewArea('전체·비교')
  const approve = screen.getByRole('button', { name: '검토 승인 저장' })
  const promote = screen.getByRole('button', { name: '비교 기준으로 지정' })
  expect(approve).toHaveProperty('disabled', true)
  expect(promote).toHaveProperty('disabled', true)
  selectFixedReviewArea('답변 확인')
  fireEvent.change(screen.getByLabelText('E01 판단'), { target: { value: 'SUITABLE' } })
  expect(approve).toHaveProperty('disabled', true)
  fireEvent.click(screen.getByRole('button', { name: 'E01 검토 저장' }))
  expect(await screen.findByText('E01 사례 검토를 저장했습니다.')).toBeTruthy()
  selectFixedReviewArea('전체·비교')
  fireEvent.change(screen.getByLabelText('검토 의견'), { target: { value: '지역과 법인 조건을 확인했습니다.' } })
  fireEvent.click(screen.getByLabelText('모든 질문과 공고 내용, 답변을 확인했어요.'))
  fireEvent.click(approve)
  expect(await screen.findByText('검토 기록을 저장했습니다.')).toBeTruthy()
  await waitFor(() => expect(promote).toHaveProperty('disabled', false))
  fireEvent.click(promote)
  expect(await screen.findByText('이 결과를 비교 기준으로 사용 중이에요.')).toBeTruthy()
  expect(fetchMock.mock.calls.some(([path, options]) => path === '/api/v1/ops/evaluations' && options?.method === 'POST')).toBe(false)
})

it('검토 기준을 다음 평가의 기준 선택에 표시하고 후보 목록과 구별한다', async () => {
  const original = fetchMock.getMockImplementation()!
  fetchMock.mockImplementation((path, options) => path === '/api/v1/ops/evaluation-catalog'
    ? Promise.resolve(json({ ...session(), datasets: [{ ...dataset, baseline: { version: 1, id: `run:${id}`, label: '검토 기준 · 10000000' } }] }))
    : original(path, options))
  open()
  await evaluationStep(3)
  expect(await screen.findByLabelText('비교 기준 답변')).toHaveProperty('value', `run:${id}`)
  await evaluationStep(3)
  expect(screen.getByLabelText('다시 확인할 답변')).toHaveProperty('value', capture.id)
  await evaluationStep(3)
  fireEvent.click(screen.getByRole('button', { name: '평가 실행' }))
  await screen.findByRole('heading', { name: '평가 실행 상세' })
  const payload = fetchMock.mock.calls.find(([path, options]) => path === '/api/v1/ops/evaluations' && options?.method === 'POST')?.[1]?.body
  expect(JSON.parse(String(payload))).toMatchObject({ reference_capture_id: `run:${id}`, execution_mode: 'replay' })
})

it('확인할 수 없는 자료를 승인하거나 기준으로 지정하지 않는다', async () => {
  const original = fetchMock.getMockImplementation()!
  fetchMock.mockImplementation((path, options) => path.endsWith('/review')
    ? Promise.resolve(json({ ...reviewDefaults, material: null, material_error: '검토 자료를 확인할 수 없습니다.', reviews: [], is_baseline: false, baseline_version: 0, baseline_history: [] }))
    : original(path, options))
  open(`/ops/evaluations/${id}`)
  expect(await screen.findByText('검토 자료를 확인할 수 없습니다.')).toBeTruthy()
  expect(screen.queryByRole('button', { name: '검토 승인 저장' })).toBeNull()
  expect(screen.queryByRole('button', { name: '비교 기준으로 지정' })).toBeNull()
})

const pendingRequest = () => ({ execution_profile: executionProfiles.live, request_id: id, dataset_id: dataset.id, candidate_capture_id: 'new-model-response', reference_capture_id: capture.id, live_config: liveConfig, baseline_version: null })

it('유료 접수 응답 유실 후 새로고침·재로그인하면 기존 요청만 조회한다', async () => {
  const original = fetchMock.getMockImplementation()!
  let modelCalls = 0
  fetchMock.mockImplementation(async (path, options) => {
    if (path === '/api/v1/ops/evaluations') { modelCalls++; throw new TypeError('accepted but response lost') }
    return original(path, options)
  })
  const view = open()
  await evaluationStep(2)
  fireEvent.click(await screen.findByRole('radio', { name: '새 응답 생성' }))
  await evaluationStep(3)
  fireEvent.click(screen.getByRole('checkbox'))
  await evaluationStep(3)
  fireEvent.click(screen.getByRole('button', { name: '새 응답 생성 및 평가' }))
  await screen.findByRole('button', { name: '같은 요청으로 재시도' })
  expect(readPendingEvaluation('core:99')).toEqual(pendingRequest())
  view.unmount()
  authenticated = false
  open()
  await screen.findByRole('heading', { name: '로그인' })
  fireEvent.change(screen.getByLabelText('이메일'), { target: { value: 'operator@example.com' } })
  fireEvent.change(screen.getByLabelText('비밀번호'), { target: { value: 'valid-password' } })
  fireEvent.click(screen.getByRole('button', { name: '이메일로 로그인' }))
  await screen.findByRole('heading', { name: '평가 실행 상세' })
  expect(modelCalls).toBe(1)
  expect(readPendingEvaluation('core:99')).toBeNull()
})

it('서버에 없는 보관 요청은 자동 전송하지 않고 확인 후 같은 UUID와 조건으로 접수한다', async () => {
  storePendingEvaluation('core:99', pendingRequest())
  const original = fetchMock.getMockImplementation()!
  let accepted = false
  fetchMock.mockImplementation(async (path, options) => {
    if (path === `/api/v1/ops/evaluations/${id}` && !accepted) return json({}, 404)
    if (path === '/api/v1/ops/evaluations') {
      expect(JSON.parse(String(options?.body))).toMatchObject({ ...pendingRequest(), execution_mode: 'live', confirm_paid_run: true })
      accepted = true
    }
    return original(path, options)
  })
  open()
  await screen.findByText(/아직 접수된 요청을 찾지 못했습니다/)
  expect(accepted).toBe(false)
  fireEvent.click(screen.getByRole('button', { name: '같은 요청으로 재시도' }))
  await screen.findByRole('heading', { name: '평가 실행 상세' })
  expect(accepted).toBe(true)
  expect(readPendingEvaluation('core:99')).toBeNull()
})

it.each([404, 503])('보관 요청의 서버 상태가 %i여도 확인 후 이 탭의 기록만 지우고 평가 선택으로 돌아간다', async (status) => {
  storePendingEvaluation('core:99', pendingRequest())
  storePendingEvaluation('core:other', pendingRequest())
  const original = fetchMock.getMockImplementation()!
  fetchMock.mockImplementation(async (path, options) => path === `/api/v1/ops/evaluations/${id}` ? json({}, status) : original(path, options))
  open()
  const stop = await screen.findByRole('button', { name: '요청 보관 종료' })
  await waitFor(() => expect(stop).toHaveProperty('disabled', false))
  fireEvent.click(stop)
  expect(screen.getByText(/서버에 이미 접수된 평가는 취소되지 않습니다/)).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '돌아가기' }))
  expect(readPendingEvaluation('core:99')).toEqual(pendingRequest())
  expect(screen.queryByRole('button', { name: '보관 기록 지우기' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '요청 보관 종료' }))
  fireEvent.click(screen.getByRole('button', { name: '보관 기록 지우기' }))
  expect(readPendingEvaluation('core:99')).toBeNull()
  expect(readPendingEvaluation('core:other')).toEqual(pendingRequest())
  expect(screen.getByRole('heading', { name: '1. 평가 자료 선택' })).toBeTruthy()
  expect(fetchMock.mock.calls.filter(([path]) => path === `/api/v1/ops/evaluations/${id}`)).toHaveLength(1)
  expect(fetchMock.mock.calls.some(([, options]) => ['POST', 'DELETE'].includes(options?.method ?? 'GET'))).toBe(false)
  expect(screen.getByRole('combobox', { name: '평가 자료' })).toHaveProperty('value', '')
  fireEvent.click(screen.getByRole('link', { name: '예산 관리' }))
  await screen.findByRole('region', { name: '평가 예산' })
  fireEvent.click(screen.getByRole('link', { name: '새 평가' }))
  expect(await screen.findByRole('combobox', { name: '평가 자료' })).toHaveProperty('value', '')
  fireEvent.change(screen.getByRole('combobox', { name: '평가 자료' }), { target: { value: dataset.id } })
  await evaluationStep(2)
  fireEvent.click(screen.getByRole('radio', { name: '새 응답 생성' }))
  expect(screen.getByRole('combobox', { name: '평가 모델' })).toHaveProperty('value', liveConfig.model)
  await evaluationStep(3)
  expect(screen.getByRole('checkbox', { name: /위 자료의 OpenAI 전송/ })).toHaveProperty('checked', false)
})

it('보관 기록을 지우지 못하면 요청을 유지하고 오류를 표시한다', async () => {
  storePendingEvaluation('core:99', pendingRequest())
  const original = fetchMock.getMockImplementation()!
  fetchMock.mockImplementation(async (path, options) => path === `/api/v1/ops/evaluations/${id}` ? json({}, 404) : original(path, options))
  open()
  const stop = await screen.findByRole('button', { name: '요청 보관 종료' })
  await waitFor(() => expect(stop).toHaveProperty('disabled', false))
  fireEvent.click(stop)
  vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('storage unavailable') })
  fireEvent.click(screen.getByRole('button', { name: '보관 기록 지우기' }))
  expect(await screen.findByText(/보관 기록을 지우지 못했습니다/)).toBeTruthy()
  expect(readPendingEvaluation('core:99')).toEqual(pendingRequest())
  expect(screen.queryByRole('heading', { name: '1. 평가 자료 선택' })).toBeNull()
  expect(fetchMock.mock.calls.some(([, options]) => ['POST', 'DELETE'].includes(options?.method ?? 'GET'))).toBe(false)
})

it('다른 관리자의 보관 요청은 복원하거나 제거하지 않는다', async () => {
  storePendingEvaluation('core:other', pendingRequest())
  open()
  await evaluationStep(3)
  await screen.findByRole('button', { name: '평가 실행' })
  expect(screen.queryByText(/보관한 요청:/)).toBeNull()
  expect(fetchMock.mock.calls.some(([path]) => path === `/api/v1/ops/evaluations/${id}`)).toBe(false)
  expect(readPendingEvaluation('core:other')).toEqual(pendingRequest())
})

it('보관한 유료 요청은 허용 모델 목록이 바뀌어도 원래 모델·예산·명세로만 재시도한다', async () => {
  const option = modelOptions[1]
  const pending = { ...pendingRequest(), ...option }
  storePendingEvaluation('core:99', pending)
  const original = fetchMock.getMockImplementation()!
  let accepted = false
  fetchMock.mockImplementation(async (path, options) => {
    if (path === `/api/v1/ops/evaluations/${id}` && !accepted) return json({}, 404)
    if (path === '/api/v1/ops/evaluations') {
      expect(JSON.parse(String(options?.body))).toMatchObject({ ...pending, execution_mode: 'live', confirm_paid_run: true })
      accepted = true
    }
    return original(path, options)
  })
  open()
  await screen.findByText(/아직 접수된 요청을 찾지 못했습니다/)
  expect(within(screen.getByRole('region', { name: '평가 설정 요약' })).getByText('새 응답 생성 · gpt-6-sol')).toBeTruthy()
  expect(screen.queryByRole('button', { name: '이전: 답변 확인 방법' })).toBeNull()
  expect(screen.getByText(/호출당 출력 최대 4,000토큰/)).toBeTruthy()
  expect(screen.queryByRole('button', { name: '실행 설정·예산 점검' })).toBeNull()
  expect(accepted).toBe(false)
  fireEvent.click(screen.getByRole('button', { name: '같은 요청으로 재시도' }))
  await screen.findByRole('heading', { name: '평가 실행 상세' })
  expect(accepted).toBe(true)
})

it('손상된 보관 요청은 지우고 새 유료 요청을 만드는 대신 접수를 차단한다', async () => {
  sessionStorage.setItem('govbiz.ops.pending.v1.core%3A99', '{broken')
  open()
  await screen.findByText(/보관한 요청을 읽을 수 없습니다/)
  await evaluationStep(3)
  expect(screen.getByRole('button', { name: '평가 실행' })).toHaveProperty('disabled', true)
  expect(fetchMock.mock.calls.some(([, options]) => options?.method === 'POST')).toBe(false)
})

it('요청 보관에 실패하면 네트워크 접수를 시작하지 않는다', async () => {
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota') })
  open()
  await evaluationStep(3)
  fireEvent.click(await screen.findByRole('button', { name: '평가 실행' }))
  await screen.findByText(/요청을 보관할 수 없어 전송하지 않았습니다/)
  expect(fetchMock.mock.calls.some(([, options]) => options?.method === 'POST')).toBe(false)
})

it('복원 조회 장애는 새 UUID 생성이나 자동 재접수로 처리하지 않는다', async () => {
  storePendingEvaluation('core:99', pendingRequest())
  const original = fetchMock.getMockImplementation()!
  fetchMock.mockImplementation(async (path, options) => path === `/api/v1/ops/evaluations/${id}` ? json({}, 503) : original(path, options))
  open()
  await screen.findByText(/관리자 인증 또는 운영 서버에 연결할 수 없습니다/)
  expect(readPendingEvaluation('core:99')).toEqual(pendingRequest())
  expect(crypto.randomUUID).not.toHaveBeenCalled()
  expect(fetchMock.mock.calls.some(([, options]) => options?.method === 'POST')).toBe(false)
})

it('첫 유료 접수가 예산 또는 실행 설정으로 거절되면 확인 경로를 안내하고 조건 재선택 시 동의를 초기화한다', async () => {
  const original = fetchMock.getMockImplementation()!
  const requests: Array<Record<string, unknown>> = []
  fetchMock.mockImplementation(async (path, options) => {
    if (path === '/api/v1/ops/evaluations' && options?.method === 'POST') {
      requests.push(JSON.parse(String(options.body)))
      return json({ code: 'LIVE_BUDGET_UNAVAILABLE' }, 400)
    }
    return original(path, options)
  })
  open()
  await evaluationStep(2)
  fireEvent.click(screen.getByRole('radio', { name: '새 응답 생성' }))
  await evaluationStep(3)
  const consent = screen.getByRole('checkbox', { name: /위 자료의 OpenAI 전송/ })
  fireEvent.click(consent)
  expect(consent).toHaveProperty('checked', true)
  fireEvent.click(screen.getByRole('button', { name: '새 응답 생성 및 평가' }))
  expect(await screen.findByText(/사용 한도가 부족하거나 예산 상태를 확인해야 해요/)).toBeTruthy()
  expect(screen.getByText('평가를 시작할 수 없어요')).toBeTruthy()
  expect(screen.getByText(/이번 평가는 접수되지 않았어요/)).toBeTruthy()
  expect(screen.getByRole('link', { name: '예산 관리로 이동' }).getAttribute('href')).toBe('/ops/budget')
  expect(screen.queryByText(/재시도할 때 보관한 요청을 사용합니다/)).toBeNull()
  expect(screen.getByRole('button', { name: '같은 요청으로 재시도' })).toHaveProperty('disabled', true)
  expect(requests).toHaveLength(1)
  expect(requests[0]).toMatchObject({ request_id: id, execution_mode: 'live', confirm_paid_run: true })
  expect(readPendingEvaluation('core:99')?.request_id).toBe(id)

  fireEvent.click(screen.getByRole('button', { name: '접수되지 않은 조건 다시 선택' }))
  await evaluationStep(2)
  expect(readPendingEvaluation('core:99')).toBeNull()
  fireEvent.click(screen.getByRole('radio', { name: '새 응답 생성' }))
  await evaluationStep(3)
  expect(screen.getByRole('checkbox', { name: /위 자료의 OpenAI 전송/ })).toHaveProperty('checked', false)
  expect(screen.getByRole('button', { name: '새 응답 생성 및 평가' })).toHaveProperty('disabled', true)
  expect(requests).toHaveLength(1)
})

it('예산 관리에 다녀온 뒤 보관 요청을 먼저 조회하고 명시적으로 같은 UUID와 조건으로 재시도한다', async () => {
  const original = fetchMock.getMockImplementation()!
  const requests: Array<Record<string, unknown>> = []
  let reads = 0
  fetchMock.mockImplementation(async (path, options) => {
    if (path === `/api/v1/ops/evaluations/${id}` && requests.length < 2) {
      reads += 1
      return json({}, 404)
    }
    if (path === '/api/v1/ops/evaluations' && options?.method === 'POST') {
      requests.push(JSON.parse(String(options.body)))
      return requests.length === 1 ? json({ code: 'LIVE_BUDGET_UNAVAILABLE' }, 400) : json(completed, 202)
    }
    return original(path, options)
  })
  open()
  await evaluationStep(2)
  fireEvent.click(screen.getByRole('radio', { name: '새 응답 생성' }))
  await evaluationStep(3)
  fireEvent.click(screen.getByRole('checkbox', { name: /위 자료의 OpenAI 전송/ }))
  fireEvent.click(screen.getByRole('button', { name: '새 응답 생성 및 평가' }))
  await screen.findByText(/사용 한도가 부족하거나 예산 상태를 확인해야 해요/)
  expect(requests).toHaveLength(1)
  expect(readPendingEvaluation('core:99')?.request_id).toBe(id)

  fireEvent.click(screen.getByRole('link', { name: '예산 관리로 이동' }))
  await screen.findByRole('region', { name: '평가 예산' })
  expect(requests).toHaveLength(1)
  fireEvent.click(screen.getByRole('link', { name: '새 평가' }))
  await screen.findByText(/아직 접수된 요청을 찾지 못했습니다/)
  expect(reads).toBe(1)
  expect(requests).toHaveLength(1)
  expect(readPendingEvaluation('core:99')?.request_id).toBe(id)
  expect(screen.getByRole('button', { name: '같은 요청으로 재시도' })).toHaveProperty('disabled', false)

  fireEvent.click(screen.getByRole('button', { name: '같은 요청으로 재시도' }))
  await screen.findByRole('heading', { name: '평가 실행 상세' })
  expect(reads).toBe(2)
  expect(requests).toHaveLength(2)
  expect(requests[1]).toEqual(requests[0])
  expect(requests[1]).toMatchObject({ request_id: id, execution_mode: 'live', confirm_paid_run: true })
  expect(readPendingEvaluation('core:99')).toBeNull()
}, 15000)

it.each(['INVALID_REFERENCE', 'LIVE_BUDGET_UNAVAILABLE'])('서버가 접수를 거절한 조건(%s)은 명시적으로 다시 선택하고 기존 유료 확인을 해제한다', async (code) => {
  storePendingEvaluation('core:99', pendingRequest())
  const original = fetchMock.getMockImplementation()!
  fetchMock.mockImplementation(async (path, options) => {
    if (path === `/api/v1/ops/evaluations/${id}`) return json({}, 404)
    if (path === '/api/v1/ops/evaluations') return json({ code }, 400)
    return original(path, options)
  })
  open()
  await screen.findByText(/아직 접수된 요청을 찾지 못했습니다/)
  expect(within(screen.getByRole('region', { name: '평가 설정 요약' })).getByText(`새 응답 생성 · ${liveConfig.model}`)).toBeTruthy()
  expect(screen.queryByRole('button', { name: '이전: 답변 확인 방법' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '같은 요청으로 재시도' }))
  if (code === 'LIVE_BUDGET_UNAVAILABLE') await screen.findByText(/사용 한도가 부족하거나 예산 상태를 확인해야 해요/)
  fireEvent.click(await screen.findByRole('button', { name: '접수되지 않은 조건 다시 선택' }))
  await evaluationStep(3)
  await screen.findByRole('button', { name: '평가 실행' })
  expect(readPendingEvaluation('core:99')).toBeNull()
  await evaluationStep(2)
  fireEvent.click(screen.getByRole('radio', { name: '새 응답 생성' }))
  await evaluationStep(3)
  expect(screen.getByRole('checkbox')).toHaveProperty('checked', false)
  expect(fetchMock.mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(1)
})

it.each([
  ['EVALUATION_ADMISSION_PAUSED', '점검을 위해 새 평가 접수가 중지되어 있습니다. 접수 재개 후 다시 시도해 주세요.'],
  ['EVALUATION_ADMISSION_UNAVAILABLE', '평가 접수 상태를 확인할 수 없어 접수하지 않았습니다. 운영자에게 확인해 주세요.'],
])('접수 중지 또는 확인 불가(%s)는 저장 요청의 503 응답과 구분한다', async (code, message) => {
  const original = fetchMock.getMockImplementation()!
  const requests: string[] = []
  fetchMock.mockImplementation(async (path, options) => {
    if (path === `/api/v1/ops/evaluations/${id}` && requests.length < 2) return json({}, 404)
    if (path === '/api/v1/ops/evaluations') {
      requests.push(JSON.parse(String(options?.body)).request_id)
      return requests.length === 1 ? json({ code }, 503) : json(completed, 202)
    }
    return original(path, options)
  })
  open()
  await evaluationStep(3)
  fireEvent.click(await screen.findByRole('button', { name: '평가 실행' }))
  await screen.findByText(message, { exact: false })
  expect(screen.queryByRole('heading', { name: '평가 실행 상세' })).toBeNull()
  expect(screen.queryByRole('link', { name: '예산 관리로 이동' })).toBeNull()
  expect(screen.queryByRole('button', { name: '접수되지 않은 조건 다시 선택' })).toBeNull()
  expect(readPendingEvaluation('core:99')?.request_id).toBe(id)
  fireEvent.click(screen.getByRole('button', { name: '같은 요청으로 재시도' }))
  expect(await screen.findByRole('heading', { name: '평가 실행 상세' })).toBeTruthy()
  expect(requests).toHaveLength(2)
  expect(requests[0]).toBe(requests[1])
})

it('접수 전 관리자 계정이 바뀌면 보관 요청을 다른 계정으로 전송하지 않는다', async () => {
  const original = fetchMock.getMockImplementation()!
  let sessions = 0
  fetchMock.mockImplementation(async (path, options) => {
    if (path === '/api/v1/ops/session' && ++sessions > 1) return json({ ...session(), user: { id: 'core:other', username: 'other@example.com' } })
    if (path === '/api/v1/ops/evaluation-catalog' && sessions > 1) return json({ datasets: [comparisonDataset] })
    return original(path, options)
  })
  open()
  await evaluationStep(3)
  fireEvent.click(await screen.findByRole('button', { name: '평가 실행' }))
  await screen.findByText('other@example.com')
  await evaluationStep(1)
  expect(await screen.findByLabelText('평가 자료')).toHaveProperty('value', '')
  expect(screen.getByRole('option', { name: comparisonDataset.label })).toBeTruthy()
  expect(screen.queryByRole('option', { name: dataset.label })).toBeNull()
  expect(fetchMock.mock.calls.filter(([path]) => path === '/api/v1/ops/evaluation-catalog')).toHaveLength(2)
  expect(fetchMock.mock.calls.some(([path, options]) => path === '/api/v1/ops/evaluations' && options?.method === 'POST')).toBe(false)
  expect(readPendingEvaluation('core:99')?.request_id).toBe(id)
})

it.each([true, false])('자료 확인 가능 여부(%s)와 무관하게 기준 해제는 버전과 사유를 보내고 이력을 표시한다', async (available) => {
  const original = fetchMock.getMockImplementation()!
  const state = { ...reviewDefaults, material: available ? reviewMaterial : null, material_error: available ? '' : '저장 자료 손상', reviews: [], is_baseline: true, baseline_version: 1, baseline_history: [] }
  fetchMock.mockImplementation(async (path, options) => {
    if (path.endsWith('/review')) return json(state)
    if (path.endsWith('/baseline')) {
      expect(options?.method).toBe('DELETE')
      expect(JSON.parse(String(options?.body))).toEqual({ baseline_version: 1, reason: '조건 오류 재검토' })
      return json({ ...state, is_baseline: false, baseline_version: 2, baseline_history: [{ version: 2, previous_run_id: id, run_id: null, capture_sha256: null, fixture_sha256: 'c'.repeat(64), changed_by: 'operator@example.com', reason: '조건 오류 재검토', created_at: completed.created_at }] })
    }
    return original(path, options)
  })
  open(`/ops/evaluations/${id}`)
  await screen.findByRole('navigation', { name: '답변 검토 영역' })
  selectFixedReviewArea('전체·비교')
  fireEvent.click(screen.getByText('비교 기준 해제하기'))
  fireEvent.change(screen.getByLabelText('기준 해제 이유'), { target: { value: '조건 오류 재검토' } })
  fireEvent.click(screen.getByRole('button', { name: '비교 기준 해제' }))
  await screen.findByText('비교 기준을 해제했습니다.')
  expect(screen.getByText(/버전 2 · 해제/)).toBeTruthy()
})

it.each(['UNSUITABLE', 'DEFERRED'] as const)('사례 판단이 %s이면 전체 승인과 기준 지정을 차단한다', async (decision) => {
  const original = fetchMock.getMockImplementation()!
  const state: EvaluationReview = { ...reviewDefaults, material: reviewMaterial, material_error: '', is_baseline: false, baseline_version: 0, baseline_history: [], reviews: [],
    review_version: 1, case_reviews: [{ id: 1, version: 1, case_id: 'E01', decision, comment: '조건을 다시 확인해야 합니다.',
      capture_sha256: reviewMaterial.capture_sha256, fixture_sha256: reviewMaterial.fixture_sha256, rubric_version: reviewDefaults.rubric.version, reviewed_by: 'reviewer@example.com', created_at: completed.created_at }] }
  fetchMock.mockImplementation((path, options) => path.endsWith('/review') ? Promise.resolve(json(state)) : original(path, options))
  open(`/ops/evaluations/${id}`)
  await screen.findByRole('navigation', { name: '답변 검토 영역' })
  selectFixedReviewArea('답변 확인')
  expect(screen.getByLabelText('E01 판단')).toHaveProperty('value', decision)
  expect(screen.queryByText(/저장된 판단:/)).toBeNull()
  selectFixedReviewArea('전체·비교')
  fireEvent.change(screen.getByLabelText('검토 의견'), { target: { value: '전체 의견' } })
  fireEvent.click(screen.getByLabelText('모든 질문과 공고 내용, 답변을 확인했어요.'))
  expect(screen.getByRole('button', { name: '검토 승인 저장' })).toHaveProperty('disabled', true)
  expect(screen.getByRole('button', { name: '비교 기준으로 지정' })).toHaveProperty('disabled', true)
  expect(screen.getByText(/reviewer@example.com/)).toBeTruthy()
})

it('사례 저장 응답이 유실되면 같은 검토 버전으로 재전송하고 재진입은 조회만 한다', async () => {
  const original = fetchMock.getMockImplementation()!
  let state: EvaluationReview = { ...reviewDefaults, material: reviewMaterial, material_error: '', is_baseline: false, baseline_version: 0, baseline_history: [], reviews: [] }
  const writes: unknown[] = []
  fetchMock.mockImplementation(async (path, options) => {
    if (path.endsWith('/review')) return json(state)
    if (path.endsWith('/case-review')) {
      const input = JSON.parse(String(options?.body))
      writes.push(input)
      state = { ...state, review_version: 1, can_approve: true, case_reviews: [{ ...input, id: 1, version: 1, reviewed_by: 'operator@example.com', created_at: completed.created_at }] }
      if (writes.length === 1) throw new TypeError('response lost')
      return json(state)
    }
    return original(path, options)
  })
  const view = open(`/ops/evaluations/${id}`)
  await screen.findByRole('navigation', { name: '답변 검토 영역' })
  selectFixedReviewArea('답변 확인')
  fireEvent.change(await screen.findByLabelText('E01 판단'), { target: { value: 'SUITABLE' } })
  fireEvent.click(screen.getByRole('button', { name: 'E01 검토 저장' }))
  await screen.findByText(/운영 서버에 연결할 수 없습니다/)
  const retry = screen.getByRole('button', { name: 'E01 검토 저장' })
  await waitFor(() => expect(retry).toHaveProperty('disabled', false))
  fireEvent.click(retry)
  await screen.findByText('E01 사례 검토를 저장했습니다.')
  expect(writes).toHaveLength(2)
  expect(writes[1]).toEqual(writes[0])
  view.unmount()
  open(`/ops/evaluations/${id}`)
  await screen.findByRole('navigation', { name: '답변 검토 영역' })
  selectFixedReviewArea('답변 확인')
  expect(screen.getByLabelText('E01 판단')).toHaveProperty('value', 'SUITABLE')
  expect(writes).toHaveLength(2)
})

it('다른 관리자 검토 충돌 후 최신 버전은 새로 조회하고 다시 입력한 판단에만 사용한다', async () => {
  const original = fetchMock.getMockImplementation()!
  let version = 0
  fetchMock.mockImplementation(async (path, options) => {
    if (path.endsWith('/review')) return json({ ...reviewDefaults, review_version: version, material: reviewMaterial, material_error: '', is_baseline: false, baseline_version: 0, baseline_history: [], reviews: [] })
    if (path.endsWith('/case-review')) { version = 1; return json({}, 409) }
    return original(path, options)
  })
  open(`/ops/evaluations/${id}`)
  await screen.findByRole('navigation', { name: '답변 검토 영역' })
  selectFixedReviewArea('답변 확인')
  fireEvent.change(await screen.findByLabelText('E01 판단'), { target: { value: 'DEFERRED' } })
  fireEvent.change(screen.getByLabelText(/^E01 (어떤 문제가 있나요|무엇을 더 확인해야 하나요)\?$/), { target: { value: '조건 확인 대기' } })
  fireEvent.click(screen.getByRole('button', { name: 'E01 검토 저장' }))
  await screen.findByText(/검토 기록이 변경되었습니다/)
  expect(screen.getByLabelText(/^E01 (어떤 문제가 있나요|무엇을 더 확인해야 하나요)\?$/)).toHaveProperty('value', '조건 확인 대기')
  expect(fetchMock.mock.calls.filter(([path]) => path.endsWith('/case-review'))).toHaveLength(1)
  fireEvent.click(screen.getByRole('button', { name: '검토 새로고침' }))
  fireEvent.click(screen.getByRole('button', { name: '입력 버리고 새로고침' }))
  await waitFor(() => expect(screen.getByLabelText('E01 판단')).toHaveProperty('disabled', false))
  selectFixedReviewArea('답변 확인')
  expect(screen.getByRole('button', { name: 'E01 검토 저장' })).toHaveProperty('disabled', true)
  expect(screen.queryByLabelText(/^E01 (어떤 문제가 있나요|무엇을 더 확인해야 하나요)\?$/)).toBeNull()
  expect(fetchMock.mock.calls.filter(([path]) => path.endsWith('/case-review'))).toHaveLength(1)
  fireEvent.change(screen.getByLabelText('E01 판단'), { target: { value: 'UNSUITABLE' } })
  fireEvent.change(screen.getByLabelText(/^E01 (어떤 문제가 있나요|무엇을 더 확인해야 하나요)\?$/), { target: { value: '최신 자료와 답변을 다시 대조함' } })
  fireEvent.click(screen.getByRole('button', { name: 'E01 검토 저장' }))
  await screen.findByText(/검토 기록이 변경되었습니다/)
  const writes = fetchMock.mock.calls.filter(([path]) => path.endsWith('/case-review'))
  expect(writes).toHaveLength(2)
  expect(JSON.parse(String(writes[0][1]?.body))).toMatchObject({ review_version: 0, comment: '조건 확인 대기' })
  expect(JSON.parse(String(writes[1][1]?.body))).toMatchObject({ review_version: 1, decision: 'UNSUITABLE', comment: '최신 자료와 답변을 다시 대조함' })
})

it('과거 전체 승인을 사례별 승인으로 표시하지 않고 기존 기준의 재검토 필요를 알린다', async () => {
  const original = fetchMock.getMockImplementation()!
  fetchMock.mockImplementation((path, options) => path.endsWith('/review') ? Promise.resolve(json({ ...reviewDefaults,
    material: reviewMaterial, material_error: '', is_baseline: true, baseline_requires_review: true, baseline_version: 1, baseline_history: [],
    reviews: [{ id: 1, decision: 'APPROVED', comment: '이전 전체 승인', capture_sha256: reviewMaterial.capture_sha256,
      fixture_sha256: '', rubric_version: '', version: null, case_review_ids: [], reviewed_by: 'old-reviewer@example.com', created_at: completed.created_at }],
  })) : original(path, options))
  open(`/ops/evaluations/${id}`)
  await screen.findByRole('button', { name: /^답변 확인 ·/ })
  expect(screen.getByText(/검토와 품질 판정을 마치기 전에는/)).toBeTruthy()
  selectFixedReviewArea('답변 확인')
  expect(screen.getByLabelText('E01 판단')).toHaveProperty('value', '')
  expect(screen.queryByText(/저장된 판단:/)).toBeNull()
  selectFixedReviewArea('전체·비교')
  expect(within(screen.getByRole('region', { name: '전체 검토' })).getByText('다시 확인 필요')).toBeTruthy()
  expect(screen.getByRole('button', { name: '검토 승인 저장' })).toHaveProperty('disabled', true)
})

it('접수 직전 서버 버전이 바뀌어도 사용자가 확인한 명세를 자동 교체하지 않는다', async () => {
  const original = fetchMock.getMockImplementation()!
  let sessions = 0
  fetchMock.mockImplementation(async (path, options) => {
    if (path === '/api/v1/ops/session') {
      sessions += 1
      return json(session())
    }
    if (path === '/api/v1/ops/evaluation-catalog') {
      return json({ datasets: [dataset, comparisonDataset].map((item) => sessions > 1
        ? { ...item, execution_profiles: { replay: 'f'.repeat(64), live: 'f'.repeat(64) } } : item) })
    }
    return original(path, options)
  })
  open()
  await evaluationStep(3)
  fireEvent.click(await screen.findByRole('button', { name: '평가 실행' }))
  await waitFor(() => expect(fetchMock.mock.calls.some(([path]) => path === '/api/v1/ops/evaluations')).toBe(true))
  const request = fetchMock.mock.calls.find(([path]) => path === '/api/v1/ops/evaluations')!
  expect(JSON.parse(request[1]!.body as string).execution_profile).toBe(executionProfiles.replay)
})

it('명세 불일치와 접수 명세 ID를 표시하고 확인되지 않은 호출 수를 0회로 바꾸지 않는다', async () => {
  const original = fetchMock.getMockImplementation()!
  fetchMock.mockImplementation(async (path, options) => path === `/api/v1/ops/evaluations/${id}`
    ? json({ ...completed, status: 'FAILED', status_label: '실패', model_api_calls: null, report_url: null,
      execution_spec_sha256: 'f'.repeat(64), error_code: 'EXECUTION_SPEC_MISMATCH',
      error_message: '접수 당시 명세와 실행 환경이 달라 모델 호출 전에 차단했습니다.' })
    : original(path, options))
  open(`/ops/evaluations/${id}`)
  expect(await screen.findByText('접수 당시 명세와 실행 환경이 달라 모델 호출 전에 차단했습니다.')).toBeTruthy()
  expect(screen.getByText('f'.repeat(64))).toBeTruthy()
  expect(screen.getByText('아직 확인되지 않음')).toBeTruthy()
})

it('명세가 없던 탭 보관 기록을 현재 명세로 소급 채우지 않는다', () => {
  const { execution_profile: _profile, ...legacy } = pendingRequest()
  sessionStorage.setItem('govbiz.ops.pending.v1.core%3A99', JSON.stringify(legacy))
  expect(readPendingEvaluation('core:99')?.execution_profile).toBeNull()
})

const ragDataset = {
  id: 'rag-synthetic-multichunk-v1', label: '전체 RAG · 합성 다중 청크 캡처 재계산',
  evaluation_scope: 'source-chunks-retrieval-answer', fixture: 'rag-fixture.json',
  live_config: null, execution_profiles: { replay: 'f'.repeat(64), live: null }, baseline: null,
  case_ids: ['R01', 'R02', 'R03'], captures: [{ id: 'rag-synthetic-capture-v1', label: '합성 RAG 캡처' }],
}
const ragReport = {
  scope: 'source-chunks-retrieval-answer', measurementKind: 'synthetic-contract-check',
  baselineEligible: false, liveExecutionPerformed: false, completed: false, caseCount: 3,
  fixtureSha256: 'a'.repeat(64), captureSha256: 'b'.repeat(64),
  execution: { model: null, embeddingModel: null, promptSha256: null },
  coverage: { retrievalCaseCount: 2, answerCaseCount: 2, failedCaseCount: 1, traceCaseCount: 0 },
  metrics: {
    retrievalRecallAtK: { value: 0, measuredCaseCount: 1, eligibleCaseCount: 2 },
    answerCitationRecall: { value: 0, measuredCaseCount: 1, eligibleCaseCount: 2 },
    answerStatusAccuracy: { value: 1, measuredCaseCount: 2, eligibleCaseCount: 3 },
  },
  cases: [
    { caseId: 'R01', traceId: null, retrievalRecallAtK: null, answerCitationRecall: null, answerStatusMatches: null, failure: { stage: 'search', code: 'timeout' }, retrievedChunkIds: null, citedChunkIds: null },
    { caseId: 'R02', traceId: null, retrievalRecallAtK: 0, answerCitationRecall: 0, answerStatusMatches: true, failure: null, retrievedChunkIds: ['chunk-2'], citedChunkIds: [] },
    { caseId: 'R03', traceId: null, retrievalRecallAtK: null, answerCitationRecall: null, answerStatusMatches: true, failure: null, retrievedChunkIds: ['chunk-3'], citedChunkIds: [] },
  ],
}
const ragRun = {
  ...completed, dataset_id: ragDataset.id, dataset_label: ragDataset.label,
  evaluation_scope: ragDataset.evaluation_scope,
  candidate_capture_id: ragDataset.captures[0].id, reference_capture_id: ragDataset.captures[0].id,
  comparison: { schema_version: 3, scope: ragDataset.evaluation_scope, retrieval_evaluated: true,
    baseline_eligible: false, comparison: 'self-replay', case_ids: ragDataset.case_ids,
    current: ragReport, reference: ragReport },
  summary: { caseCount: 3, semanticFaithfulness: null },
}

describe('전체 RAG 저장 캡처 재평가', () => {
  it('자료 변경 시 무료 재평가로 전환하고 live 명세 없이 접수한다', async () => {
    const original = fetchMock.getMockImplementation()!
    fetchMock.mockImplementation(async (path, options) => {
      if (path === '/api/v1/ops/evaluation-catalog') return json({ datasets: [dataset, ragDataset] })
      if (path === '/api/v1/ops/evaluations' && options?.method === 'POST') return json(ragRun, 202)
      if (path === `/api/v1/ops/evaluations/${id}`) return json(ragRun)
      return original(path, options)
    })
    open('/ops/evaluations/new')
    await evaluationStep(2)
    fireEvent.click(await screen.findByRole('radio', { name: '새 응답 생성' }))
    await evaluationStep(1)
    fireEvent.change(screen.getByLabelText('평가 자료'), { target: { value: ragDataset.id } })
    await evaluationStep(2)
    expect(screen.getByRole('radio', { name: '기존 답변 다시 확인' })).toHaveProperty('checked', true)
    await evaluationStep(2)
    expect(screen.getByRole('radio', { name: '새 응답 생성' })).toHaveProperty('disabled', true)
    await evaluationStep(3)
    fireEvent.click(screen.getByRole('button', { name: '평가 실행' }))
    await screen.findByRole('heading', { name: '검색과 답변 결과' })
    expect(screen.getAllByText('필요한 공고 내용을 찾은 비율').length).toBeGreaterThan(0)
    expect(screen.getByText(/괄호는 측정한 질문 수 \/ 측정 대상 수입니다/)).toBeTruthy()
    const post = fetchMock.mock.calls.find(([path, options]) => path === '/api/v1/ops/evaluations' && options?.method === 'POST')!
    const body = JSON.parse(post[1]!.body as string)
    expect(body).toMatchObject({ dataset_id: ragDataset.id, execution_mode: 'replay', live_config: {}, confirm_paid_run: false, execution_profile: ragDataset.execution_profiles.replay })
  })

  it('원본 실패·분모·합성 출처와 기준 지정 조건을 표시하고 검토는 명시적으로 연다', async () => {
    const original = fetchMock.getMockImplementation()!
    fetchMock.mockImplementation(async (path, options) => path === `/api/v1/ops/evaluations/${id}` ? json(ragRun) : original(path, options))
    open(`/ops/evaluations/${id}`)
    await screen.findByRole('heading', { name: '검색과 답변 결과' })
    expect(screen.getByText('연습용 자료로 확인한 결과입니다. 실제 모델의 성능은 알 수 없습니다.')).toBeTruthy()
    expect(screen.getByText(/실패 1건/)).toBeTruthy()
    expect(screen.getByText('내용 찾기 중 문제가 생겼어요')).toBeTruthy()
    expect(screen.getAllByText('0% (1 / 2)').length).toBeGreaterThan(0)
    expect(screen.getByText(/다음 평가의 기준으로 쓰려면 실제 모델 기록과 사람의 검토가 필요해요/)).toBeTruthy()
    expect(screen.getByRole('button', { name: '검토 자료 보기' })).toBeTruthy()
    expect(fetchMock.mock.calls.some(([path]) => path.endsWith('/rag-material') || path.endsWith('/rag-reviews'))).toBe(false)
    expect(fetchMock.mock.calls.some(([path]) => path.endsWith('/review'))).toBe(false)
    expect(screen.queryByRole('button', { name: /기준으로 지정/ })).toBeNull()
  })
})

const ragLiveConfig = { ...liveConfig, max_model_calls: 9, max_input_tokens: 32768,
  embedding_model: 'text-embedding-3-small', embedding_dimensions: 1536, source_mode: 'fixed-source-and-chunks',
  max_total_input_tokens: 98999, max_total_output_tokens: 6000 }
const ragLiveDataset = { ...ragDataset, live_config: ragLiveConfig, execution_profiles: executionProfiles }

it('벡터 재사용·생성·공유 계획을 표시하고 승인한 해시를 그대로 접수한다', async () => {
  const config = { ...ragLiveConfig, document_vectors: {
    R01: { key: 'a'.repeat(64), sha256: 'b'.repeat(64), source_case_id: 'R01' },
    R02: { key: 'c'.repeat(64), sha256: null, source_case_id: 'R02' },
    R03: { key: 'c'.repeat(64), sha256: null, source_case_id: 'R02' },
  } }
  const original = fetchMock.getMockImplementation()!
  fetchMock.mockImplementation(async (path, options) => {
    if (path === '/api/v1/ops/session') return json({ ...session(), rag_live_enabled: true })
    if (path === '/api/v1/ops/evaluation-catalog') return json({ datasets: [{ ...ragLiveDataset, live_config: config }] })
    return original(path, options)
  })
  open()
  await evaluationStep(2)
  fireEvent.click(await screen.findByRole('radio', { name: '새 응답 생성' }))
  expect(screen.getByText('저장 벡터 재사용 1사례 · 새 임베딩 1묶음 · 실행 내 공유 1사례')).toBeTruthy()
  expect(screen.getByText('R01: 저장 벡터 재사용')).toBeTruthy()
  expect(screen.getByText('R02: 새 임베딩')).toBeTruthy()
  expect(screen.getByText('R03: 이번 실행의 R02 벡터 재사용')).toBeTruthy()
  await evaluationStep(3)
  fireEvent.click(screen.getByLabelText('위 자료의 OpenAI 전송과 최대 호출 예산을 확인했습니다.'))
  await evaluationStep(3)
  fireEvent.click(screen.getByRole('button', { name: '새 응답 생성 및 평가' }))
  await waitFor(() => expect(fetchMock.mock.calls.some(([path, options]) => path === '/api/v1/ops/evaluations' && options?.method === 'POST')).toBe(true))
  const post = fetchMock.mock.calls.find(([path, options]) => path === '/api/v1/ops/evaluations' && options?.method === 'POST')!
  expect(JSON.parse(String(post[1]?.body)).live_config.document_vectors).toEqual(config.document_vectors)
})

it.each([false, true])('RAG 별도 활성화(%s)와 전송·예산 확인이 있어야 새 실행을 접수한다', async (enabled) => {
  const original = fetchMock.getMockImplementation()!
  fetchMock.mockImplementation(async (path, options) => {
    if (path === '/api/v1/ops/session') return json({ ...session(), rag_live_enabled: enabled })
    if (path === '/api/v1/ops/evaluation-catalog') return json({ datasets: [ragLiveDataset] })
    return original(path, options)
  })
  open()
  await evaluationStep(2)
  fireEvent.click(await screen.findByRole('radio', { name: '새 응답 생성' }))
  expect(screen.getAllByText(/Core 원문 재수집·재청킹 및 운영 색인 성능은 측정하지 않습니다/).length).toBeGreaterThan(0)
  if (enabled) {
    await evaluationStep(3)
    expect(screen.getByText(/전체 입력 예약 98,999토큰 · 전체 출력 예약 6,000토큰/)).toBeTruthy()
    const button = screen.getByRole('button', { name: '새 응답 생성 및 평가' })
    const confirmation = screen.getByLabelText('위 자료의 OpenAI 전송과 최대 호출 예산을 확인했습니다.')
    expect(button).toHaveProperty('disabled', true)
    expect(confirmation).toHaveProperty('disabled', false)
    fireEvent.click(confirmation)
    expect(button).toHaveProperty('disabled', false)
    fireEvent.click(button)
    await waitFor(() => expect(fetchMock.mock.calls.filter(([path, options]) => path === '/api/v1/ops/evaluations' && options?.method === 'POST')).toHaveLength(1))
    const body = JSON.parse(String(fetchMock.mock.calls.find(([path, options]) => path === '/api/v1/ops/evaluations' && options?.method === 'POST')![1]?.body))
    expect(body).toMatchObject({ execution_mode: 'live', candidate_capture_id: 'new-model-response',
      dataset_id: ragDataset.id, live_config: ragLiveConfig, confirm_paid_run: true, execution_profile: executionProfiles.live })
  } else {
    expect(screen.getByRole('button', { name: '다음: 비교하고 실행' })).toHaveProperty('disabled', true)
    expect(screen.getByText(/새 응답 생성이 비활성화되어 있습니다/)).toBeTruthy()
    expect(fetchMock.mock.calls.some(([path, options]) => path === '/api/v1/ops/evaluations' && options?.method === 'POST')).toBe(false)
  }
})

it('RAG 새 실행을 무료 재계산으로 표시하지 않는다', async () => {
  const original = fetchMock.getMockImplementation()!
  const run = { ...ragRun, execution_mode: 'live', live_config: ragLiveConfig, model_api_calls: 9,
    comparison: { ...ragRun.comparison, current: { ...ragReport, measurementKind: 'recorded-live-evaluation', liveExecutionPerformed: true } } }
  fetchMock.mockImplementation(async (path, options) => path === `/api/v1/ops/evaluations/${id}` ? json(run) : original(path, options))
  open(`/ops/evaluations/${id}`)
  expect(await screen.findByText('새로 만든 답변을 확인한 결과입니다.')).toBeTruthy()
  expect(screen.queryByText(/이번 재계산의 모델 API 호출은 0회/)).toBeNull()
})


it.each([false, true])('실제 공고는 출처와 과거 모델·참조 보완(%s)을 표시하고 미검토 승격을 막는다', async (revised) => {
  const original = fetchMock.getMockImplementation()!
  const state: EvaluationReview = { ...reviewDefaults, can_promote: false, quality: qualityState,
    material_error: '', is_baseline: false, baseline_version: 0, baseline_history: [], reviews: [],
    material: { ...reviewMaterial, data_type: 'official-html-snapshot', candidate_origin: 'historical-answer-projection',
      recorded_model: 'gpt-5.6-luna', recorded_at: '2026-09-06T16:10:50Z',
      reference_revision: revised ? {
        previous_dataset_id: 'official-answer-20260907-v2', previous_fixture_sha256: 'c'.repeat(64),
        changed_case_ids: ['H01'], reason: '중소·중견 제조기업 범위 보완 · 사람 검토 필요',
        source_quote: '☞ 중소ㆍ중견 제조기업의 자발적인 스마트공장 구축 및 고도화',
      } : null,
      cases: [{ ...reviewMaterial.cases[0], source: {
        url: 'https://www.bizinfo.go.kr/sii/siia/selectSIIA200Detail.do?pblancId=PBLN_000000000116004',
        collected_at: '2026-09-06T15:13:00Z', html_sha256: 'a'.repeat(64), content_sha256: 'b'.repeat(64),
        scope: 'frozen-title-and-body-html-no-attachments',
      } }],
    },
  }
  fetchMock.mockImplementation(async (path, options) => path.endsWith('/review') ? json(state) : original(path, options))
  open(`/ops/evaluations/${id}`)
  await screen.findByRole('navigation', { name: '답변 검토 영역' }, { timeout: 5000 })
  selectFixedReviewArea('답변 확인')
  const sourceSummary = screen.getByText('자료 출처와 변경 내용')
  expect(sourceSummary.closest('details')!.open).toBe(false)
  fireEvent.click(sourceSummary)
  expect(sourceSummary.closest('details')!.open).toBe(true)
  expect(screen.getByText(/과거 저장 답변 · gpt-5.6-luna/)).toBeTruthy()
  expect(screen.getByText(/이번에 생성한 답변이 아니며 현재 모델과 공고 검색 성능을 새로 측정하지 않았어요/)).toBeTruthy()
  expect(screen.getByText(/첨부파일과 이후 변경 내용은 포함되지 않았어요/)).toBeTruthy()
  expect(screen.getByRole('link', { name: '공고 출처 보기' }).getAttribute('href')).toBe(state.material!.cases[0].source!.url)
  if (revised) {
    const revision = screen.getByRole('region', { name: '참조 조건 변경 내용' })
    expect(revision.textContent).toContain('H01')
    expect(revision.textContent).toContain('중소·중견 제조기업 범위 보완')
    expect(revision.textContent).toContain('이전 자료의 승인과 비교 기준은 적용되지 않으므로')
    const evidence = within(revision).getByText('변경 근거 자세히 보기')
    expect(evidence.closest('details')!.open).toBe(false)
    fireEvent.click(evidence)
    expect(evidence.closest('details')!.open).toBe(true)
    expect(within(revision).getByText(/이전 자료: official-answer-20260907-v2/)).toBeTruthy()
    expect(within(revision).getByText(/☞ 중소ㆍ중견 제조기업의 자발적인/)).toBeTruthy()
  } else expect(screen.queryByRole('region', { name: '참조 조건 변경 내용' })).toBeNull()
  selectFixedReviewArea('전체·비교')
  expect(screen.getByRole('button', { name: '검토 승인 저장' })).toHaveProperty('disabled', true)
  expect(screen.getByRole('button', { name: '비교 기준으로 지정' })).toHaveProperty('disabled', true)
  expect(fetchMock.mock.calls.some(([, options]) => options?.method === 'POST')).toBe(false)
})

it('작업 메뉴마다 해당 기능만 표시하고 다른 기능의 조회를 시작하지 않는다', async () => {
  open('/ops/evaluations')
  await screen.findByRole('region', { name: '평가 실행 이력' })
  const menu = within(screen.getByRole('navigation', { name: 'LLMOps 작업 메뉴' }))
  expect(menu.getByRole('link', { name: '평가 이력' }).getAttribute('aria-current')).toBe('page')
  expect(screen.queryByRole('region', { name: '평가 실행' })).toBeNull()
  expect(screen.queryByRole('region', { name: '평가 예산' })).toBeNull()
  expect(screen.queryByRole('region', { name: '정기 평가 계획' })).toBeNull()
  expect(fetchMock.mock.calls.some(([path]) => path.includes('/budget/') || path.includes('/schedules?'))).toBe(false)
  fireEvent.click(menu.getByRole('link', { name: '새 평가' }))
  await screen.findByRole('region', { name: '평가 실행' })
  expect(screen.queryByRole('region', { name: '평가 실행 이력' })).toBeNull()
  expect(document.activeElement?.id).toBe('ops-main')
  fireEvent.click(menu.getByRole('link', { name: '예산 관리' }))
  await screen.findByRole('region', { name: '평가 예산' })
  expect(screen.queryByRole('region', { name: '평가 실행' })).toBeNull()
  fireEvent.click(menu.getByRole('link', { name: '정기 실행' }))
  await screen.findByText('등록된 정기 계획이 없습니다.')
  expect(screen.queryByRole('region', { name: '평가 예산' })).toBeNull()
  expect(menu.getByRole('link', { name: '정기 실행' }).getAttribute('aria-current')).toBe('page')
  expect(fetchMock.mock.calls.some(([, options]) => options?.method === 'POST')).toBe(false)
})

it.each([
  ['/ops/dashboard', '성능 대시보드'], ['/ops', '성능 대시보드'],
  ['/ops/login', '성능 대시보드'], ['/ops/unknown', '성능 대시보드'],
  ['/ops/evaluations#evaluation-budget', '예산 관리'],
  ['/ops/evaluations#evaluation-schedules', '정기 실행'],
  ['/ops/evaluations#new-evaluation', '새 평가'],
  ['/ops/budget', '예산 관리'], ['/ops/schedules', '정기 실행'],
])('기존 바로가기와 직접 주소 %s는 %s 화면을 연다', async (path, heading) => {
  open(path)
  expect(await screen.findByRole('heading', { level: 1, name: heading })).toBeTruthy()
  expect(screen.queryByRole('region', { name: '평가 실행 이력' })).toBeNull()
  if (heading === '성능 대시보드') {
    expect(screen.getByRole('link', { name: '성능 대시보드' }).getAttribute('aria-current')).toBe('page')
    expect(fetchMock.mock.calls.some(([path]) => path.startsWith('/api/v1/ops/evaluations'))).toBe(false)
  }
  expect(fetchMock.mock.calls.some(([, options]) => options?.method === 'POST')).toBe(false)
})

it('운영 로고는 평가 이력에서 성능 대시보드로 돌아간다', async () => {
  open('/ops/evaluations')
  await screen.findByRole('heading', { level: 1, name: '평가 이력' })
  fireEvent.click(screen.getByRole('link', { name: 'GovBiz LLMOps' }))
  expect(await screen.findByRole('heading', { level: 1, name: '성능 대시보드' })).toBeTruthy()
  expect(screen.queryByRole('region', { name: '평가 실행 이력' })).toBeNull()
})

it('예산 화면을 다녀와도 평가 선택은 유지하고 유료 전송 확인은 해제한다', async () => {
  open()
  await evaluationStep(1)
  fireEvent.change(await screen.findByLabelText('평가 자료'), { target: { value: comparisonDataset.id } })
  await evaluationStep(2)
  fireEvent.click(screen.getByRole('radio', { name: '새 응답 생성' }))
  await evaluationStep(3)
  fireEvent.click(screen.getByLabelText('위 자료의 OpenAI 전송과 최대 호출 예산을 확인했습니다.'))
  fireEvent.click(screen.getByRole('link', { name: '예산 관리' }))
  await screen.findByRole('region', { name: '평가 예산' })
  fireEvent.click(screen.getByRole('link', { name: '새 평가' }))
  await evaluationStep(1)
  expect(await screen.findByLabelText('평가 자료')).toHaveProperty('value', comparisonDataset.id)
  await evaluationStep(2)
  expect(screen.getByRole('radio', { name: '새 응답 생성' })).toHaveProperty('checked', true)
  await evaluationStep(3)
  expect(screen.getByLabelText('위 자료의 OpenAI 전송과 최대 호출 예산을 확인했습니다.')).toHaveProperty('checked', false)
  await evaluationStep(3)
  expect(screen.getByRole('button', { name: '새 응답 생성 및 평가' })).toHaveProperty('disabled', true)
  expect(fetchMock.mock.calls.some(([, options]) => options?.method === 'POST')).toBe(false)
})

it.each(['/ops/dashboard', '/ops', '/ops/login', '/ops/budget', '/ops/schedules', '/ops/evaluations/new'])('로그인 후 요청한 작업 화면 %s로 복귀한다', async (path) => {
  authenticated = false
  open(path)
  fireEvent.change(await screen.findByLabelText('이메일'), { target: { value: 'operator@example.com' } })
  fireEvent.change(screen.getByLabelText('비밀번호'), { target: { value: 'example-password' } })
  fireEvent.click(screen.getByRole('button', { name: '이메일로 로그인' }))
  const name = ['/ops/dashboard', '/ops', '/ops/login'].includes(path) ? '성능 대시보드' : path.endsWith('budget') ? '예산 관리' : path.endsWith('schedules') ? '정기 실행' : '새 평가'
  expect(await screen.findByRole('heading', { level: 1, name })).toBeTruthy()
})

it('사례를 한 건씩 보여주며 사례 전환 후에도 저장 전 판단과 사유를 보존한다', async () => {
  const original = fetchMock.getMockImplementation()!
  const material = { ...reviewMaterial, cases: [reviewMaterial.cases[0], { ...reviewMaterial.cases[0], case_id: 'E02', question: '두 번째 질문' }] }
  fetchMock.mockImplementation((path, options) => path.endsWith('/review')
    ? Promise.resolve(json({ ...reviewDefaults, quality: qualityState, material, material_error: '', is_baseline: false, baseline_version: 0, baseline_history: [], reviews: [] }))
    : original(path, options))
  open(`/ops/evaluations/${id}`)
  await screen.findByRole('navigation', { name: '답변 검토 영역' })
  selectFixedReviewArea('답변 확인')
  fireEvent.change(await screen.findByLabelText('E01 판단'), { target: { value: 'DEFERRED' } })
  fireEvent.change(screen.getByLabelText(/^E01 (어떤 문제가 있나요|무엇을 더 확인해야 하나요)\?$/), { target: { value: '첨부 원문 확인 중' } })
  fireEvent.click(screen.getByRole('button', { name: '다음 질문' }))
  expect(screen.queryByLabelText('E01 판단')).toBeNull()
  expect(screen.getByLabelText('E02 판단')).toHaveProperty('value', '')
  fireEvent.click(screen.getByRole('button', { name: '이전 질문' }))
  expect(screen.getByLabelText('E01 판단')).toHaveProperty('value', 'DEFERRED')
  expect(screen.getByLabelText(/^E01 (어떤 문제가 있나요|무엇을 더 확인해야 하나요)\?$/)).toHaveProperty('value', '첨부 원문 확인 중')
  selectFixedReviewArea('전체·비교')
  expect(screen.getByRole('button', { name: '검토 승인 저장' })).toHaveProperty('disabled', true)
  expect(fetchMock.mock.calls.some(([, options]) => options?.method === 'POST')).toBe(false)
})

it.each([true, false])('저장 후 다음 사례는 저장 성공(%s)일 때만 이동하고 실패 시 초안을 보존한다', async (success) => {
  const original = fetchMock.getMockImplementation()!
  const material = { ...reviewMaterial, cases: [reviewMaterial.cases[0], { ...reviewMaterial.cases[0], case_id: 'E02', question: '두 번째 질문' }] }
  const state = { ...reviewDefaults, quality: qualityState, material, material_error: '', is_baseline: false, baseline_version: 0, baseline_history: [], reviews: [] }
  let resolveSave!: (response: Response) => void
  const response = new Promise<Response>((resolve) => { resolveSave = resolve })
  fetchMock.mockImplementation((path, options) => {
    if (path.endsWith('/case-review') && options?.method === 'POST') return response
    if (path.endsWith('/review')) return Promise.resolve(json(state))
    return original(path, options)
  })
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() })
  try {
    open(`/ops/evaluations/${id}`)
    await screen.findByRole('navigation', { name: '답변 검토 영역' })
    selectFixedReviewArea('답변 확인')
    fireEvent.change(await screen.findByLabelText('E01 판단'), { target: { value: 'UNSUITABLE' } })
    fireEvent.change(screen.getByLabelText(/^E01 (어떤 문제가 있나요|무엇을 더 확인해야 하나요)\?$/), { target: { value: '지원 대상 누락' } })
    fireEvent.click(screen.getByRole('button', { name: '저장하고 다음 질문' }))
    await waitFor(() => expect(fetchMock.mock.calls.some(([, options]) => options?.method === 'POST')).toBe(true))
    expect(screen.getByLabelText('E01 판단')).toBeTruthy()
    await act(async () => {
      resolveSave(success ? json({ ...state, review_version: 1, case_reviews: [{ id: 1, version: 1, case_id: 'E01', decision: 'UNSUITABLE', comment: '지원 대상 누락', capture_sha256: material.capture_sha256, fixture_sha256: material.fixture_sha256, rubric_version: state.rubric.version, reviewed_by: 'operator@example.com', created_at: completed.created_at }] }) : json({ detail: '저장 실패' }, 503))
      await response
    })
    if (success) {
      await screen.findByLabelText('E02 판단')
      expect(document.activeElement?.id).toBe('case-review-E02')
      selectFixedReviewArea('전체·비교')
      expect(screen.getByRole('button', { name: '검토 승인 저장' })).toHaveProperty('disabled', true)
    } else {
      expect(screen.getByLabelText(/^E01 (어떤 문제가 있나요|무엇을 더 확인해야 하나요)\?$/)).toHaveProperty('value', '지원 대상 누락')
      expect(screen.queryByLabelText('E02 판단')).toBeNull()
    }
    expect(fetchMock.mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(1)
  } finally { delete (HTMLElement.prototype as { scrollIntoView?: unknown }).scrollIntoView }
})

it('접수 중 메뉴를 옮겨도 늦은 응답이 현재 화면을 바꾸지 않고 재진입 시 같은 요청만 조회한다', async () => {
  let resolve!: (response: Response) => void
  const response = new Promise<Response>((done) => { resolve = done })
  const original = fetchMock.getMockImplementation()!
  fetchMock.mockImplementation((path, options) => path === '/api/v1/ops/evaluations' && options?.method === 'POST' ? response : original(path, options))
  open()
  await evaluationStep(3)
  fireEvent.click(await screen.findByRole('button', { name: '평가 실행' }))
  await waitFor(() => expect(fetchMock.mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(1))
  fireEvent.click(screen.getByRole('link', { name: '예산 관리' }))
  await screen.findByRole('region', { name: '평가 예산' })
  await act(async () => { resolve(json(completed, 202)); await response })
  expect(screen.getByRole('heading', { level: 1, name: '예산 관리' })).toBeTruthy()
  expect(readPendingEvaluation('core:99')?.request_id).toBe(id)
  fireEvent.click(screen.getByRole('link', { name: '새 평가' }))
  await screen.findByRole('heading', { name: '평가 실행 상세' })
  expect(fetchMock.mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(1)
  expect(readPendingEvaluation('core:99')).toBeNull()
})

it('이력 화면을 떠나면 목록 자동 조회를 중단한다', async () => {
  open('/ops/evaluations')
  await screen.findByText(completed.dataset_label)
  fireEvent.click(within(screen.getByRole('navigation', { name: 'LLMOps 작업 메뉴' })).getByRole('link', { name: '새 평가' }))
  await screen.findByLabelText('평가 자료')
  const reads = () => fetchMock.mock.calls.filter(([path]) => path.includes('/evaluations?page='))
  const count = reads().length
  expect(reads()[0][1]?.signal?.aborted).toBe(true)
  vi.useFakeTimers()
  await act(async () => { await vi.advanceTimersByTimeAsync(15_000) })
  expect(reads()).toHaveLength(count)
})


it.each(['admin-entered-answer', 'recorded-answer'] as const)('관리자 등록 자료의 %s 출처를 모델 실행 기록과 구분한다', async (origin) => {
  const original = fetchMock.getMockImplementation()!
  const state: EvaluationReview = { ...reviewDefaults, quality: qualityState, material: { ...reviewMaterial,
    data_type: 'admin-provided', reference_source: 'admin-authored', candidate_origin: origin,
    cases: reviewMaterial.cases.map((item) => ({ ...item, source_url: null })),
  }, material_error: '', is_baseline: false, baseline_version: 0, baseline_history: [], reviews: [] }
  fetchMock.mockImplementation((path, options) => path.endsWith('/review') ? Promise.resolve(json(state)) : original(path, options))
  open(`/ops/evaluations/${id}`)
  await screen.findByText('관리자가 작성한 평가 조건')
  expect(screen.queryByText('AI 작성 참조 조건')).toBeNull()
  selectFixedReviewArea('답변 확인')
  fireEvent.click(screen.getByText('자료 출처와 변경 내용'))
  expect(screen.getByText(/관리자가 등록한 공고 내용과 기준이에요\. 실제 공고와 첨부파일 포함 여부를 확인해 주세요/)).toBeTruthy()
  if (origin === 'admin-entered-answer') expect(screen.getByText(/관리자가 직접 입력한 답변이에요\. 실제 모델 호출 기록이 아니며/)).toBeTruthy()
  else expect(screen.queryByText(/관리자가 직접 입력한 답변이에요/)).toBeNull()
  expect(fetchMock.mock.calls.some(([, options]) => options?.method === 'POST')).toBe(false)
})
