// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { MonitoringOverview } from './MonitoringOverview'
import { MonitoringDemoProvider } from './MonitoringDemoContext'

const fixtures = vi.hoisted(() => ({ cost: vi.fn() }))
vi.mock('../../../app/appContainer', () => ({ appContainer: { resolve: () => ({ execute: fixtures.cost }) } }))
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })

beforeEach(() => {
  fixtures.cost.mockReset().mockImplementation(async (from: string, to: string) => ({
    from, to, totals: { calls: 5, unpricedCalls: 0, incompleteUsageCalls: 0, estimatedUsd: '0.012346' },
    krwPerUsd: null, byModel: [],
  }))
  vi.stubGlobal('fetch', vi.fn(async (input: string) => {
    const url = new URL(input, 'http://localhost')
    const from = url.searchParams.get('from'); const to = url.searchParams.get('to')
    if (url.pathname.endsWith('/jobs')) return json({ from, to, scope: 'stored-ai-jobs', features: [
      { feature: 'APPLICATION_DOCUMENT', total: 12, queued: 1, running: 1, succeeded: 9, failed: 1, interrupted: 0, unknown: 0 },
    ] })
    if (url.pathname.endsWith('/daily')) return json({ from, to, scope: 'core-http-requests', days: [
      { date: to, features: [{ feature: 'AI_SEARCH', total: 20, success: 18, accepted: 0, clientErrors: 0, serverErrors: 2, other: 0, latencySamples: 20 }] },
    ] })
    if (url.pathname.endsWith('/ai-request-metrics')) return json({ from, to, scope: 'core-http-requests', features: [
      { feature: 'AI_SEARCH', total: 20, success: 18, accepted: 0, clientErrors: 0, serverErrors: 2, other: 0, latencySamples: 20 },
    ] })
    if (url.pathname.endsWith('/model-trace-metrics')) return json({
      from_time: url.searchParams.get('from_time'), to_time: url.searchParams.get('to_time'),
      environment: url.searchParams.get('environment'), scope: 'observed-model-generations',
      results: [{ feature: 'assistant.model', model: 'example', observed: 4, completed: 3, errors: 1, warnings: 0, timeouts: 0, timeout_unknown: 0, in_progress: 1 }],
    })
    return json({}, 404)
  }))
})
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals() })
const mount = () => render(<MemoryRouter><MonitoringOverview onExpired={vi.fn()} /></MemoryRouter>)

it('첫 화면에서 실제 집계·기간과 상세 페이지 진입을 보여준다', async () => {
  mount()
  const request = await screen.findByRole('link', { name: /서버 오류 응답/ })
  await waitFor(() => expect(request.textContent).toContain('2건'))
  expect(request.textContent).toContain('20건 중 10%')
  expect(request.getAttribute('href')).toBe('/ops/usage/requests')
  expect((await screen.findByRole('link', { name: /수집된 모델 실행 오류/ })).textContent).toContain('1건')
  expect(screen.getByRole('link', { name: /수집된 모델 실행 오류/ }).textContent).toContain('최근 24시간')
  expect(screen.getByRole('link', { name: /완료된 작업/ }).textContent).toContain('9건')
  expect(screen.getByRole('link', { name: /앱 기록 추정 비용/ }).textContent).toContain('$0.012346')
  expect(screen.getByRole('link', { name: /앱 기록 추정 비용/ }).getAttribute('href')).toBe('/ops/usage/costs')
  const trend = screen.getByRole('region', { name: '날짜별 요청 추세' })
  expect(await within(trend).findByText('20건')).toBeTruthy()
  expect(within(trend).getAllByText('기록 없음').length).toBe(6)
  expect(screen.queryByText(/모델 실행 오류가 반드시 제공자 장애를 뜻하지는 않습니다/)).toBeNull()
  const urls = vi.mocked(globalThis.fetch).mock.calls.map(([input]) => new URL(String(input), 'http://localhost'))
  const jobQuery = urls.find((url) => url.pathname.endsWith('/jobs'))!
  expect(jobQuery.searchParams.get('from')).toBe(jobQuery.searchParams.get('to'))
  expect(jobQuery.searchParams.get('to')).toBe(new Date().toISOString().slice(0, 10))
  const modelQuery = urls.find((url) => url.pathname.endsWith('/model-trace-metrics'))!
  expect(Date.parse(modelQuery.searchParams.get('to_time')!) - Date.parse(modelQuery.searchParams.get('from_time')!)).toBe(86_400_000)
})

