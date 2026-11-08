// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { JobMetricsPanel } from './JobMetricsPanel'
import { MonitoringDemoProvider } from './MonitoringDemoContext'

const row = { feature: 'APPLICATION_DOCUMENT', total: 5, queued: 1, running: 1, succeeded: 2, failed: 1, interrupted: 0, unknown: 0, durationSamples: 3, averageDurationMs: 2500 }
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

function mockResult(features: unknown[], status = 200) {
  const fetch = vi.fn(async (path: string) => {
    const query = new URL(path, 'https://govbiz.test').searchParams
    return new Response(JSON.stringify({ from: query.get('from'), to: query.get('to'), scope: 'stored-ai-jobs', features }), { status })
  })
  vi.stubGlobal('fetch', fetch)
  return fetch
}

describe('접수된 작업 결과', () => {
  it('접수와 완료를 구별하고 현재 상태와 시간 표본을 보여준다', async () => {
    const fetch = mockResult([row])
    const report = vi.fn()
    render(<JobMetricsPanel onExpired={vi.fn()} onSummaryChange={report} />)
    const detail = await screen.findByText('작업 종류별 결과와 소요 시간 보기')
    expect(detail.closest('details')?.open).toBe(false)
    fireEvent.click(detail)
    const card = await screen.findByRole('article')
    expect(within(card).getByText('신청 문서 만들기')).toBeTruthy()
    expect(within(card).getByText('총 5건')).toBeTruthy()
    expect(within(card).getByText('2')).toBeTruthy()
    expect(card.textContent).toContain('대기 1건 · 진행 1건 · 실패 1건')
    expect(within(card).getByText(/평균 소요 2.5초 · 시간 기록 3건/)).toBeTruthy()
    expect(screen.getByRole('region', { name: '작업 결과' }).textContent).toContain('저장된 작업')
    const help = screen.getByRole('button', { name: '작업 결과 도움말' })
    expect(help.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(help)
    expect(help.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByText(/같은 작업을 다시 접수해도 한 건으로 세며/)).toBeTruthy()
    expect(report).toHaveBeenCalledWith(expect.objectContaining({ status: 'ready', succeeded: 2, failed: 1 }))
    fireEvent.change(screen.getByLabelText('접수 기간 (UTC)'), { target: { value: '1' } })
    const path = fetch.mock.calls.at(-1)![0]
    const query = new URL(path, 'https://govbiz.test').searchParams
    expect(query.get('from')).toBe(query.get('to'))
  })

  it('기록이 없는 작업을 성공이나 실패로 단정하지 않는다', async () => {
    mockResult([{ ...row, total: 0, queued: 0, running: 0, succeeded: 0, failed: 0, durationSamples: 0, averageDurationMs: null }])
    const report = vi.fn()
    render(<JobMetricsPanel onExpired={vi.fn()} onSummaryChange={report} />)
    expect(await screen.findByText('이 기간에 저장된 작업이 없습니다.')).toBeTruthy()
    expect(report).toHaveBeenCalledWith({ status: 'empty' })
  })

  it('불일치한 응답은 결과로 표시하지 않고 다시 조회할 수 있다', async () => {
    const fetch = mockResult([{ ...row, total: 6 }])
    render(<JobMetricsPanel onExpired={vi.fn()} />)
    expect(await screen.findByRole('alert')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '다시 조회' }))
    expect(fetch).toHaveBeenCalledTimes(2)
  })
  it('예시 모드는 실제 서버 호출 없이 가상 작업 결과를 표시한다', async () => {
    const liveFetch = vi.fn()
    vi.stubGlobal('fetch', liveFetch)
    render(<MonitoringDemoProvider enabled><JobMetricsPanel onExpired={vi.fn()} /></MonitoringDemoProvider>)
    expect(await screen.findByText('예시 데이터 · 실제 기록 아님')).toBeTruthy()
    fireEvent.click(await screen.findByText('작업 종류별 결과와 소요 시간 보기'))
    expect(await screen.findByText('신청 문서 만들기')).toBeTruthy()
    expect(liveFetch).not.toHaveBeenCalled()
  })
})
