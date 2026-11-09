// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { MonitoringDemoProvider } from './MonitoringDemoContext'
import { ModelTraceMetricsPanel } from './ModelTraceMetricsPanel'

const row = { feature: 'evidence.model', model: 'example-model', observed: 5, completed: 4, errors: 2, warnings: 1, timeouts: 1, timeout_unknown: 1, in_progress: 1, latency_samples: 3, missing_latency: 1, p50_seconds: 1.25, p95_seconds: 2.8 }
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs() })

function setup(results: unknown[], status = 200) {
  const fetch = vi.fn(async (path: string) => {
    const query = new URL(path, 'https://govbiz.test').searchParams
    return new Response(JSON.stringify({ from_time: query.get('from_time'), to_time: query.get('to_time'), environment: query.get('environment'), scope: 'observed-model-generations', results }), { status })
  })
  vi.stubGlobal('fetch', fetch)
  return fetch
}

it('중복 지원 검토 모델 실행을 기능별 집계에 표시한다', async () => {
  setup([{ ...row, feature: 'combination.model' }])
  render(<ModelTraceMetricsPanel onExpired={vi.fn()} />)
  fireEvent.click(await screen.findByText('기능과 모델별 자세히 보기'))
  expect(await screen.findByText('중복 지원 검토')).toBeTruthy()
  expect(screen.getByText('example-model')).toBeTruthy()
})

it('수집된 모델 실행의 오류와 표본 시간만 기능·모델별로 보여준다', async () => {
  vi.stubEnv('DEV', true); vi.stubEnv('MODE', 'development')
  const fetch = setup([row])
  render(<ModelTraceMetricsPanel onExpired={vi.fn()} />)
  const panel = await screen.findByRole('region', { name: '수집된 모델 실행 현황' })
  const detail = await within(panel).findByText('기능과 모델별 자세히 보기')
  expect(detail.closest('details')?.open).toBe(false)
  fireEvent.click(detail)
  expect(await within(panel).findByText('공고 근거 답변')).toBeTruthy()
  expect(within(panel).getByText('example-model')).toBeTruthy()
  expect(within(panel).getByText('2건 · 1건')).toBeTruthy()
  expect(within(panel).getByText('1.25초')).toBeTruthy()
  expect(within(panel).getByText('95%가 끝난 시간 (p95)')).toBeTruthy()
  const summary = within(panel).getByLabelText('수집된 모델 실행 요약')
  expect(within(summary).getByText('5건')).toBeTruthy()
  expect(within(summary).getByText('4건')).toBeTruthy()
  expect(within(summary).getByText('2건')).toBeTruthy()
  expect(within(panel).getByText(/시간 초과 여부 미기록 1건/)).toBeTruthy()
  expect(within(panel).getByText(/전체 모델 호출의 실패율이 아닙니다/)).toBeTruthy()
  expect(within(panel).getByText(/응답 처리·형식 검사 실패도 포함될 수 있습니다/)).toBeTruthy()
  const help = within(panel).getByRole('button', { name: '모델 실행 현황 도움말' })
  expect(help.getAttribute('aria-expanded')).toBe('false')
  fireEvent.click(help)
  expect(help.getAttribute('aria-expanded')).toBe('true')
  expect(screen.getByText(/시간 초과는 오류에 포함됩니다/)).toBeTruthy()
  expect(new URL(fetch.mock.calls[0][0], 'https://govbiz.test').searchParams.get('environment')).toBe('development')
  fireEvent.click(within(panel).getByText('기간과 실행 환경 바꾸기'))
  fireEvent.change(within(panel).getByLabelText('모델 실행 환경'), { target: { value: 'all' } })
  fireEvent.change(within(panel).getByLabelText('모델 실행 기간'), { target: { value: '1' } })
  expect(within(panel).getByText(/조회 조건을 바꿨습니다/)).toBeTruthy()
  fireEvent.click(within(panel).getByRole('button', { name: '모델 실행 조회' }))
  const query = new URL(fetch.mock.calls.at(-1)![0], 'https://govbiz.test').searchParams
  expect(query.get('environment')).toBe('all')
  expect(Date.parse(query.get('to_time')!) - Date.parse(query.get('from_time')!)).toBe(86_400_000)
  expect(await within(panel).findByText(/조회 환경: 전체 환경/)).toBeTruthy()
  expect(within(panel).queryByText(/조회 조건을 바꿨습니다/)).toBeNull()
})

it('기능별 관측값만 합산하고 전체 p95를 만들어 내지 않는다', async () => {
  setup([row, { ...row, feature: 'assistant.model', model: 'another-model', observed: 3, completed: 2, errors: 1, warnings: 0, timeouts: 0, timeout_unknown: 1, in_progress: 1, latency_samples: 2, missing_latency: 0, p50_seconds: 0.5, p95_seconds: 4 }])
  render(<ModelTraceMetricsPanel onExpired={vi.fn()} />)
  const summary = await screen.findByLabelText('수집된 모델 실행 요약')
  expect(within(summary).getByText('8건')).toBeTruthy()
  expect(within(summary).getByText('6건')).toBeTruthy()
  expect(within(summary).getByText('3건')).toBeTruthy()
  expect(within(summary).queryByText(/p95/)).toBeNull()
  fireEvent.click(screen.getByText('기능과 모델별 자세히 보기'))
  expect(screen.getByText('4초')).toBeTruthy()
})

it('기록이 없어도 모델 호출이 없었다고 단정하지 않는다', async () => {
  setup([])
  render(<ModelTraceMetricsPanel onExpired={vi.fn()} />)
  expect(await screen.findByText('수집된 모델 실행이 없습니다.')).toBeTruthy()
  expect(screen.getByText(/실제 호출이 없었다는 뜻은 아닙니다/)).toBeTruthy()
})

it('잘못된 시간 초과 집계는 정상 수치로 표시하지 않는다', async () => {
  setup([{ ...row, timeouts: 2, timeout_unknown: 1 }])
  render(<ModelTraceMetricsPanel onExpired={vi.fn()} />)
  expect(await screen.findByRole('alert')).toBeTruthy()
  expect(screen.queryByText('example-model')).toBeNull()
})

it('예시 모드는 서버에 연결하지 않고 예시임을 표시한다', async () => {
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch)
  render(<MonitoringDemoProvider enabled><ModelTraceMetricsPanel onExpired={vi.fn()} /></MonitoringDemoProvider>)
  expect(await screen.findByText(/예시 데이터 · 실제 모델 실행 기록이 아닙니다/)).toBeTruthy()
  fireEvent.click(await screen.findByText('기능과 모델별 자세히 보기'))
  expect(await screen.findByText('공고 검색 순위')).toBeTruthy()
  expect(fetch).not.toHaveBeenCalled()
})
