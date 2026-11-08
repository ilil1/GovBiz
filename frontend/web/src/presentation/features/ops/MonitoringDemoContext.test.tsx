// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { Provider } from 'react-redux'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createAppStore } from '../../../app/store'
import { AdminAiCostsPage } from '../admin/view/AdminAiCostsPage'
import { exampleCostUseCases, MonitoringDemoProvider, useMonitoringDemo } from './MonitoringDemoContext'

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs() })

function Probe() {
  const { isExample, monitoringFetch } = useMonitoringDemo()
  return <>
    <p>{isExample ? '예시 데이터' : '실제 데이터'}</p>
    <button onClick={async () => {
      const response = await monitoringFetch('/api/v1/admin/ai-request-metrics?from=2026-11-01&to=2026-11-02')
      const body = await response.json()
      document.getElementById('result')!.textContent = String(body.features[0].total)
    }}>요청 조회</button>
    <button onClick={async () => {
      try { await monitoringFetch('/api/v1/admin/ai-costs/sync', { method: 'POST' }) }
      catch { document.getElementById('result')!.textContent = '쓰기 차단' }
    }}>쓰기 시도</button>
    <button onClick={async () => {
      try { await monitoringFetch('/api/v1/ops/private') }
      catch { document.getElementById('result')!.textContent = '알 수 없는 경로 차단' }
    }}>다른 경로</button>
    <output id="result" />
  </>
}

