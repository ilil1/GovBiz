// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getBudgetReservations, getLiveReadiness, type DailyBudget } from '../../../data/ops/opsApi'
import { DailyBudgetPanel } from './DailyBudgetPanel'

const day: DailyBudget = {
  state: 'enforced', timezone: 'Asia/Seoul', period_start: '2026-10-04T00:00:00+09:00', period_end: '2026-10-05T00:00:00+09:00',
  limits: { calls: 12, input_tokens: 400000, output_tokens: 24000 },
  current_day: { calls: 6, input_tokens: 196608, output_tokens: 12000 },
  carried: { calls: 1, input_tokens: 32768, output_tokens: 2000 },
  allocated: { calls: 7, input_tokens: 229376, output_tokens: 14000 },
  remaining: { calls: 5, input_tokens: 170624, output_tokens: 10000 }, recent_changes: [],
}
const profile = 'a'.repeat(64)
const summary = {
  state: 'consistent', limits: { calls: 100, input_tokens: 1000000, output_tokens: 200000 },
  allocated: { calls: 7, input_tokens: 229376, output_tokens: 14000 },
  remaining: { calls: 93, input_tokens: 770624, output_tokens: 186000 }, breakdown: null,
  reservation_count: 1, legacy_live_run_count: 0, change_count: 0, recent_changes: [], daily: day,
}
const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } })
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('일별 평가 예산', () => {
  it('서울 날짜와 오늘 접수·이월·잔여를 분리해서 표시한다', () => {
    render(<DailyBudgetPanel value={day} />)
    expect(screen.getByText(/2026-10-04 00:00/)).toBeTruthy()
    expect(screen.getByText('잔여 170,624토큰')).toBeTruthy()
    expect(screen.getByText('일별 한도 400,000토큰')).toBeTruthy()
    const detail = screen.getByText('오늘 접수와 이월 상세')
    expect(detail.closest('details')).toHaveProperty('open', false)
    fireEvent.click(detail)
    expect(detail.closest('details')).toHaveProperty('open', true)
    const row = screen.getByRole('row', { name: '입력 토큰 400,000 196,608 32,768 170,624' })
    expect(within(row).getAllByRole('cell').map((cell) => cell.textContent)).toEqual(['400,000', '196,608', '32,768', '170,624'])
    expect(screen.getByText(/자정을 넘긴 예약은 새 호출을 승인하지 않습니다/)).toBeTruthy()
  })

  it('상단 요약을 숨겨도 접수·이월과 변경 이력을 확인할 수 있다', () => {
    const value: DailyBudget = { ...day, recent_changes: [{
      request_id: '10000000-0000-4000-8000-000000000001', source: 'CORE_ADMIN', actor: '관리자', reason: '설정',
      expected_revision: 'a'.repeat(64), previous: null, policy: { enabled: true, limits: day.limits! }, created_at: day.period_start,
    }] }
    render(<DailyBudgetPanel value={value} hideSummary />)
    expect(screen.queryByText('잔여 170,624토큰')).toBeNull()
    expect(screen.queryByText('일별 한도 400,000토큰')).toBeNull()
    fireEvent.click(screen.getByText('오늘 접수와 이월 상세'))
    expect(screen.getByRole('row', { name: '입력 토큰 400,000 196,608 32,768 170,624' })).toBeTruthy()
    fireEvent.click(screen.getByText('일별 정책 변경 이력 · 최근 1건'))
    expect(screen.getByText(/관리자 · CORE_ADMIN/)).toBeTruthy()
    expect(screen.getByText('변경 이유: 설정')).toBeTruthy()
    expect(screen.getByText('일별 항목과 이월량 설명')).toBeTruthy()
  })

  it.each([
    ['CORE_ADMIN', '자동 생성: AI 평가 사용량 한도 설정', '변경 이유: 별도 입력 없음'],
    ['CORE_ADMIN', '자동 생성: 하루 한도 설정', '변경 이유: 별도 입력 없음'],
    ['CORE_ADMIN', '자동 생성: 하루 한도 해제', '변경 이유: 별도 입력 없음'],
    ['CLI', '자동 생성: 하루 한도 설정', '변경 이유: 자동 생성: 하루 한도 설정'],
    ['CORE_ADMIN', '하루 평가 범위 조정', '변경 이유: 하루 평가 범위 조정'],
  ] as const)('변경 이력의 이유를 출처와 내용에 맞게 표시한다: %s %s', (source, reason, expected) => {
    const value: DailyBudget = { ...day, recent_changes: [{
      request_id: '10000000-0000-4000-8000-000000000001', source, actor: '관리자', reason,
      expected_revision: 'a'.repeat(64), previous: null, policy: { enabled: true, limits: day.limits! }, created_at: day.period_start,
    }] }
    render(<DailyBudgetPanel value={value} hideSummary />)
    fireEvent.click(screen.getByText('일별 정책 변경 이력 · 최근 1건'))
    expect(screen.getByText(expected)).toBeTruthy()
  })

  it.each(['unknown', 'exceeded'] as const)('중복 요약을 숨겨도 %s 기록은 0으로 표시하지 않는다', (state) => {
    render(<DailyBudgetPanel hideSummary value={{ ...day, state, remaining: null, ...(state === 'unknown' ? { allocated: null, current_day: null, carried: null } : {}) }} />)
    expect(screen.queryByText('잔여 0토큰')).toBeNull()
    fireEvent.click(screen.getByText('오늘 접수와 이월 상세'))
    const row = screen.getByRole('row', { name: /^입력 토큰/ })
    expect(within(row).getAllByRole('cell').at(-1)?.textContent).toBe('확인 불가')
  })

  it.each(['unknown', 'exceeded'] as const)('미확인·초과 상태 %s를 잔여 0으로 표시하지 않는다', (state) => {
    render(<DailyBudgetPanel value={{ ...day, state, remaining: null, ...(state === 'unknown' ? { allocated: null, current_day: null, carried: null } : {}) }} />)
    expect(screen.getByRole('alert').textContent).toContain('신규 예약을 차단')
    expect(screen.getAllByText('잔여 확인 불가')).toHaveLength(3)
    expect(screen.queryByText('잔여 0토큰')).toBeNull()
    const detail = screen.getByText('오늘 접수와 이월 상세')
    expect(detail.closest('details')).toHaveProperty('open', false)
    fireEvent.click(detail)
    expect(detail.closest('details')).toHaveProperty('open', true)
    expect(screen.getAllByText('확인 불가').length).toBeGreaterThanOrEqual(3)
  })

  it('일별 장부가 미확인이면 잔여 숫자가 전달돼도 확정된 수치로 보여주지 않는다', () => {
    render(<DailyBudgetPanel value={{ ...day, state: 'unknown' }} />)
    expect(screen.getByRole('alert').textContent).toContain('신규 예약을 차단')
    expect(screen.getAllByText('잔여 확인 불가')).toHaveLength(3)
    expect(screen.queryByText('잔여 170,624토큰')).toBeNull()
    fireEvent.click(screen.getByText('오늘 접수와 이월 상세'))
    const row = screen.getByRole('row', { name: '입력 토큰 400,000 196,608 32,768 확인 불가' })
    expect(within(row).getAllByRole('cell').at(-1)?.textContent).toBe('확인 불가')
  })

  it('구 서버 응답 누락과 일별 정책 미적용을 구분한다', () => {
    const view = render(<DailyBudgetPanel value={undefined} />)
    expect(screen.getByText('서버에서 일별 예산 정보를 제공하지 않습니다.')).toBeTruthy()
    view.rerender(<DailyBudgetPanel value={{ ...day, state: 'disabled', limits: null, remaining: null, allocated: null, current_day: null, carried: null }} />)
    expect(screen.getByText('일별 제한 미적용 · 누적 한도는 별도로 확인합니다.')).toBeTruthy()
    expect(screen.queryByRole('table')).toBeNull()
    const help = screen.getByText('일별 항목과 이월량 설명')
    expect(help.closest('details')).toHaveProperty('open', false)
    fireEvent.click(help)
    expect(help.closest('details')).toHaveProperty('open', true)
    expect(screen.getByText(/남은 일별 한도가 적립되는 뜻이 아니며/)).toBeTruthy()
    expect(screen.getByText(/일별 한도 − 오늘 접수 몫 − 전날 이전 이월/)).toBeTruthy()
    expect(screen.queryByRole('table')).toBeNull()
  })

  it('일별 응답을 기존 예산 조회에서 보존한다', async () => {
    const fetch = vi.fn(async () => json({ as_of: day.period_start, summary, count: 0, next: null, previous: null, results: [] }))
    vi.stubGlobal('fetch', fetch)
    expect((await getBudgetReservations(1)).summary.daily).toEqual(day)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it.each([
    { remaining: { ...day.remaining, calls: 6 } }, { carried: null }, { period_end: day.period_start },
    { state: 'disabled' }, { state: 'unknown' }, { state: 'enforced', limits: null },
    { state: 'enforced', remaining: null }, { state: 'exceeded', remaining: null },
  ])('모순된 일별 장부를 정상 잔여량으로 받지 않는다: %j', async (changes) => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ as_of: day.period_start, summary: { ...summary, daily: { ...day, ...changes } }, count: 0, next: null, previous: null, results: [] })))
    await expect(getBudgetReservations(1)).rejects.toThrow()
  })

  it('누적 예산이 충분해도 일별 부족을 정상 점검으로 받지 않는다', async () => {
    const value = {
      as_of: day.period_start, dataset_id: 'fixed', execution_profile: profile, evaluation_scope: 'fixed-answer-context-only',
      model: 'test-model', state: 'checked', required: { calls: 6, input_tokens: 196608, output_tokens: 12000 },
      remaining: summary.remaining, blockers: [], warnings: [], daily: day,
    }
    vi.stubGlobal('fetch', vi.fn(async () => json(value)))
    await expect(getLiveReadiness('fixed', profile)).rejects.toThrow()
    vi.stubGlobal('fetch', vi.fn(async () => json({ ...value, state: 'blocked', blockers: [{ code: 'DAILY_INSUFFICIENT_CALLS', message: '일별 호출 부족' }] })))
    expect((await getLiveReadiness('fixed', profile)).daily).toEqual(day)
  })
})
