// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RequestMetricsPanel } from './RequestMetricsPanel'

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

function mockResult(features: unknown[], status = 200) {
  const fetch = vi.fn(async (path: string) => {
    const query = new URL(path, 'https://govbiz.test').searchParams
    return new Response(JSON.stringify({ from: query.get('from'), to: query.get('to'), scope: 'core-http-requests', features }), { status })
  })
  vi.stubGlobal('fetch', fetch)
  return fetch
}

const row = { feature: 'AI_SEARCH', total: 10, success: 5, accepted: 1, clientErrors: 2, serverErrors: 1, other: 1, latencySamples: 9, p50UpperMs: 1000, p95UpperMs: null }

describe('AI 기능 HTTP 요청 집계', () => {
  it('응답과 접수를 구분하고 지연 구간의 상한 및 오류 비율을 표시한다', async () => {
    const fetch = mockResult([row])
    render(<RequestMetricsPanel onExpired={vi.fn()} />)
    expect(await screen.findByText(/기록 10건 · 응답 성공 5건 · 접수 1건/)).toBeTruthy()
    expect(screen.getByText(/서버 오류 비율 10%/)).toBeTruthy()
    expect(screen.getByText(/중앙값 1초 이하 · 상위 95% 지점 120초 초과/)).toBeTruthy()
    expect(screen.getByText(/접수\(202\)는 작업 완료가 아닙니다/)).toBeTruthy()
    fireEvent.change(screen.getByLabelText('HTTP 집계 기간'), { target: { value: '1' } })
    fireEvent.click(screen.getByRole('button', { name: 'HTTP 집계 조회' }))
    const query = new URL(fetch.mock.calls.at(-1)![0], 'https://govbiz.test').searchParams
    expect(query.get('from')).toBe(query.get('to'))
  })
  it('표본이 없으면 지연과 오류 비율을 미측정으로 표시한다', async () => {
    mockResult([{ ...row, total: 0, success: 0, accepted: 0, clientErrors: 0, serverErrors: 0, other: 0, latencySamples: 0, p50UpperMs: null }])
    render(<RequestMetricsPanel onExpired={vi.fn()} />)
    expect(await screen.findByText(/서버 오류 비율 미측정/)).toBeTruthy()
    expect(screen.getByText(/중앙값 미측정 · 상위 95% 지점 미측정/)).toBeTruthy()
  })
  it('조회 실패나 불일치한 집계를 정상 결과로 표시하지 않는다', async () => {
    mockResult([{ ...row, total: 11 }])
    render(<RequestMetricsPanel onExpired={vi.fn()} />)
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(screen.queryByText(/기록 11건/)).toBeNull()
  })
})