it('지표 설명은 도움말을 눌렀을 때만 보이고 수치와 조회 상태는 유지된다', async () => {
  mount()
  const request = await screen.findByRole('link', { name: /서버 오류 응답/ })
  await waitFor(() => expect(request.textContent).toContain('2건'))
  const calls = vi.mocked(globalThis.fetch).mock.calls.length
  const help = screen.getByRole('button', { name: '주요 현황 도움말' })
  expect(help.getAttribute('aria-expanded')).toBe('false')
  expect(screen.queryByText(/모델 실행 오류가 반드시 제공자 장애를 뜻하지는 않습니다/)).toBeNull()
  help.focus()
  expect(document.activeElement).toBe(help)
  fireEvent.click(help)
  expect(help.getAttribute('aria-expanded')).toBe('true')
  expect(screen.getByText(/모델 실행 오류가 반드시 제공자 장애를 뜻하지는 않습니다/)).toBeTruthy()
  expect(request.textContent).toContain('2건')
  expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledTimes(calls)
  fireEvent.click(help)
  expect(help.getAttribute('aria-expanded')).toBe('false')
  expect(screen.queryByText(/모델 실행 오류가 반드시 제공자 장애를 뜻하지는 않습니다/)).toBeNull()
})

it('개별 조회 실패는 다른 수치를 가리지 않고 재조회할 수 있다', async () => {
  const original = globalThis.fetch
  let failed = true
  vi.stubGlobal('fetch', vi.fn((input: string, init?: RequestInit) => failed && input.includes('/ai-request-metrics?')
    ? Promise.resolve(json({}, 503)) : original(input, init)))
  mount()
  await waitFor(() => expect(screen.getByRole('link', { name: /서버 오류 응답/ }).textContent).toContain('조회 실패'))
  expect((await screen.findByRole('link', { name: /완료된 작업/ })).textContent).toContain('9건')
  failed = false
  fireEvent.click(screen.getByRole('button', { name: '현황 새로고침' }))
  await waitFor(() => expect(screen.getByRole('link', { name: /서버 오류 응답/ }).textContent).toContain('2건'))
})

it('예시 데이터는 실제 네트워크를 사용하지 않고 상세 주소에도 유지한다', async () => {
  const fetch = vi.fn()
  vi.stubGlobal('fetch', fetch)
  render(<MemoryRouter><MonitoringDemoProvider enabled><MonitoringOverview onExpired={vi.fn()} /></MonitoringDemoProvider></MemoryRouter>)
  expect(await screen.findByText(/예시 데이터 · 실제 운영 현황이 아닙니다/)).toBeTruthy()
  await waitFor(() => expect(screen.getByRole('link', { name: /서버 오류 응답/ }).textContent).toContain('14건'))
  expect(screen.getByRole('link', { name: /서버 오류 응답/ }).getAttribute('href')).toBe('/ops/usage/requests?example=1')
  expect(screen.getByRole('link', { name: /앱 기록 추정 비용/ }).getAttribute('href')).toBe('/ops/usage/costs?example=1')
  expect(screen.queryByRole('link', { name: '개별 실행 조사' })).toBeNull()
  expect(fetch).not.toHaveBeenCalled()
})

it('미확정 비용과 로컬 테스트 기록이 정상 금액처럼 보이지 않는다', async () => {
  fixtures.cost.mockImplementation(async (from: string, to: string) => ({
    from, to, totals: { calls: 1, unpricedCalls: 1, incompleteUsageCalls: 0, estimatedUsd: '0.000000' },
    krwPerUsd: null, byModel: [{ key: 'demo-local-test' }],
  }))
  mount()
  const cost = await screen.findByRole('link', { name: /앱 기록 추정 비용/ })
  await waitFor(() => expect(cost.textContent).toContain('미확정'))
  expect(cost.textContent).toContain('테스트 기록 포함')
  expect(cost.textContent).not.toContain('$0.000000')
})

it('오늘의 수치를 먼저 보여주고 날짜별 추세는 최신 날짜부터 표시한다', async () => {
  mount()
  const today = await screen.findByRole('region', { name: '오늘의 요청 현황' })
  await waitFor(() => expect(today.textContent).toContain('20건'))
  expect(today.textContent).toContain('2건')
  expect(today.textContent).toContain('UTC')
  const trend = screen.getByRole('region', { name: '날짜별 요청 추세' })
  const dates = Array.from(trend.querySelectorAll('time'), (element) => element.dateTime)
  expect(dates).toHaveLength(7)
  expect(dates).toEqual([...dates].sort().reverse())
  expect(dates[0]).toBe(new Date().toISOString().slice(0, 10))
})

