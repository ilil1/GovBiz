// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TraceUsagePanel } from './TraceUsagePanel'

const traceId = 'abcdef1234567890abcdef1234567890'
const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status })
const totals = { calls: 2, inputTokens: 12, outputTokens: 5, estimatedUsd: '0.001000', unpricedCalls: 1, incompleteUsageCalls: 0 }
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('추적에 연결된 앱 사용량', () => {
  it('요청 시 앱 비용과 미확정 호출을 표시한다', async () => {
    const fetch = vi.fn().mockResolvedValue(response(totals)); vi.stubGlobal('fetch', fetch)
    render(<TraceUsagePanel traceId={traceId} onExpired={vi.fn()} />)
    expect(fetch).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '앱 사용량 조회' }))
    expect(await screen.findByText(/추정 비용 \$0.001000 · 비용 미확정 1건/)).toBeTruthy()
    expect(fetch.mock.calls[0][0]).toBe(`/api/v1/admin/ai-costs/traces/${traceId}`)
    expect(screen.getByText(/Langfuse 기록 비용이나 실제 청구액과는 다를 수 있습니다/)).toBeTruthy()
  })
  it('연결된 행이 없으면 0원으로 표시하지 않는다', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({ ...totals, calls: 0, estimatedUsd: '0.000000' })))
    render(<TraceUsagePanel traceId={traceId} onExpired={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: '앱 사용량 조회' }))
    expect(await screen.findByText(/연결된 앱 사용량 기록이 없습니다/)).toBeTruthy()
    expect(screen.queryByText(/추정 비용 \$0.000000/)).toBeNull()
  })
  it('조회 장애를 독립적으로 표시한다', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({}, 503)))
    render(<TraceUsagePanel traceId={traceId} onExpired={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: '앱 사용량 조회' }))
    expect((await screen.findByRole('alert')).textContent).toContain('추적 상세는 계속 확인할 수 있습니다')
  })
  it.each([401, 403])('앱 사용량 조회가 %s이면 관리자 세션을 종료한다', async (status) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({}, status)))
    const onExpired = vi.fn()
    render(<TraceUsagePanel traceId={traceId} onExpired={onExpired} />)
    fireEvent.click(screen.getByRole('button', { name: '앱 사용량 조회' }))
    await vi.waitFor(() => expect(onExpired).toHaveBeenCalledOnce())
    expect(screen.queryByRole('alert')).toBeNull()
  })
  it('응답이 지연되면 조회를 중단하고 다시 시도할 수 있다', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', vi.fn((_url: string, options: RequestInit) => new Promise((_resolve, reject) => {
      options.signal?.addEventListener('abort', () => reject(new Error('aborted')))
    })))
    render(<TraceUsagePanel traceId={traceId} onExpired={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: '앱 사용량 조회' }))
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000) })
    expect(screen.getByRole('alert').textContent).toContain('앱 사용량을 조회하지 못했습니다')
    expect((screen.getByRole('button', { name: '앱 사용량 조회' }) as HTMLButtonElement).disabled).toBe(false)
  })
})
