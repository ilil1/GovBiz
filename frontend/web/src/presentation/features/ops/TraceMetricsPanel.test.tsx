// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TraceMetricsPanel } from './TraceMetricsPanel'

const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
const metrics = { from_time: '2026-11-01T00:00:00Z', to_time: '2026-11-08T00:00:00Z', scope: 'observed-root-traces', results: [{ name: 'search.total', observed: 5, completed: 4, in_progress: 1, errors: 1, warnings: 0, latency_samples: 3, missing_latency: 1, p50_seconds: 1.25, p95_seconds: 2.8 }] }
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('추적된 실행 집계', () => {
  it('집계 범위와 누락을 분명히 표시하고 선택 기간을 요청한다', async () => {
    const fetch = vi.fn().mockResolvedValue(response(metrics))
    vi.stubGlobal('fetch', fetch)
    render(<TraceMetricsPanel onExpired={vi.fn()} />)
    const panel = await screen.findByRole('region', { name: '추적된 실행 집계' })
    expect(within(panel).getByText(/전체 사용자 요청의 실패율이 아닙니다/)).toBeTruthy()
    expect(within(panel).getByText(/개발·운영 추적이 함께 포함될 수 있습니다/)).toBeTruthy()
    expect(within(panel).getByText(/관측 5건 · 종료 4건 · 진행 중 1건/)).toBeTruthy()
    expect(within(panel).getByText(/종료된 추적 중 오류 비율 25%/)).toBeTruthy()
    expect(within(panel).getByText(/시간 미기록 1건 · 중앙값 1.25초 · 상위 95% 지점 2.8초/)).toBeTruthy()
    fireEvent.change(within(panel).getByLabelText('집계 기간'), { target: { value: '1' } })
    fireEvent.click(within(panel).getByRole('button', { name: '집계 조회' }))
    const query = new URL(fetch.mock.calls.at(-1)![0], 'https://govbiz.test').searchParams
    expect(Date.parse(query.get('to_time')!) - Date.parse(query.get('from_time')!)).toBe(86_400_000)
  })

  it('집계 오류에는 일부 수치를 표시하지 않는다', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({}, 503)))
    render(<TraceMetricsPanel onExpired={vi.fn()} />)
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(screen.queryByText(/관측 5건/)).toBeNull()
  })

  it('시간이 없는 실행을 0초로 표시하지 않는다', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({ ...metrics, results: [{ ...metrics.results[0], observed: 0, completed: 0, in_progress: 0, errors: 0, latency_samples: 0, missing_latency: 0, p50_seconds: null, p95_seconds: null }] })))
    render(<TraceMetricsPanel onExpired={vi.fn()} />)
    expect(await screen.findByText(/중앙값 기록 없음 · 상위 95% 지점 기록 없음/)).toBeTruthy()
    expect(screen.getByText(/종료된 추적 중 오류 비율 미측정/)).toBeTruthy()
  })
})
