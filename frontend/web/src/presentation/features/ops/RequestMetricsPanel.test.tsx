// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RequestMetricsPanel } from './RequestMetricsPanel'
import { MonitoringDemoProvider } from './MonitoringDemoContext'

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

function mockResult(features: unknown[], status = 200) {
  const fetch = vi.fn(async (path: string) => {
    const query = new URL(path, 'https://govbiz.test').searchParams
    const result = { from: query.get('from'), to: query.get('to'), scope: 'core-http-requests' }
    return new Response(JSON.stringify(path.includes('/daily?') ? { ...result, days: [] } : { ...result, features }), { status })
  })
  vi.stubGlobal('fetch', fetch)
  return fetch
}

const row = { feature: 'AI_SEARCH', total: 10, success: 5, accepted: 1, clientErrors: 2, serverErrors: 1, other: 1, latencySamples: 9, p50UpperMs: 1000, p95UpperMs: null }

describe('AI 기능 HTTP 요청 집계', () => {
  it('응답과 접수를 구분하고 지연 구간의 상한 및 오류 비율을 표시한다', async () => {
    const fetch = mockResult([row])
    const report = vi.fn()
    render(<RequestMetricsPanel onExpired={vi.fn()} onSummaryChange={report} />)
    await screen.findByLabelText('요청 요약')
    const detail = screen.getByText('기능별 요청과 응답 시간 보기')
    expect(detail.closest('details')?.open).toBe(false)
    fireEvent.click(detail)
    expect(await screen.findByText('기록된 요청 10건')).toBeTruthy()
    const help = screen.getByRole('button', { name: '요청 현황 도움말' })
    expect(help.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByText(/Core 도착 전의 실패/)).toBeNull()
    fireEvent.click(help)
    expect(help.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByText(/Core 도착 전의 실패/)).toBeTruthy()
    fireEvent.click(help)
    expect(screen.queryByText(/Core 도착 전의 실패/)).toBeNull()
    expect(screen.getByText(/전체 기록 중 10%/)).toBeTruthy()
    expect(screen.getByText(/절반의 요청/).textContent).toContain('1초 이하')
    expect(screen.getByText(/대부분의 요청/).textContent).toContain('120초 초과')
    expect(screen.getByText(/접수\(202\)는 작업 완료가 아닙니다/)).toBeTruthy()
    await waitFor(() => expect(report).toHaveBeenCalledWith(expect.objectContaining({ status: 'ready', total: 10, serverErrors: 1 })))
    fireEvent.change(screen.getByLabelText('확인 기간'), { target: { value: '1' } })
    fireEvent.click(screen.getByRole('button', { name: '요청 현황 보기' }))
    const query = new URL(fetch.mock.calls.at(-1)![0], 'https://govbiz.test').searchParams
    expect(query.get('from')).toBe(query.get('to'))
  })
  it('표본이 없으면 지연과 오류 비율을 미측정으로 표시한다', async () => {
    mockResult([{ ...row, total: 0, success: 0, accepted: 0, clientErrors: 0, serverErrors: 0, other: 0, latencySamples: 0, p50UpperMs: null }])
    render(<RequestMetricsPanel onExpired={vi.fn()} />)
    const detail = await screen.findByText('기능별 요청과 응답 시간 보기')
    fireEvent.click(detail)
    expect(await screen.findByText('오류 비율 미측정')).toBeTruthy()
    expect(screen.getByText(/절반의 요청/).textContent).toContain('미측정')
    expect(screen.getByText(/대부분의 요청/).textContent).toContain('미측정')
  })
  it('조회 실패나 불일치한 집계를 정상 결과로 표시하지 않는다', async () => {
    mockResult([{ ...row, total: 11 }])
    const report = vi.fn()
    render(<RequestMetricsPanel onExpired={vi.fn()} onSummaryChange={report} />)
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(screen.queryByText('기록된 요청 11건')).toBeNull()
    expect(report).toHaveBeenCalledWith({ status: 'error' })
  })
  it('조회 API가 없는 경우 서버 버전을 확인하도록 안내하고 다시 조회한다', async () => {
    const fetch = mockResult([], 404)
    render(<RequestMetricsPanel onExpired={vi.fn()} />)
    expect(await screen.findByText(/조회 기능이 서버에 없습니다/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '다시 조회' }))
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))
  })
  it('AbortSignal 확장 기능이 없는 브라우저에서도 요청을 조회한다', async () => {
    vi.stubGlobal('AbortSignal', undefined)
    mockResult([row])
    render(<RequestMetricsPanel onExpired={vi.fn()} />)
    expect(await screen.findByText('기록된 요청 10건')).toBeTruthy()
  })
  it('기록이 없으면 0건을 정상 상태로 보고하지 않는다', async () => {
    mockResult([])
    const report = vi.fn()
    render(<RequestMetricsPanel onExpired={vi.fn()} onSummaryChange={report} />)
    expect(await screen.findByText('이 기간에 저장된 요청 기록이 없습니다.')).toBeTruthy()
    expect(report).toHaveBeenCalledWith({ status: 'empty' })
  })
  it('예시 모드는 실제 서버 호출 없이 예시임을 표시한다', async () => {
    const liveFetch = vi.fn()
    vi.stubGlobal('fetch', liveFetch)
    const report = vi.fn()
    render(<MonitoringDemoProvider enabled><RequestMetricsPanel onExpired={vi.fn()} onSummaryChange={report} /></MonitoringDemoProvider>)
    expect(await screen.findByText('예시 데이터 · 실제 기록 아님')).toBeTruthy()
    await waitFor(() => expect(report).toHaveBeenCalledWith(expect.objectContaining({ status: 'ready' })))
    expect(liveFetch).not.toHaveBeenCalled()
  })
  it('날짜별 기록이 없는 날을 0건으로 채우지 않는다', async () => {
    const fetch = mockResult([row])
    render(<RequestMetricsPanel onExpired={vi.fn()} />)
    await screen.findByText('기록된 요청 10건')
    expect(fetch.mock.calls.some(([path]) => path.includes('/daily?'))).toBe(false)
    fireEvent.click(screen.getByText('날짜별 요청 기록 보기'))
    const table = await screen.findByRole('table', { name: '날짜와 기능별 기록된 요청 및 오류' })
    const chart = screen.getByRole('region', { name: '날짜별 요청 추세' })
    expect(within(table).getAllByText('기록 없음')).toHaveLength(7)
    expect(within(chart).getAllByText('기록 없음')).toHaveLength(7)
  })
  it('날짜별 기능과 오류 및 상한을 보여준다', async () => {
    vi.stubGlobal('fetch', vi.fn(async (path: string) => {
      const query = new URL(path, 'https://govbiz.test').searchParams
      const meta = { from: query.get('from'), to: query.get('to'), scope: 'core-http-requests' }
      const another = { ...row, feature: 'EVIDENCE_QUESTION', total: 5, success: 4, accepted: 0, clientErrors: 0, serverErrors: 1, other: 0, latencySamples: 5 }
      return new Response(JSON.stringify(path.includes('/daily?') ? { ...meta, days: [{ date: meta.to, features: [row, another] }] } : { ...meta, features: [row] }))
    }))
    render(<RequestMetricsPanel onExpired={vi.fn()} />)
    fireEvent.click(screen.getByText('날짜별 요청 기록 보기'))
    const table = await screen.findByRole('table', { name: '날짜와 기능별 기록된 요청 및 오류' })
    expect(within(table).getByText('10건')).toBeTruthy()
    expect(within(table).getAllByText('기록 없음')).toHaveLength(6)
    const chart = screen.getByRole('region', { name: '날짜별 요청 추세' })
    expect(chart.textContent).toContain('요청 15건 · 서버 오류 2건')
    expect(within(chart).getAllByText('기록 없음')).toHaveLength(6)
  })
  it('날짜별 조회가 실패해도 기간 합계는 계속 보여준다', async () => {
    vi.stubGlobal('fetch', vi.fn(async (path: string) => {
      const query = new URL(path, 'https://govbiz.test').searchParams
      if (path.includes('/daily?')) return new Response('', { status: 503 })
      return new Response(JSON.stringify({ from: query.get('from'), to: query.get('to'), scope: 'core-http-requests', features: [row] }))
    }))
    render(<RequestMetricsPanel onExpired={vi.fn()} />)
    expect(await screen.findByText('기록된 요청 10건')).toBeTruthy()
    fireEvent.click(screen.getByText('날짜별 요청 기록 보기'))
    expect(await screen.findByText(/날짜별 기록을 불러오지 못했습니다/)).toBeTruthy()
    expect(screen.getByRole('button', { name: '날짜별 기록 다시 조회' })).toBeTruthy()
  })
})