it('새로고침 중 조회가 실패하면 마지막 성공 수치와 실패 상태를 함께 표시하고 복구한다', async () => {
  const original = globalThis.fetch
  let failed = false
  vi.stubGlobal('fetch', vi.fn((input: string, init?: RequestInit) => failed && input.includes('/ai-request-metrics?')
    ? Promise.resolve(json({}, 503)) : original(input, init)))
  mount()
  const request = await screen.findByRole('link', { name: /서버 오류 응답/ })
  await waitFor(() => expect(request.textContent).toContain('2건'))
  failed = true
  fireEvent.click(screen.getByRole('button', { name: '현황 새로고침' }))
  await waitFor(() => expect(request.textContent).toContain('갱신 실패 · 이전 조회'))
  expect(request.textContent).toContain('2건')
  expect(screen.getByRole('link', { name: /완료된 작업/ }).textContent).toContain('9건')
  failed = false
  fireEvent.click(screen.getByRole('button', { name: '현황 새로고침' }))
  await waitFor(() => expect(request.textContent).not.toContain('갱신 실패'))
  expect(request.textContent).toContain('2건')
})

it('60초마다 갱신하고 숨긴 탭에서는 멈춘 뒤 다시 보일 때 조회한다', async () => {
  vi.useFakeTimers()
  const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
  const fetch = vi.mocked(globalThis.fetch)
  await act(async () => { mount() })
  expect(fetch).toHaveBeenCalledTimes(4)
  expect(fixtures.cost).toHaveBeenCalledTimes(1)
  await act(async () => { await vi.advanceTimersByTimeAsync(60_000) })
  expect(fetch).toHaveBeenCalledTimes(8)
  expect(fixtures.cost).toHaveBeenCalledTimes(1)
  for (let i = 0; i < 4; i += 1) await act(async () => { await vi.advanceTimersByTimeAsync(60_000) })
  expect(fetch).toHaveBeenCalledTimes(24)
  expect(fixtures.cost).toHaveBeenCalledTimes(2)
  visibility.mockReturnValue('hidden')
  fireEvent(document, new Event('visibilitychange'))
  await act(async () => { await vi.advanceTimersByTimeAsync(60_000) })
  expect(fetch).toHaveBeenCalledTimes(24)
  visibility.mockReturnValue('visible')
  await act(async () => { fireEvent(document, new Event('visibilitychange')) })
  expect(fetch).toHaveBeenCalledTimes(28)
  expect(fixtures.cost).toHaveBeenCalledTimes(3)
})

it('오늘 집계가 없으면 요청이 0건이라고 단정하지 않는다', async () => {
  const original = globalThis.fetch
  vi.stubGlobal('fetch', vi.fn((input: string, init?: RequestInit) => {
    const url = new URL(input, 'http://localhost')
    return url.pathname.endsWith('/daily')
      ? Promise.resolve(json({ from: url.searchParams.get('from'), to: url.searchParams.get('to'), scope: 'core-http-requests', days: [] }))
      : original(input, init)
  }))
  mount()
  const today = await screen.findByRole('region', { name: '오늘의 요청 현황' })
  expect(await within(today).findByText('오늘 기록 없음')).toBeTruthy()
  expect(today.textContent).not.toContain('0건')
})

it('시간 초과 후 늦게 도착한 인증 오류는 기존 값이나 세션을 덮어쓰지 않는다', async () => {
  vi.useFakeTimers()
  const original = globalThis.fetch
  const onExpired = vi.fn()
  let resolveLate: ((response: Response) => void) | undefined
  let delayed = false
  vi.stubGlobal('fetch', vi.fn((input: string, init?: RequestInit) => delayed && input.includes('/ai-request-metrics?')
    ? new Promise<Response>((resolve) => { resolveLate = resolve }) : original(input, init)))
  await act(async () => { render(<MemoryRouter><MonitoringOverview onExpired={onExpired} /></MemoryRouter>) })
  const request = screen.getByRole('link', { name: /서버 오류 응답/ })
  expect(request.textContent).toContain('2건')
  delayed = true
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: '현황 새로고침' })) })
  await act(async () => { await vi.advanceTimersByTimeAsync(15_000) })
  expect(request.textContent).toContain('갱신 실패 · 이전 조회')
  expect(request.textContent).toContain('2건')
  await act(async () => { resolveLate?.(json({}, 401)) })
  expect(onExpired).not.toHaveBeenCalled()
  expect(request.textContent).toContain('2건')
})
