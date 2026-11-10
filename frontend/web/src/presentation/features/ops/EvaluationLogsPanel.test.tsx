// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EvaluationLogsPanel } from './EvaluationLogsPanel'

const runId = '10000000-0000-4000-8000-000000000001'
const flowId = '20000000-0000-4000-8000-000000000002'
const log = { id: '30000000-0000-4000-8000-000000000003', timestamp: '2026-10-13T00:00:00+00:00', level: 40, name: 'prefect.flow_runs', message: '평가 실패\n<script>alert(1)</script>', task_name: 'validate-capture-and-results-f3a' }
const page = { run_id: runId, prefect_flow_run_id: flowId, offset: 0, next_offset: null, results: [log] }
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const mount = (onExpired = vi.fn()) => render(<EvaluationLogsPanel runId={runId} flowId={flowId} onExpired={onExpired} />)
const load = () => fireEvent.click(screen.getByRole('button', { name: '기록 불러오기' }))
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('관리자 실행 로그', () => {
  it('클릭 시 같은 origin으로 조회하고 로그의 HTML을 텍스트로 표시한다', async () => {
    const fetch = vi.fn(async () => json(page))
    vi.stubGlobal('fetch', fetch)
    const view = mount()
    expect(screen.getByRole('region', { name: 'Prefect 실행 로그' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Prefect 실행 로그' })).toBeTruthy()
    expect(screen.getByText('평가 실행과 하위 실행의 로그를 함께 보여줘요.')).toBeTruthy()
    expect(fetch).not.toHaveBeenCalled()
    expect(screen.queryByRole('link')).toBeNull()
    load()
    const list = await screen.findByRole('list', { name: '실행 기록 목록' })
    expect(list.textContent).toContain(log.message)
    expect(screen.getByText('오류')).toBeTruthy()
    const summary = screen.getByText('오류').closest('summary')!
    const item = summary.closest('details')!
    expect(item.open).toBe(false)
    expect(summary.textContent).toContain('평가 실패')
    expect(summary.textContent).not.toContain('<script>')
    expect(summary.textContent).toContain('작업: 입력·결과 검증')
    expect(summary.className).toContain('min-h-11')
    expect(summary.querySelector('[aria-hidden="true"]')?.textContent).toContain('펼치기 +')
    summary.focus()
    expect(document.activeElement).toBe(summary)
    fireEvent.click(summary)
    expect(item.open).toBe(true)
    expect(summary.querySelector('[aria-hidden="true"]')?.textContent).toContain('접기 −')
    expect(screen.getByText('기록 출처: prefect.flow_runs')).toBeTruthy()
    expect(view.container.querySelector('script')).toBeNull()
    expect(fetch).toHaveBeenCalledWith(`/api/v1/ops/evaluations/${runId}/logs?offset=0`, expect.objectContaining({ credentials: 'same-origin', cache: 'no-store' }))
    expect(screen.queryByRole('button', { name: '더 오래된 기록' })).toBeNull()
  })

  it.each([
    { task_name: null, expected: '일반 실행 로그' },
    { task_name: undefined, expected: '일반 실행 로그' },
    { task_name: 'unknown-task-123', expected: '일반 실행 로그' },
    { task_name: 'evidently-comparison-abc', expected: '작업: 비교 보고서 생성' },
    { task_name: 'langfuse-scores-and-readback', expected: '작업: 점수 등록·확인' },
    { task_name: 'validate-evaluation-inputs', expected: '작업: 평가 입력·설정 확인' },
    { task_name: 'claim-evaluation-budget', expected: '작업: 예산 사용 권한 확인' },
    { task_name: 'generate-evaluation-responses', expected: '작업: 평가 답변 생성' },
    { task_name: 'validate-rag-results', expected: '작업: 검색 평가 결과 검증' },
    { task_name: 'render-rag-comparison', expected: '작업: 검색 평가 비교 보고서 생성' },
    { task_name: 'publish-rag-scores', expected: '작업: 검색 평가 점수 등록·확인' },
  ])('작업 이름이 없거나 알 수 없는 기록을 표시한다: $task_name', async ({ task_name, expected }) => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ ...page, results: [{ ...log, task_name }] })))
    mount(); load()
    const summary = (await screen.findByText('오류')).closest('summary')!
    expect(summary.textContent).toContain(expected)
  })

  it('이전 로그 페이지를 조회하고 새로고침하면 최신 페이지로 돌아온다', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(json({ ...page, next_offset: 100, results: Array.from({ length: 100 }, (_, index) => ({ ...log, id: `30000000-0000-4000-8000-${String(index).padStart(12, '0')}` })) }))
      .mockResolvedValueOnce(json({ ...page, offset: 100 }))
      .mockResolvedValueOnce(json(page))
    vi.stubGlobal('fetch', fetch)
    mount(); load()
    fireEvent.click(await screen.findByRole('button', { name: '더 오래된 기록' }))
    await screen.findByRole('button', { name: '최신 기록 쪽으로' })
    expect(fetch.mock.calls[1][0]).toBe(`/api/v1/ops/evaluations/${runId}/logs?offset=100`)
    fireEvent.click(screen.getByRole('button', { name: '기록 새로고침' }))
    await screen.findByRole('list')
    expect(fetch.mock.calls[2][0]).toBe(`/api/v1/ops/evaluations/${runId}/logs?offset=0`)
    expect(screen.queryByRole('button', { name: '최신 기록 쪽으로' })).toBeNull()
  })

  it('빈 로그와 조회 장애를 구분하고 실패 시 이전 로그를 지운다', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(json(page))
      .mockResolvedValueOnce(json({ code: 'PREFECT_LOGS_UNAVAILABLE' }, 503))
      .mockResolvedValueOnce(json({ ...page, results: [] })))
    mount(); load(); await screen.findByRole('list')
    fireEvent.click(screen.getByRole('button', { name: '기록 새로고침' }))
    expect((await screen.findByRole('alert')).textContent).toContain('기록을 가져오지 못했습니다.')
    expect(screen.queryByRole('list')).toBeNull()
    expect(screen.queryByText(/저장된 기록이 없습니다/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '기록 새로고침' }))
    await screen.findByText('저장된 기록이 없습니다.')
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it.each([401, 403])('관리자 인증 만료 %s를 상위 화면에 전달한다', async (status) => {
    vi.stubGlobal('fetch', vi.fn(async () => json({}, status)))
    const expired = vi.fn(); mount(expired); load()
    await act(async () => {})
    expect(expired).toHaveBeenCalledOnce()
    expect(screen.queryByRole('list')).toBeNull()
  })

  it.each([{ run_id: flowId }, { prefect_flow_run_id: runId }, { offset: 100 }, { next_offset: 1 }])('다른 실행·페이지 응답을 표시하지 않는다: %j', async (changes) => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ ...page, ...changes })))
    mount(); load()
    await screen.findByRole('alert')
    expect(screen.queryByRole('list')).toBeNull()
  })

  it('화면을 떠난 뒤 도착한 응답이나 인증 오류를 사용하지 않는다', async () => {
    let resolve!: (response: Response) => void
    const pending = new Promise<Response>((done) => { resolve = done })
    const fetch = vi.fn(() => pending); vi.stubGlobal('fetch', fetch)
    const expired = vi.fn(); const view = mount(expired); load(); view.unmount()
    await act(async () => { resolve(json({}, 401)); await pending })
    expect(expired).not.toHaveBeenCalled()
  })
})