describe('실사용 화면의 예시 모드', () => {
  it('예시 GET은 실제 네트워크 없이 반환하고 쓰기·다른 경로를 차단한다', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    render(<MonitoringDemoProvider enabled><Probe /></MonitoringDemoProvider>)
    expect(screen.getByText('예시 데이터')).toBeTruthy()
    fireEvent.click(screen.getByText('요청 조회'))
    expect(await screen.findByText('36')).toBeTruthy()
    fireEvent.click(screen.getByText('쓰기 시도'))
    expect(await screen.findByText('쓰기 차단')).toBeTruthy()
    fireEvent.click(screen.getByText('다른 경로'))
    expect(await screen.findByText('알 수 없는 경로 차단')).toBeTruthy()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('선택하지 않은 기본 모드는 기존 실제 fetch를 사용한다', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ features: [{ total: 7 }] })))
    vi.stubGlobal('fetch', fetch)
    render(<MonitoringDemoProvider enabled={false}><Probe /></MonitoringDemoProvider>)
    expect(screen.getByText('실제 데이터')).toBeTruthy()
    fireEvent.click(screen.getByText('요청 조회'))
    expect(await screen.findByText('7')).toBeTruthy()
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('실제 Core 집계는 설정된 Core 주소와 쿠키를 쓰고 Ops 집계는 같은 origin을 사용한다', async () => {
    vi.stubEnv('VITE_CORE_API_BASE_URL', 'https://core.example.test/')
    const fetch = vi.fn().mockResolvedValue(new Response('{}'))
    vi.stubGlobal('fetch', fetch)
    const captured: { request: typeof globalThis.fetch | null } = { request: null }
    function Capture() { captured.request = useMonitoringDemo().monitoringFetch; return null }
    render(<MonitoringDemoProvider enabled={false}><Capture /></MonitoringDemoProvider>)
    await captured.request!('/api/v1/admin/ai-request-metrics?from=2026-11-01&to=2026-11-02', { credentials: 'same-origin' })
    expect(fetch).toHaveBeenNthCalledWith(1, 'https://core.example.test/api/v1/admin/ai-request-metrics?from=2026-11-01&to=2026-11-02', { credentials: 'include' })
    await captured.request!('/api/v1/ops/trace-metrics', { credentials: 'same-origin' })
    expect(fetch).toHaveBeenNthCalledWith(2, '/api/v1/ops/trace-metrics', { credentials: 'same-origin' })
  })

  it('각 예시 집계가 기간·합계에 맞고 취소된 요청을 처리한다', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    const captured: { request: typeof globalThis.fetch | null } = { request: null }
    function Capture() { captured.request = useMonitoringDemo().monitoringFetch; return null }
    render(<MonitoringDemoProvider enabled><Capture /></MonitoringDemoProvider>)
    const request = captured.request!
    const query = 'from=2026-11-01&to=2026-11-02'
    const summary = await (await request(`/api/v1/admin/ai-request-metrics?${query}`)).json()
    const daily = await (await request(`/api/v1/admin/ai-request-metrics/daily?${query}`)).json()
    expect(daily.days).toHaveLength(2)
    expect(summary.features[0].total).toBe(daily.days.reduce((sum: number, day: { features: { total: number }[] }) => sum + day.features[0].total, 0))
    const jobs = await (await request(`/api/v1/admin/ai-request-metrics/jobs?${query}`)).json()
    for (const job of jobs.features) expect(job.total).toBe(job.queued + job.running + job.succeeded + job.failed + job.interrupted + job.unknown)
    const coverage = await (await request(`/api/v1/admin/ai-costs/trace-coverage?${query}`)).json()
    expect(coverage.features.every((item: { calls: number; linkedCalls: number }) => item.linkedCalls <= item.calls)).toBe(true)
    const trace = await (await request('/api/v1/ops/trace-metrics?from_time=2026-11-01T00%3A00%3A00Z&to_time=2026-11-02T00%3A00%3A00Z&environment=production')).json()
    expect(trace.environment).toBe('production')
    const controller = new AbortController(); controller.abort()
    await expect(request(`/api/v1/admin/ai-request-metrics?${query}`, { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('예시 비용은 실제 조회와 동기화·가격 쓰기 없이 제공된다', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    const result = await exampleCostUseCases.getSummary.execute('2026-11-01', '2026-11-02')
    expect(result.from).toBe('2026-11-01')
    expect(result.totals.calls).toBeGreaterThan(0)
    expect(result.topAccounts).toEqual([])
    await expect(exampleCostUseCases.sync.execute()).rejects.toThrow('read only')
    await expect(exampleCostUseCases.addPrice.execute()).rejects.toThrow('read only')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('실제 비용 화면도 예시 모드에서는 읽기 전용으로 렌더링한다', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    render(<Provider store={createAppStore()}><MemoryRouter><MonitoringDemoProvider enabled><AdminAiCostsPage /></MonitoringDemoProvider></MemoryRouter></Provider>)
    expect(await screen.findByText(/예시 데이터 · 아래 사용량과 비용/)).toBeTruthy()
    expect(await screen.findByText(/example-model/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: '사용량·비용 가져오기' })).toBeNull()
    expect(screen.queryByRole('button', { name: /가격 추가/ })).toBeNull()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('모니터링 비용 상세는 내용을 바로 보여주고 예시 상태로 돌아간다', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    render(<Provider store={createAppStore()}><MemoryRouter><MonitoringDemoProvider enabled><AdminAiCostsPage title="사용량과 비용" monitoringDetail monitoringBackTo="/ops/usage?example=1"><p>예시 모드 안내</p></AdminAiCostsPage></MonitoringDemoProvider></MemoryRouter></Provider>)
    expect(screen.getByRole('heading', { level: 1, name: '사용량과 비용' })).toBeTruthy()
    expect(screen.getByText('예시 모드 안내')).toBeTruthy()
    const back = screen.getByRole('link', { name: '실사용 모니터링으로 돌아가기' })
    expect(back.getAttribute('href')).toBe('/ops/usage?example=1')
    const costs = await screen.findByRole('region', { name: 'AI 사용량과 비용' })
    expect(costs.closest('details')).toBeNull()
    expect(await within(costs).findByRole('region', { name: '앱 사용량 요약' })).toBeTruthy()
    expect(within(costs).getByRole('region', { name: '기능별' })).toBeTruthy()
    expect(screen.getByText(/예시 데이터 · 아래 사용량과 비용/)).toBeTruthy()
    const help = within(costs).getByRole('button', { name: '비용 계산 기준 도움말' })
    expect(help.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByText(/선택된 OpenAI 프로젝트·조직 범위의 Core 밖 호출도 포함/)).toBeNull()
    fireEvent.click(help)
    expect(help.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByText(/선택된 OpenAI 프로젝트·조직 범위의 Core 밖 호출도 포함/)).toBeTruthy()
    fireEvent.click(help)
    expect(help.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByRole('button', { name: '사용량·비용 가져오기' })).toBeNull()
    expect(screen.queryByRole('button', { name: /가격 추가/ })).toBeNull()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('모니터링 비용 화면은 앱 기록을 먼저 보여주고 OpenAI 비용의 범위를 설명한다', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    render(<Provider store={createAppStore()}><MemoryRouter><MonitoringDemoProvider enabled><AdminAiCostsPage compact /></MonitoringDemoProvider></MemoryRouter></Provider>)
    const title = screen.getByText('비용은 얼마나 들었나요?')
    expect(title.closest('details')?.open).toBe(false)
    fireEvent.click(title)
    expect(title.closest('details')?.open).toBe(true)
    const application = await screen.findByRole('region', { name: '앱 사용량 요약' })
    const comparison = await screen.findByRole('region', { name: '비용 요약' })
    expect(application.compareDocumentPosition(comparison) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(within(application).getByText('앱 기록 추정 비용')).toBeTruthy()
    expect(within(application).getByText('$0.184000')).toBeTruthy()
    expect(within(comparison).getByText('실제 비용(OpenAI)')).toBeTruthy()
    expect(within(comparison).getByText('$0.193000')).toBeTruthy()
    expect(screen.getByText(/최종 청구액이 아닐 수 있습니다/)).toBeTruthy()
    const appliedPeriod = screen.getByText(/조회된 기간:/).textContent
    fireEvent.change(screen.getByLabelText('시작일'), { target: { value: '2020-01-01' } })
    expect(screen.getByText(/조회된 기간:/).textContent).toBe(appliedPeriod)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('불러온 OpenAI 비용이 없을 때 0원이 아닌 미확인으로 표시한다', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    const sample = await exampleCostUseCases.getSummary.execute('2026-11-01', '2026-11-02')
    vi.spyOn(exampleCostUseCases.getSummary, 'execute').mockResolvedValue({ ...sample, comparison: null, actualUsd: null, actualConfigured: false, actualFetchedAt: null })
    render(<Provider store={createAppStore()}><MemoryRouter><MonitoringDemoProvider enabled><AdminAiCostsPage compact /></MonitoringDemoProvider></MemoryRouter></Provider>)
    fireEvent.click(screen.getByText('비용은 얼마나 들었나요?'))
    const comparison = await screen.findByRole('region', { name: '비용 요약' })
    expect(within(comparison).getAllByText('미확인')).toHaveLength(4)
    expect(within(comparison).queryByText('$0.000000')).toBeNull()
    expect(within(screen.getByRole('region', { name: '앱 사용량 요약' })).getByText('$0.184000')).toBeTruthy()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('접힌 비용 영역에서도 조회 실패를 알리고 열어서 재시도할 수 있다', async () => {
    vi.spyOn(exampleCostUseCases.getSummary, 'execute').mockRejectedValue(new Error('unavailable'))
    render(<Provider store={createAppStore()}><MemoryRouter><MonitoringDemoProvider enabled><AdminAiCostsPage compact /></MonitoringDemoProvider></MemoryRouter></Provider>)
    expect(await screen.findByText('조회하지 못했습니다. 열어서 다시 시도해 주세요.')).toBeTruthy()
    const title = screen.getByText('비용은 얼마나 들었나요?')
    expect(title.closest('details')?.open).toBe(false)
    fireEvent.click(title)
    expect(title.closest('details')?.open).toBe(true)
    expect(await screen.findByRole('button', { name: '다시 시도' })).toBeTruthy()
  })
})
