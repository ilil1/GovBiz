// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TraceMetricsPanel } from './TraceMetricsPanel'
import { MonitoringDemoProvider } from './MonitoringDemoContext'

const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
const metrics = { from_time: '2026-11-01T00:00:00Z', to_time: '2026-11-08T00:00:00Z', scope: 'observed-root-traces', environment: 'production', results: [{ name: 'search.total', observed: 5, completed: 4, in_progress: 1, errors: 1, warnings: 0, latency_samples: 3, missing_latency: 1, p50_seconds: 1.25, p95_seconds: 2.8 }] }
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs() })

describe('추적된 실행 집계', () => {
  it('중복 지원 검토 실행을 집계에 표시한다', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({ ...metrics, results: [{ ...metrics.results[0], name: 'combination.total' }] })))
    render(<TraceMetricsPanel onExpired={vi.fn()} />)
    expect(await screen.findByText('중복 지원 검토')).toBeTruthy()
    expect(screen.getByText('5건')).toBeTruthy()
  })
  it('로컬 개발 서버에서는 개발 환경의 추적을 기본으로 조회한다', async () => {
    vi.stubEnv('DEV', true)
    vi.stubEnv('MODE', 'development')
    const fetch = vi.fn().mockResolvedValue(response({ ...metrics, environment: 'development' }))
    vi.stubGlobal('fetch', fetch)
    render(<TraceMetricsPanel onExpired={vi.fn()} />)
    expect(await screen.findByText(/조회 환경: 개발/)).toBeTruthy()
    expect(screen.getByLabelText('실행 환경')).toHaveProperty('value', 'development')
    expect(new URL(fetch.mock.calls[0][0], 'https://govbiz.test').searchParams.get('environment')).toBe('development')
  })

  it.each([{ dev: false, mode: 'production' }, { dev: true, mode: 'connected' }])('배포 및 연결 모드($mode)는 운영 환경을 기본으로 조회한다', async ({ dev, mode }) => {
    vi.stubEnv('DEV', dev)
    vi.stubEnv('MODE', mode)
    const fetch = vi.fn().mockResolvedValue(response(metrics))
    vi.stubGlobal('fetch', fetch)
    render(<TraceMetricsPanel onExpired={vi.fn()} />)
    expect(await screen.findByText(/조회 환경: 운영/)).toBeTruthy()
    expect(screen.getByLabelText('실행 환경')).toHaveProperty('value', 'production')
    expect(new URL(fetch.mock.calls[0][0], 'https://govbiz.test').searchParams.get('environment')).toBe('production')
  })

  it('예시 모드에서는 실제 추적 서버에 연결하지 않는다', async () => {
    vi.stubEnv('DEV', true)
    vi.stubEnv('MODE', 'development')
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    render(<MonitoringDemoProvider enabled><TraceMetricsPanel onExpired={vi.fn()} /></MonitoringDemoProvider>)
    expect(await screen.findByText(/예시 데이터 · 실제 실행 기록이 아닙니다/)).toBeTruthy()
    expect(await screen.findByText('18건')).toBeTruthy()
    expect(screen.getByText(/조회 환경: 개발/)).toBeTruthy()
    expect(fetch).not.toHaveBeenCalled()
  })
  it('집계 범위와 누락을 분명히 표시하고 선택 기간을 요청한다', async () => {
    const fetch = vi.fn().mockImplementation((path: string) => Promise.resolve(response({ ...metrics, environment: new URL(path, 'https://govbiz.test').searchParams.get('environment') })))
    vi.stubGlobal('fetch', fetch)
    render(<TraceMetricsPanel onExpired={vi.fn()} />)
    const panel = await screen.findByRole('region', { name: '추적된 실행 집계' })
    expect(within(panel).getByText(/전체 사용자 요청의 실패율이 아닙니다/)).toBeTruthy()
    const help = within(panel).getByRole('button', { name: '기록된 실행 도움말' })
    expect(help.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(help)
    expect(help.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByText(/환경이 기록되지 않은 실행은 전체 환경 또는 환경 미기록을 선택하면 볼 수 있습니다/)).toBeTruthy()
    expect(new URL(fetch.mock.calls[0][0], 'https://govbiz.test').searchParams.get('environment')).toBe('production')
    expect(await within(panel).findByText(/조회 환경: 운영/)).toBeTruthy()
    expect(within(panel).getByText('5건')).toBeTruthy()
    expect(within(panel).getByText('4건 / 1건')).toBeTruthy()
    expect(within(panel).getByText('1건 (25%)')).toBeTruthy()
    expect(within(panel).getByText(/시간 미기록 1건/)).toBeTruthy()
    expect(within(panel).getByText(/실행의 95%가 끝난 시간: 2.8초/)).toBeTruthy()
    fireEvent.change(within(panel).getByLabelText('집계 기간'), { target: { value: '1' } })
    fireEvent.change(within(panel).getByLabelText('실행 환경'), { target: { value: 'unknown' } })
    fireEvent.click(within(panel).getByRole('button', { name: '집계 조회' }))
    const query = new URL(fetch.mock.calls.at(-1)![0], 'https://govbiz.test').searchParams
    expect(Date.parse(query.get('to_time')!) - Date.parse(query.get('from_time')!)).toBe(86_400_000)
    expect(query.get('environment')).toBe('unknown')
    expect(await within(panel).findByText(/조회 환경: 환경 미기록/)).toBeTruthy()
  })

  it('집계 오류에는 일부 수치를 표시하지 않는다', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({}, 503)))
    render(<TraceMetricsPanel onExpired={vi.fn()} />)
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(screen.queryByText('5건')).toBeNull()
  })

  it.each(['all', undefined])('서버의 환경 정보가 %s이면 운영 수치를 표시하지 않는다', async (environment) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({ ...metrics, environment })))
    render(<TraceMetricsPanel onExpired={vi.fn()} />)
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(screen.queryByText('5건')).toBeNull()
  })

  it('시간이 없는 실행을 0초로 표시하지 않는다', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({ ...metrics, results: [{ ...metrics.results[0], observed: 0, completed: 0, in_progress: 0, errors: 0, latency_samples: 0, missing_latency: 0, p50_seconds: null, p95_seconds: null }] })))
    render(<TraceMetricsPanel onExpired={vi.fn()} />)
    expect(await screen.findByText(/선택한 기간과 환경에 기록된 실행이 없습니다/)).toBeTruthy()
    expect(screen.getByText(/기록이 없으면 오류 비율과 걸린 시간을 계산할 수 없습니다/)).toBeTruthy()
  })
})
