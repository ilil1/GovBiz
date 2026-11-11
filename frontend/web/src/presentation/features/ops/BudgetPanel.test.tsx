// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getRunBudget, type BudgetPage, type RunBudget } from '../../../data/ops/opsApi'
import { BudgetOverview, RunBudgetPanel } from './BudgetPanel'

const id = '10000000-0000-4000-8000-000000000001'
const time = '2026-09-29T00:00:00Z'
const breakdown = {
  settled_calls: 1, confirmed_input_tokens: 100, confirmed_output_tokens: 50,
  unknown_calls: 1, unknown_output_tokens: 2000, unapproved_calls: 4, unapproved_output_tokens: 8000,
  pending_release_output_tokens: 1950, allocated_calls: 6, allocated_output_tokens: 12000,
}
const reservation = { run_id: id, dataset_id: '검토 자료', created_at: time, closed_at: null, max_calls: 6, max_output_tokens: 2000, breakdown }
const page: BudgetPage = {
  as_of: time, count: 1, next: null, previous: null, results: [reservation],
  summary: {
    state: 'consistent', limits: { calls: 12, output_tokens: 24000 }, allocated: { calls: 6, output_tokens: 12000 },
    remaining: { calls: 6, output_tokens: 12000 }, breakdown, reservation_count: 1,
    legacy_live_run_count: 2, change_count: 1, recent_changes: [{
      request_id: id, actor: '김 운영자', source: 'CLI', reason: '검토한 수동 평가 한도',
      previous_limits: null, limits: { calls: 12, output_tokens: 24000 }, created_at: time,
    }],
  },
}
const detail: RunBudget = {
  as_of: time, state: 'recorded', reservation,
  calls: [
    { sequence: 0, authorized_at: time, settled_at: time, input_tokens: 100, output_tokens: 50 },
    { sequence: 1, authorized_at: time, settled_at: null, input_tokens: null, output_tokens: null },
  ],
}
const cleanupRecord = {
  request_id: id, actor: '김 운영자', source: 'CLI', reason: '종료 후 close 실패 확인', created_at: time,
  evidence: { source: 'PREFECT', flow_id: id, run_id: id, spec_sha256: 'a'.repeat(64), parameters_sha256: 'b'.repeat(64), state_id: id, state_type: 'FAILED', state_timestamp: time, observed_at: time },
  before: { global_calls: 6, global_output_tokens: 12000, reservation_calls: 6, reservation_output_tokens: 12000 },
  after: { global_calls: 2, global_output_tokens: 2050, reservation_calls: 2, reservation_output_tokens: 2050, unknown_calls: 1, unknown_output_tokens: 2000 },
}
const correction = {
  request_id: id, run_id: id, sequence: 1, source: 'WORKER_RESPONSE', actor: '김 운영자', reason: '정산 전달 실패 검토',
  evidence_sha256: 'c'.repeat(64), response_id: 'resp_test', input_tokens: 100, output_tokens: 50, created_at: time,
  before: { global_calls: 2, global_output_tokens: 2050, reservation_calls: 2, reservation_output_tokens: 2050, unknown_calls: 1, unknown_output_tokens: 2000 },
  after: { global_calls: 2, global_output_tokens: 100, reservation_calls: 2, reservation_output_tokens: 100, unknown_calls: 0, unknown_output_tokens: 0 },
}
const correctedDetail = {
  ...detail, corrections: [correction], reservation: { ...reservation, closed_at: time, breakdown: {
    settled_calls: 2, confirmed_input_tokens: 200, confirmed_output_tokens: 100,
    unknown_calls: 0, unknown_output_tokens: 0, unapproved_calls: 0, unapproved_output_tokens: 0,
    pending_release_output_tokens: 0, allocated_calls: 2, allocated_output_tokens: 100,
  } },
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const legacyDetail = {
  as_of: time, state: 'legacy_recorded', reservation: null, calls: [], cleanup: null, corrections: [],
  legacy_usage: {
    request_id: id, run_id: id, source: 'SAVED_CAPTURE', provider_receipt_verified: false,
    actor: '과거 기록 담당자', reason: '전체 응답 사용량 검토', created_at: time,
    capture_sha256: 'a'.repeat(64), evidence_sha256: 'b'.repeat(64),
    usage: { calls: 6, input_tokens: 6834, output_tokens: 689 },
    before: { calls: 1, input_tokens: 1067, output_tokens: 87 },
    after: { calls: 7, input_tokens: 7901, output_tokens: 776 },
  },
}
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('관리자 예산 장부', () => {
  it('필수 요약과 경고를 먼저 보여주고 상세 내용은 요청할 때 연다', async () => {
    const fetch = vi.fn().mockResolvedValue(json(page))
    vi.stubGlobal('fetch', fetch)
    render(<MemoryRouter><BudgetOverview onExpired={vi.fn()} refreshKey={0} /></MemoryRouter>)
    expect(await screen.findByText(/이전 평가 2건의 사용량을 확인할 수 없습니다/)).toBeTruthy()
    const remaining = within(screen.getByRole('region', { name: '남은 사용량' }))
    expect(remaining.getByText('지금 남은 한도')).toBeTruthy()
    expect(remaining.getByText('AI 요청')).toBeTruthy()
    expect(remaining.getByText('6회')).toBeTruthy()
    expect(remaining.queryByText('12회')).toBeNull()
    const limits = within(screen.getByRole('region', { name: '설정된 전체 한도' }))
    expect(limits.getByText('12회')).toBeTruthy()
    expect(limits.getByText('24,000토큰')).toBeTruthy()
    expect(limits.getByText('미설정')).toBeTruthy()
    expect(limits.queryByText('6회')).toBeNull()
    expect(remaining.getByText('AI에 보내는 내용')).toBeTruthy()
    expect(remaining.getByText('설정되지 않음')).toBeTruthy()
    expect(remaining.getByText('AI 답변')).toBeTruthy()
    expect(remaining.getByText('12,000토큰')).toBeTruthy()
    const help = screen.getByLabelText('AI 평가 사용 한도 도움말')
    expect(help.closest('details')).toHaveProperty('open', false)
    fireEvent.click(help)
    expect(help.closest('details')).toHaveProperty('open', true)
    expect(screen.getByText(/금액 한도는 아닙니다/)).toBeTruthy()
    expect(screen.getByRole('heading', { name: '전체 사용 한도' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: '하루 평가 한도' })).toBeTruthy()
    const overallRegion = screen.getByRole('region', { name: '전체 사용 한도' })
    const dailyRegion = screen.getByRole('region', { name: '하루 예산 요약' })
    const historyRegion = screen.getByRole('region', { name: '사용·변경 내역' })
    const overall = within(overallRegion)
    const history = within(historyRegion)
    expect(overallRegion.compareDocumentPosition(dailyRegion) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(dailyRegion.compareDocumentPosition(historyRegion) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(overall.queryByText('전체 한도와 사용량 보기')).toBeNull()
    expect(overall.queryByText('사용·예약 내역')).toBeNull()
    expect(within(dailyRegion).queryByText('사용·예약 내역')).toBeNull()
    expect(history.getByText('한도 변경 이력 · 최근 1 / 전체 1건')).toBeTruthy()
    expect(screen.queryByText('평가 사용·변경 기록')).toBeNull()
    expect(within(dailyRegion).getByText(/일별 예산 정보를 확인할 수 없습니다/)).toBeTruthy()
    expect(within(dailyRegion).queryByText('일별 예산 상세 보기')).toBeNull()
    const records = history.getByText('사용·예약 내역')
    expect(records.closest('details')).toHaveProperty('open', false)
    fireEvent.click(records)
    expect(history.getByText('사용·예약 합계')).toBeTruthy()
    const usageSummary = within(history.getByText('사용·예약 합계').parentElement!)
    expect(usageSummary.getByText('6회')).toBeTruthy()
    expect(usageSummary.getByText('미확인·미설정')).toBeTruthy()
    expect(usageSummary.getByText('12,000토큰')).toBeTruthy()
    expect(usageSummary.getByText(/실제 청구 금액은 아닙니다/)).toBeTruthy()
    expect(usageSummary.getByText(/사용량을 확인하지 못한 호출이 1회 있습니다/)).toBeTruthy()
    expect(history.getByText(/확인된 사용량과 아직 정리되지 않은 예약을 합친 값입니다/)).toBeTruthy()
    expect(screen.getByText(/확인되지 않은 이전 평가 사용량은 포함되지 않았습니다/)).toBeTruthy()
    const details = screen.getByText('누적 예산 상세 내역')
    expect(details.closest('details')).toHaveProperty('open', false)
    fireEvent.click(details)
    const confirmed = within(screen.getByRole('heading', { name: '확정 사용량' }).closest('section')!)
    expect(confirmed.getByText('1회')).toBeTruthy()
    expect(confirmed.getByText('100토큰')).toBeTruthy()
    expect(confirmed.getByText('50토큰')).toBeTruthy()
    fireEvent.click(details)
    expect(details.closest('details')).toHaveProperty('open', false)
    expect(within(screen.getByRole('region', { name: '남은 사용량' })).getByText('지금 남은 한도')).toBeTruthy()
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('전체 한도와 남은 양을 각각의 영역에서 구분한다', async () => {
    const current = { ...page, summary: { ...page.summary, input_state: 'enforced',
      limits: { calls: 19, input_tokens: 123447, output_tokens: 7128 },
      allocated: { calls: 18, input_tokens: 28305, output_tokens: 1273 },
      remaining: { calls: 1, input_tokens: 95142, output_tokens: 5855 },
      limits_revision: 'a'.repeat(64), legacy_live_run_count: 0,
    } }
    const fetch = vi.fn().mockResolvedValue(json(current))
    vi.stubGlobal('fetch', fetch)
    render(<MemoryRouter><BudgetOverview onExpired={vi.fn()} refreshKey={0} operatorId="core:81" /></MemoryRouter>)
    const remaining = within(await screen.findByRole('region', { name: '남은 사용량' }))
    const limits = within(screen.getByRole('region', { name: '설정된 전체 한도' }))
    expect(remaining.getByText('1회')).toBeTruthy()
    expect(remaining.getByText('95,142토큰')).toBeTruthy()
    expect(remaining.getByText('5,855토큰')).toBeTruthy()
    expect(remaining.queryByText('19회')).toBeNull()
    expect(remaining.queryByText('123,447토큰')).toBeNull()
    expect(limits.getByText('19회')).toBeTruthy()
    expect(limits.getByText('123,447토큰')).toBeTruthy()
    expect(limits.getByText('7,128토큰')).toBeTruthy()
    expect(limits.queryByText('1회')).toBeNull()
    expect(screen.getByRole('button', { name: '전체 한도 변경하기' })).toHaveProperty('disabled', false)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('하루 한도 중복 수치는 제거하고 이월과 변경 이력은 하루 카드에서 확인한다', async () => {
    const limits = { calls: 10, input_tokens: 1000, output_tokens: 100 }
    const today = { calls: 1, input_tokens: 100, output_tokens: 10 }
    const carried = { calls: 1, input_tokens: 100, output_tokens: 10 }
    const allocated = { calls: 2, input_tokens: 200, output_tokens: 20 }
    const remaining = { calls: 8, input_tokens: 800, output_tokens: 80 }
    const daily = {
      state: 'enforced', timezone: 'Asia/Seoul', period_start: '2026-09-29T00:00:00+09:00', period_end: '2026-09-30T00:00:00+09:00',
      limits, current_day: today, carried, allocated, remaining,
      recent_changes: [{ request_id: id, source: 'CLI', actor: '김 운영자', reason: '하루 한도 조정', expected_revision: null,
        previous: null, policy: { enabled: true, limits }, created_at: time }],
    }
    const fetch = vi.fn().mockResolvedValue(json({ ...page, summary: { ...page.summary, daily } }))
    vi.stubGlobal('fetch', fetch)
    render(<MemoryRouter><BudgetOverview onExpired={vi.fn()} refreshKey={0} /></MemoryRouter>)
    const dailyCard = within(await screen.findByRole('region', { name: '하루 예산 요약' }))
    const help = dailyCard.getByLabelText('하루 평가 한도 도움말')
    expect(help.getAttribute('aria-expanded')).toBe('false')
    expect(dailyCard.queryByText('매일 서울 시간 자정 기준')).toBeNull()
    fireEvent.click(help)
    expect(help.getAttribute('aria-expanded')).toBe('true')
    expect(dailyCard.getByText(/서울 시간 자정부터 다음 날 자정까지 적용됩니다/)).toBeTruthy()
    expect(dailyCard.getByText(/정리되지 않은 이전 예약은 다음 날 한도에 포함될 수 있습니다/)).toBeTruthy()
    expect(within(dailyCard.getByRole('region', { name: '하루 남은 사용량' })).getByText('8회')).toBeTruthy()
    expect(fetch).toHaveBeenCalledTimes(1)
    fireEvent.click(dailyCard.getByText('일별 예산 상세 보기'))
    expect(dailyCard.queryByText('잔여 8회')).toBeNull()
    fireEvent.click(dailyCard.getByText('오늘 접수와 이월 상세'))
    const table = dailyCard.getByRole('table', { name: '일별 한도와 오늘의 할당량 및 이월량' })
    expect(within(table).getByRole('row', { name: '호출 10 1 1 8' })).toBeTruthy()
    fireEvent.click(dailyCard.getByText('일별 정책 변경 이력 · 최근 1건'))
    expect(dailyCard.getByText(/김 운영자 · CLI/)).toBeTruthy()
    expect(dailyCard.getByText('변경 이유: 하루 한도 조정')).toBeTruthy()
    expect(fetch.mock.calls.every(([, options]) => !options.method || options.method === 'GET')).toBe(true)
  })

  it.each([false, true])('하루 한도가 꺼져도 변경 이력 여부 %s에 따라 상세를 제공한다', async (hasHistory) => {
    const limits = { calls: 10, input_tokens: 1000, output_tokens: 100 }
    const change = { request_id: id, source: 'CLI', actor: '김 운영자', reason: '하루 한도 해제', expected_revision: null,
      previous: { enabled: true, limits }, policy: { enabled: false, limits }, created_at: time }
    const daily = {
      state: 'disabled', timezone: 'Asia/Seoul', period_start: '2026-09-29T00:00:00+09:00', period_end: '2026-09-30T00:00:00+09:00',
      limits: null, current_day: null, carried: null, allocated: null, remaining: null,
      recent_changes: hasHistory ? [change] : [],
    }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ ...page, summary: { ...page.summary, daily } })))
    render(<MemoryRouter><BudgetOverview onExpired={vi.fn()} refreshKey={0} /></MemoryRouter>)
    const dailyCard = within(await screen.findByRole('region', { name: '하루 예산 요약' }))
    expect(dailyCard.getByText(/하루 한도 미설정/)).toBeTruthy()
    if (hasHistory) {
      fireEvent.click(dailyCard.getByText('일별 예산 상세 보기'))
      fireEvent.click(dailyCard.getByText('일별 정책 변경 이력 · 최근 1건'))
      expect(dailyCard.getByText(/김 운영자 · CLI/)).toBeTruthy()
      expect(dailyCard.getByText('변경 이유: 하루 한도 해제')).toBeTruthy()
    } else {
      expect(dailyCard.queryByText('일별 예산 상세 보기')).toBeNull()
    }
  })

  it.each(['enforced', 'unknown', 'exceeded'] as const)('하루 한도 %s 상태를 전체 한도와 같은 기준으로 표시한다', async (state) => {
    const limits = { calls: 10, input_tokens: 1000, output_tokens: 100 }
    const used = state === 'exceeded' ? { calls: 11, input_tokens: 200, output_tokens: 20 } : { calls: 2, input_tokens: 200, output_tokens: 20 }
    const zero = { calls: 0, input_tokens: 0, output_tokens: 0 }
    const daily = {
      state, timezone: 'Asia/Seoul', period_start: '2026-09-29T00:00:00+09:00', period_end: '2026-09-30T00:00:00+09:00',
      limits, current_day: state === 'unknown' ? null : used, carried: state === 'unknown' ? null : zero,
      allocated: state === 'unknown' ? null : used,
      remaining: state === 'enforced' ? { calls: 8, input_tokens: 800, output_tokens: 80 } : null,
      recent_changes: [],
    }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ ...page, summary: { ...page.summary, daily } })))
    render(<MemoryRouter><BudgetOverview onExpired={vi.fn()} refreshKey={0} /></MemoryRouter>)
    const dailySummary = within(await screen.findByRole('region', { name: '하루 남은 사용량' }))
    expect(dailySummary.getByText('AI 요청')).toBeTruthy()
    expect(dailySummary.getByText('AI에 보내는 내용')).toBeTruthy()
    expect(dailySummary.getByText('AI 답변')).toBeTruthy()
    expect(dailySummary.getByText('한도 10회')).toBeTruthy()
    expect(dailySummary.getByText('한도 1,000토큰')).toBeTruthy()
    expect(dailySummary.getByText('한도 100토큰')).toBeTruthy()
    if (state === 'enforced') {
      expect(dailySummary.getByText('8회')).toBeTruthy()
      expect(dailySummary.getByText('800토큰')).toBeTruthy()
      expect(dailySummary.getByText('80토큰')).toBeTruthy()
    } else {
      expect(dailySummary.getAllByText('확인할 수 없음')).toHaveLength(3)
      expect(screen.getAllByRole('alert').some((alert) => alert.textContent?.includes('신규 예약이 차단됩니다'))).toBe(true)
    }
  })

  it('입력 한도가 있어도 남은 양을 확인할 수 없으면 미설정으로 표시하지 않는다', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ ...page, summary: { ...page.summary,
      limits: { ...page.summary.limits, input_tokens: 1000 },
      remaining: { ...page.summary.remaining, input_tokens: null },
    } })))
    render(<MemoryRouter><BudgetOverview onExpired={vi.fn()} refreshKey={0} /></MemoryRouter>)
    const remaining = within(await screen.findByRole('region', { name: '남은 사용량' }))
    expect(remaining.getByText('AI에 보내는 내용')).toBeTruthy()
    expect(remaining.getByText('확인할 수 없음')).toBeTruthy()
    expect(remaining.queryByText('설정되지 않음')).toBeNull()
  })

  it('처음 설정할 때 필요한 점검과 설정 순서를 바로 보여주고 조회만 한다', async () => {
    const fetch = vi.fn().mockResolvedValue(json({ ...page, summary: { ...page.summary,
      state: 'unconfigured', input_state: 'legacy_unknown', limits: null, allocated: null, remaining: null, breakdown: null,
      limits_revision: 'a'.repeat(64),
    } }))
    vi.stubGlobal('fetch', fetch)
    render(<MemoryRouter><BudgetOverview onExpired={vi.fn()} refreshKey={0} operatorId="core:81" /></MemoryRouter>)
    const guide = within(await screen.findByRole('region', { name: '예산 설정 순서' }))
    expect(guide.getByText('AI 평가 사용 한도')).toBeTruthy()
    const help = guide.getByLabelText('AI 평가 사용 한도 도움말')
    expect(help.closest('details')).toHaveProperty('open', false)
    fireEvent.click(help)
    expect(help.closest('details')).toHaveProperty('open', true)
    expect(guide.getByText(/전체 한도는 날짜가 바뀌어도 유지됩니다/)).toBeTruthy()
    expect(guide.getByText(/금액 한도는 아닙니다/)).toBeTruthy()
    expect(screen.getByText('아직 사용 한도를 설정하지 않았습니다.')).toBeTruthy()
    expect(screen.getByText('이전 평가의 사용량을 확인해 주세요')).toBeTruthy()
    expect(screen.getByText(/검색·RAG 평가와 정기 평가에 필요한 입력 한도를 설정할 수 없습니다/)).toBeTruthy()
    expect(screen.getByText(/필요한 정보가 없으면 자동으로 반영할 수 없습니다/)).toBeTruthy()
    expect(guide.getByText('아직 사용 한도를 설정하지 않았습니다.')).toBeTruthy()
    const setLimits = guide.getByRole('button', { name: '전체 한도 설정하기' })
    const unaccounted = screen.getByRole('button', { name: '이전 평가 기록 확인하기' })
    expect(setLimits.compareDocumentPosition(unaccounted) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(unaccounted.id).toBe('budget-unaccounted')
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(fetch.mock.calls.every(([, options]) => !options.method || options.method === 'GET')).toBe(true)
  })

  it('관리자 권한이 없으면 설정 버튼 대신 관리자에게 요청하도록 안내한다', async () => {
    const fetch = vi.fn().mockResolvedValue(json({ ...page, summary: { ...page.summary, limits_revision: 'a'.repeat(64) } }))
    vi.stubGlobal('fetch', fetch)
    render(<MemoryRouter><BudgetOverview onExpired={vi.fn()} refreshKey={0} /></MemoryRouter>)
    await screen.findByRole('region', { name: '남은 사용량' })
    const guide = within(screen.getByRole('region', { name: '예산 설정 순서' }))
    expect(guide.getByText('관리자에게 설정을 요청하세요.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /AI 평가 사용량 (설정|변경)하기/ })).toBeNull()
    expect(fetch.mock.calls.every(([, options]) => !options.method || options.method === 'GET')).toBe(true)
  })

  it('한도 변경을 지원하지 않는 서버는 관리자 확인을 안내한다', async () => {
    const fetch = vi.fn().mockResolvedValue(json(page))
    vi.stubGlobal('fetch', fetch)
    render(<MemoryRouter><BudgetOverview onExpired={vi.fn()} refreshKey={0} operatorId="core:81" /></MemoryRouter>)
    await screen.findByRole('region', { name: '남은 사용량' })
    const guide = within(screen.getByRole('region', { name: '예산 설정 순서' }))
    expect(guide.getByText('현재 서버에서 설정을 변경할 수 없습니다. 관리자에게 확인해 주세요.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /AI 평가 사용량 (설정|변경)하기/ })).toBeNull()
    expect(fetch.mock.calls.every(([, options]) => !options.method || options.method === 'GET')).toBe(true)
  })

  it('예산 기록이 불일치하면 설정 전에 불일치를 먼저 확인하도록 안내한다', async () => {
    const fetch = vi.fn().mockResolvedValue(json({ ...page, summary: { ...page.summary,
      state: 'inconsistent', remaining: null, limits_revision: 'a'.repeat(64),
    } }))
    vi.stubGlobal('fetch', fetch)
    render(<MemoryRouter><BudgetOverview onExpired={vi.fn()} refreshKey={0} operatorId="core:81" /></MemoryRouter>)
    await screen.findByText(/저장된 할당량과 상세 장부가 일치하지 않습니다/)
    const guide = within(screen.getByRole('region', { name: '예산 설정 순서' }))
    expect(guide.getByText('사용 기록이 맞지 않아 설정을 변경할 수 없습니다.')).toBeTruthy()
    expect(screen.queryByRole('region', { name: '남은 사용량' })).toBeNull()
    expect(screen.queryByRole('region', { name: '설정된 전체 한도' })).toBeNull()
    expect(screen.getByRole('button', { name: '전체 한도 변경하기' })).toHaveProperty('disabled', true)
    expect(fetch.mock.calls.every(([, options]) => !options.method || options.method === 'GET')).toBe(true)
  })

  it('상세 내용을 접었다 펼쳐도 작성 중인 한도는 유지하고 저장하지 않는다', async () => {
    const fetch = vi.fn(async (url: string, _options?: RequestInit) => json(url.includes('/evaluation-catalog') ? { datasets: [] } : { ...page, summary: { ...page.summary, limits_revision: 'a'.repeat(64) } }))
    vi.stubGlobal('fetch', fetch)
    render(<MemoryRouter><BudgetOverview onExpired={vi.fn()} refreshKey={0} operatorId="core:81" /></MemoryRouter>)
    fireEvent.click(await screen.findByRole('button', { name: '전체 한도 변경하기' }))
    fireEvent.click(screen.getByRole('button', { name: '필요량 확인 없이 직접 입력' }))
    const calls = screen.getByRole('textbox', { name: 'AI 요청 허용 횟수' })
    fireEvent.change(calls, { target: { value: '20' } })
    fireEvent.click(screen.getByText('사용·예약 내역'))
    const details = screen.getByText('누적 예산 상세 내역')
    fireEvent.click(details)
    fireEvent.click(details)
    expect(calls).toHaveProperty('value', '20')
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(fetch.mock.calls.every(([, options]) => !options?.method || options.method === 'GET')).toBe(true)
  })

  it('관리자에게도 최신 예산 조회 실패 시 먼저 새로고침하도록 안내한다', async () => {
    const fetch = vi.fn().mockRejectedValue(new Error('장부 연결 실패'))
    vi.stubGlobal('fetch', fetch)
    render(<MemoryRouter><BudgetOverview onExpired={vi.fn()} refreshKey={0} operatorId="core:81" /></MemoryRouter>)
    await screen.findByRole('alert')
    const guide = within(screen.getByRole('region', { name: '예산 설정 순서' }))
    expect(guide.getByText('현재 상태를 확인하지 못했습니다. 예산을 새로고침해 주세요.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /AI 평가 사용량 (설정|변경)하기/ })).toBeNull()
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('장부 조회가 실패해도 설정의 범위와 평가가 실행되지 않음을 안내한다', async () => {
    const fetch = vi.fn().mockRejectedValue(new Error('장부 연결 실패'))
    vi.stubGlobal('fetch', fetch)
    render(<MemoryRouter><BudgetOverview onExpired={vi.fn()} refreshKey={0} /></MemoryRouter>)
    expect((await screen.findByRole('alert')).textContent).toContain('운영 서버에 연결할 수 없습니다.')
    const guide = within(screen.getByRole('region', { name: '예산 설정 순서' }))
    expect(guide.getByText('관리자에게 설정을 요청하세요.')).toBeTruthy()
    expect(guide.getByLabelText('AI 평가 사용 한도 도움말').closest('details')).toHaveProperty('open', false)
    expect(guide.queryByText('한도를 저장해도 평가는 실행되지 않습니다.')).toBeNull()
    expect(screen.queryByText('한도 계산과 주의사항')).toBeNull()
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(fetch.mock.calls[0][0]).toBe('/api/v1/ops/budget/reservations?page=1')
  })

  it('장부 도움말을 펼쳐도 수치와 예약을 유지하고 별도 요청을 보내지 않는다', async () => {
    const fetch = vi.fn().mockResolvedValue(json(page))
    vi.stubGlobal('fetch', fetch)
    render(<MemoryRouter><BudgetOverview onExpired={vi.fn()} refreshKey={0} /></MemoryRouter>)
    fireEvent.click(await screen.findByText('사용·예약 내역'))
    fireEvent.click(await screen.findByText('누적 예산 상세 내역'))
    const section = screen.getByRole('heading', { name: '아직 승인하지 않은 예약' }).closest('section')!
    const values = within(section).getByText('4회')
    const toggle = within(section).getByLabelText('아직 승인하지 않은 예약 설명')
    expect(toggle.closest('details')).toHaveProperty('open', false)
    fireEvent.click(toggle)
    expect(toggle.closest('details')).toHaveProperty('open', true)
    expect(within(section).getByText(/개별 AI 요청은 아직 승인되지 않은 양입니다/)).toBeTruthy()
    expect(within(section).getByText('4회')).toBe(values)
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(fetch.mock.calls[0][1].method ?? 'GET').toBe('GET')
  })

  it('미반영 목록은 버튼으로 연 뒤에만 조회하고 닫을 수 있다', async () => {
    const fetch = vi.fn(async (url: string) => json(url.includes('unaccounted-runs')
      ? { as_of: time, count: 1, next: null, previous: null, results: [
        { run_id: id, dataset_id: 'legacy', dataset_label: '과거 자료', status: 'COMPLETED', status_label: '완료', created_at: time },
      ] } : page))
    vi.stubGlobal('fetch', fetch)
    render(<MemoryRouter><BudgetOverview onExpired={vi.fn()} refreshKey={0} /></MemoryRouter>)
    const button = await screen.findByRole('button', { name: '이전 평가 기록 확인하기' })
    expect(fetch.mock.calls.some(([url]) => url.includes('unaccounted-runs'))).toBe(false)
    fireEvent.click(button)
    expect(await screen.findByRole('link', { name: '과거 자료 · 10000000' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '이전 평가 기록 닫기' }))
    expect(screen.queryByRole('region', { name: '사용량이 확인되지 않은 평가' })).toBeNull()
  })

  it('과거 사용량은 예약·서명 영수증·품질 승인으로 표시하지 않고 출처를 보여준다', async () => {
    const fetch = vi.fn().mockResolvedValue(json(legacyDetail))
    vi.stubGlobal('fetch', fetch)
    render(<MemoryRouter><RunBudgetPanel runId={id} onExpired={vi.fn()} refreshKey={0} /></MemoryRouter>)
    expect(await screen.findByText(/이전에 저장한 답변에 기록된 AI 호출/)).toBeTruthy()
    const audit = await screen.findByRole('region', { name: '과거 사용량 반영 이력' })
    expect(within(audit).getByText(/저장 응답 사용량: 6회 · 입력 6,834 \/ 출력 689토큰/)).toBeTruthy()
    expect(within(audit).getByText(/당시 예약·서명 영수증·제공자 청구 확인이 아닙니다/)).toBeTruthy()
    expect(within(audit).getByText(/답변 품질 승인과도 별개/)).toBeTruthy()
    expect(screen.queryByText(/예약 상태:/)).toBeNull()
    expect(screen.queryByText(/사용량을 0으로 판단/)).toBeNull()
    expect(fetch.mock.calls.every(([, options]) => !options.method || options.method === 'GET')).toBe(true)
  })

  it.each([
    ['CORE_ADMIN', '변경 이유: 별도 입력 없음'],
    ['CLI', '변경 이유: 자동 생성: AI 평가 사용량 한도 설정'],
  ])('%s에서 저장된 기본 사유를 출처에 맞게 표시한다', async (source, expected) => {
    const change = { ...page.summary.recent_changes[0], source, reason: '자동 생성: AI 평가 사용량 한도 설정' }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ ...page, summary: { ...page.summary, recent_changes: [change] } })))
    render(<MemoryRouter><BudgetOverview onExpired={vi.fn()} refreshKey={0} /></MemoryRouter>)
    fireEvent.click(await screen.findByText('한도 변경 이력 · 최근 1 / 전체 1건'))
    fireEvent.click(screen.getByText('변경 상세 보기'))
    expect(screen.getByText(expected)).toBeTruthy()
  })

  it.each([
    { legacy_usage: undefined },
    { state: 'missing' },
    { reservation },
    { calls: detail.calls },
    { legacy_usage: { ...legacyDetail.legacy_usage, provider_receipt_verified: true } },
    { legacy_usage: { ...legacyDetail.legacy_usage, source: 'WORKER_RESPONSE' } },
    { legacy_usage: { ...legacyDetail.legacy_usage, run_id: '20000000-0000-4000-8000-000000000002' } },
    { legacy_usage: { ...legacyDetail.legacy_usage, after: { calls: 6, input_tokens: 7901, output_tokens: 776 } } },
    { legacy_usage: { ...legacyDetail.legacy_usage, usage: { calls: 6, input_tokens: null, output_tokens: 689 } } },
    { legacy_usage: { ...legacyDetail.legacy_usage, capture_sha256: '' } },
  ])('불완전하거나 모순된 과거 사용량 응답을 거절한다: %j', async (changes) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ ...legacyDetail, ...changes })))
    await expect(getRunBudget(id)).rejects.toThrow()
  })

  it('전체 장부에 과거 저장 응답 몫을 별도 행으로 표시한다', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ ...page, summary: { ...page.summary,
      legacy_accounted_run_count: 2, legacy_live_run_count: 0,
      breakdown: { ...breakdown, legacy_calls: 7, legacy_input_tokens: 7901, legacy_output_tokens: 776 },
    } })))
    render(<MemoryRouter><BudgetOverview onExpired={vi.fn()} refreshKey={0} /></MemoryRouter>)
    fireEvent.click(await screen.findByText('사용·예약 내역'))
    fireEvent.click(await screen.findByText('누적 예산 상세 내역'))
    const pastUsage = within(screen.getByRole('heading', { name: '과거 저장 응답 반영' }).closest('section')!)
    expect(pastUsage.getByText('7회')).toBeTruthy()
    expect(pastUsage.getByText('7,901토큰')).toBeTruthy()
    expect(pastUsage.getByText('776토큰')).toBeTruthy()
    const past = screen.getByText('이전 평가 2건의 사용량 반영')
    expect(past.closest('details')).toHaveProperty('open', false)
    fireEvent.click(past)
    expect(screen.getByText(/저장된 답변에서 확인한 사용량을 현재 한도에 합산했습니다/)).toBeTruthy()
    expect(screen.getByText(/AI를 다시 호출하거나 실제 청구 금액을 확인한 것은 아닙니다/)).toBeTruthy()
    expect(screen.queryByRole('region', { name: '이전 평가 확인' })).toBeNull()
  })

  it('새 호출의 답변 작업을 표시하고 과거 호출의 사례를 추정하지 않는다', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ ...detail, calls: [
      { ...detail.calls[0], operation_id: 'answer:TC01' },
      { ...detail.calls[1], operation_id: null },
    ] })))
    render(<MemoryRouter><RunBudgetPanel runId={id} onExpired={vi.fn()} refreshKey={0} /></MemoryRouter>)
    fireEvent.click(await screen.findByText('AI 요청별 사용량 · 2건'))
    expect(screen.getByText('요청 1 · 답변 생성')).toBeTruthy()
    expect(screen.getByText('작업 식별자: answer:TC01')).toBeTruthy()
    expect(screen.getByText('요청 2 · 작업 종류 기록 없음')).toBeTruthy()
    expect(screen.getByText('작업 식별 기록 없음 · 과거 승인')).toBeTruthy()
    expect(screen.queryByText(/answer:TC02/)).toBeNull()
  })

  it('지원하지 않는 작업 ID가 포함된 장부 응답을 거절한다', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ ...detail, calls: [
      { ...detail.calls[0], operation_id: 'unsupported:TC01' },
    ] })))
    await expect(getRunBudget(id)).rejects.toThrow()
  })

  it('확정·미확인·미승인·반환 대기와 CLI 감사 출처를 구분하고 GET만 사용한다', async () => {
    const fetch = vi.fn().mockResolvedValue(json(page))
    vi.stubGlobal('fetch', fetch)
    render(<MemoryRouter><BudgetOverview onExpired={vi.fn()} refreshKey={0} /></MemoryRouter>)
    fireEvent.click(await screen.findByText('사용·예약 내역'))
    fireEvent.click(await screen.findByText('누적 예산 상세 내역'))
    const cards = [
      ['확정 사용량', '1회', '100토큰', '50토큰'],
      ['승인 후 사용량 미확인', '1회', '확인할 수 없음', '2,000토큰'],
      ['아직 승인하지 않은 예약', '4회', '확인할 수 없음', '8,000토큰'],
      ['종료 전 반환 대기', null, '확인할 수 없음', '1,950토큰'],
    ] as const
    for (const [heading, calls, input, output] of cards) {
      const card = within(screen.getByRole('heading', { name: heading }).closest('section')!)
      if (calls) expect(card.getByText(calls)).toBeTruthy()
      else expect(card.queryByText('AI 요청')).toBeNull()
      expect(card.getByText(input)).toBeTruthy()
      expect(card.getByText(output)).toBeTruthy()
    }
    expect(screen.queryByText('현재 할당량 합계')).toBeNull()
    expect(screen.getByText(/이전 평가 2건의 사용량을 확인할 수 없습니다/)).toBeTruthy()
    fireEvent.click(screen.getByText('한도 변경 이력 · 최근 1 / 전체 1건'))
    const changeRow = screen.getByText(/김 운영자/).closest('li')!
    const change = within(changeRow)
    const changeSummary = within(changeRow.querySelector(':scope > dl')!)
    expect(change.getByText('운영자 직접 입력')).toBeTruthy()
    expect(changeSummary.getByText('미설정 → 12회')).toBeTruthy()
    expect(changeSummary.getByText('미설정 → 24,000토큰')).toBeTruthy()
    expect(changeSummary.queryByText('AI에 보내는 내용')).toBeNull()
    const detail = change.getByText('변경 상세 보기')
    expect(detail.closest('details')).toHaveProperty('open', false)
    fireEvent.click(detail)
    expect(detail.closest('details')).toHaveProperty('open', true)
    expect(within(detail.closest('details')!).getByText('미확인·미설정 → 미확인·미설정')).toBeTruthy()
    expect(change.getByText(/관리자 로그인으로 인증된 신원이 아닙니다/)).toBeTruthy()
    expect(change.getByText('원본 출처: CLI')).toBeTruthy()
    expect(change.getByText('변경 이유: 검토한 수동 평가 한도')).toBeTruthy()
    expect(change.getByText(`요청 ID: ${id}`)).toBeTruthy()
    expect(fetch).toHaveBeenCalledWith('/api/v1/ops/budget/reservations?page=1', expect.objectContaining({ credentials: 'same-origin', cache: 'no-store' }))
    expect(fetch.mock.calls.every(([, options]) => !options.method || options.method === 'GET')).toBe(true)
  })

  it('관리자가 바꾼 한도의 전후 값과 사유를 확인할 수 있다', async () => {
    const change = {
      request_id: id, actor: 'core:99', source: 'CORE_ADMIN', reason: '평가 범위 조정', created_at: time,
      previous_limits: { calls: 2, input_tokens: 100, output_tokens: 10 },
      limits: { calls: 4, input_tokens: 200, output_tokens: 20 },
    }
    const fetch = vi.fn().mockResolvedValue(json({ ...page, summary: { ...page.summary, recent_changes: [change] } }))
    vi.stubGlobal('fetch', fetch)
    render(<MemoryRouter><BudgetOverview onExpired={vi.fn()} refreshKey={0} /></MemoryRouter>)
    fireEvent.click(await screen.findByText('한도 변경 이력 · 최근 1 / 전체 1건'))
    const recordRow = screen.getByText(/core:99/).closest('li')!
    const record = within(recordRow)
    const recordSummary = within(recordRow.querySelector(':scope > dl')!)
    expect(record.getByText('관리자 로그인')).toBeTruthy()
    expect(recordSummary.getByText('2회 → 4회')).toBeTruthy()
    expect(recordSummary.getByText('100토큰 → 200토큰')).toBeTruthy()
    expect(recordSummary.getByText('10토큰 → 20토큰')).toBeTruthy()
    const details = record.getByText('변경 상세 보기')
    expect(details.closest('details')).toHaveProperty('open', false)
    fireEvent.click(details)
    expect(record.getByText('변경 이유: 평가 범위 조정')).toBeTruthy()
    expect(record.getByText(`요청 ID: ${id}`)).toBeTruthy()
    expect(record.getByText(/관리자 세션을 확인한 기록입니다/)).toBeTruthy()
    expect(record.getByText('원본 출처: CORE_ADMIN')).toBeTruthy()
    expect(fetch.mock.calls.every(([, options]) => !options.method || options.method === 'GET')).toBe(true)
  })

  it.each([
    {
      name: '최초 설정의 0과 미설정',
      previous: null,
      limits: { calls: 0, input_tokens: 0, output_tokens: 0 },
      summary: ['미설정 → 0회', '미확인·미설정 → 0토큰', '미설정 → 0토큰'],
      detail: ['미설정 → 0회', '미확인·미설정 → 0토큰', '미설정 → 0토큰'],
    },
    {
      name: '한 항목만 변경',
      previous: { calls: 2, input_tokens: null, output_tokens: 10 },
      limits: { calls: 2, input_tokens: 0, output_tokens: 10 },
      summary: ['미확인·미설정 → 0토큰'],
      detail: ['2회 → 2회', '미확인·미설정 → 0토큰', '10토큰 → 10토큰'],
    },
    {
      name: '변경 없는 0',
      previous: { calls: 0, input_tokens: 0, output_tokens: 0 },
      limits: { calls: 0, input_tokens: 0, output_tokens: 0 },
      summary: [],
      detail: ['0회 → 0회', '0토큰 → 0토큰'],
    },
  ])('$name은 변경된 항목만 요약하고 모든 항목은 상세에서 확인한다', async ({ previous, limits, summary, detail }) => {
    const change = { request_id: id, actor: 'core:99', source: 'CORE_ADMIN', reason: '확인용', created_at: time, previous_limits: previous, limits }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ ...page, summary: { ...page.summary, recent_changes: [change] } })))
    render(<MemoryRouter><BudgetOverview onExpired={vi.fn()} refreshKey={0} /></MemoryRouter>)
    fireEvent.click(await screen.findByText('한도 변경 이력 · 최근 1 / 전체 1건'))
    const row = screen.getByText(/core:99/).closest('li')!
    const summaryList = row.querySelector(':scope > dl')
    if (summary.length) {
      expect(summaryList).toBeTruthy()
      const visibleSummary = within(summaryList as HTMLElement)
      for (const value of summary) expect(visibleSummary.getByText(value)).toBeTruthy()
      expect(summaryList!.querySelectorAll('dt')).toHaveLength(summary.length)
    } else {
      expect(summaryList).toBeNull()
      expect(within(row).getByText('한도 값 변경 없음')).toBeTruthy()
    }
    const detailToggle = within(row).getByText('변경 상세 보기')
    expect(detailToggle.closest('details')).toHaveProperty('open', false)
    fireEvent.click(detailToggle)
    const detailPanel = within(detailToggle.closest('details')!)
    for (const value of detail) expect(detailPanel.getAllByText(value).length).toBeGreaterThan(0)
    const detailList = detailToggle.closest('details')!.querySelector('dl')!
    expect(detailList.querySelectorAll('dt')).toHaveLength(3)
  })

  it('페이지 내역과 전체 합계를 혼동하지 않고 다음 예약 페이지를 조회한다', async () => {
    const fetch = vi.fn(async (url: string) => json({ ...page, count: 26,
      next: url.endsWith('page=1') ? '/api/v1/ops/budget/reservations?page=2' : null,
      previous: url.endsWith('page=2') ? '/api/v1/ops/budget/reservations?page=1' : null,
    }))
    vi.stubGlobal('fetch', fetch)
    render(<MemoryRouter><BudgetOverview onExpired={vi.fn()} refreshKey={0} /></MemoryRouter>)
    fireEvent.click(await screen.findByText('사용·예약 내역'))
    const reservations = await screen.findByRole('region', { name: '평가별 내역' })
    expect(within(reservations).getByRole('heading', { name: '평가별 내역 · 26건' })).toBeTruthy()
    const link = within(reservations).getByRole('link', { name: /평가 상세 보기 .* 10000000/ })
    expect(link.getAttribute('href')).toBe('/ops/evaluations/10000000-0000-4000-8000-000000000001')
    expect(link.textContent).toBe('평가 상세 보기')
    expect(link.getAttribute('title')).toBe('검토 자료')
    const row = link.closest('tr')!
    expect(row.textContent).toContain('예약 유지 중')
    expect(row.textContent).toContain('6회 · 12,000토큰')
    expect(row.textContent).toContain('1회')
    const next = within(reservations).getByRole('button', { name: '예약 다음' })
    expect(next.closest('details')).toBe(screen.getByText('사용·예약 내역').closest('details'))
    fireEvent.click(next)
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))
    expect(fetch.mock.calls[1][0]).toBe('/api/v1/ops/budget/reservations?page=2')
    expect(await screen.findByText(/확인된 사용량과 아직 정리되지 않은 예약을 합친 값입니다/)).toBeTruthy()
    expect(screen.getByText('사용·예약 내역').closest('details')).toHaveProperty('open', true)
    expect(screen.getByRole('heading', { name: '평가별 내역 · 26건' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '예약 다음' })).toHaveProperty('disabled', true)
  })

  it('종료된 예약의 미확인 호출과 알 수 없는 시각을 숨기지 않는다', async () => {
    const fetch = vi.fn().mockResolvedValue(json({
      ...page, results: [{ ...reservation, created_at: 'invalid-date', closed_at: time }],
    }))
    vi.stubGlobal('fetch', fetch)
    render(<MemoryRouter><BudgetOverview onExpired={vi.fn()} refreshKey={0} /></MemoryRouter>)
    fireEvent.click(await screen.findByText('사용·예약 내역'))
    const list = within(screen.getByRole('region', { name: '평가별 내역' }))
    const link = list.getByRole('link', { name: '평가 상세 보기 · 시각 확인 불가 · 10000000' })
    expect(link.getAttribute('href')).toBe('/ops/evaluations/10000000-0000-4000-8000-000000000001')
    const cells = within(link.closest('tr')!).getAllByRole('cell')
    expect(cells[1].textContent).toBe('예약 종료')
    expect(cells[3].textContent).toBe('1회')
    expect(list.queryByText('Invalid Date')).toBeNull()
    expect(fetch.mock.calls.every(([, options]) => !options.method || options.method === 'GET')).toBe(true)
  })

  it.each(['unconfigured', 'inconsistent'] as const)('%s 상태는 잔여 한도를 0으로 표시하지 않는다', async (state) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ ...page, summary: { ...page.summary, state, remaining: null,
      ...(state === 'unconfigured' ? { limits: null, allocated: null, breakdown: null } : {}),
    } })))
    render(<MemoryRouter><BudgetOverview onExpired={vi.fn()} refreshKey={0} /></MemoryRouter>)
    expect(await screen.findByText(state === 'unconfigured' ? /아직 사용 한도를 설정하지 않았습니다/ : /상세 장부가 일치하지 않습니다/)).toBeTruthy()
    expect(screen.queryByText('0회 · 0토큰')).toBeNull()
    fireEvent.click(screen.getByText('사용·예약 내역'))
    expect(screen.getByText('사용·예약 합계를 확인할 수 없습니다.').getAttribute('role')).toBe('alert')
  })

  it('누적 한도가 없어도 과거 입력 미확인 경고를 숨기지 않는다', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ ...page, summary: { ...page.summary,
      state: 'unconfigured', input_state: 'legacy_unknown', limits: null, allocated: null, remaining: null, breakdown: null,
    } })))
    render(<MemoryRouter><BudgetOverview onExpired={vi.fn()} refreshKey={0} /></MemoryRouter>)
    expect(await screen.findByText('아직 사용 한도를 설정하지 않았습니다.')).toBeTruthy()
    expect(screen.getByText('이전 평가의 사용량을 확인해 주세요')).toBeTruthy()
    expect(screen.queryByText(/호출·출력 한도만 적용됩니다/)).toBeNull()
  })

  it('미반영 실행이 없더라도 입력 사용량 미확인을 알리고 없는 버튼으로 안내하지 않는다', async () => {
    const fetch = vi.fn().mockResolvedValue(json({ ...page, summary: { ...page.summary,
      input_state: 'legacy_unknown', legacy_live_run_count: 0,
    } }))
    vi.stubGlobal('fetch', fetch)
    render(<MemoryRouter><BudgetOverview onExpired={vi.fn()} refreshKey={0} /></MemoryRouter>)
    expect(await screen.findByText('이전 평가의 사용량을 확인해 주세요')).toBeTruthy()
    expect(screen.getByText(/관리자에게 사용 기록 확인을 요청하세요/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: '이전 평가 기록 확인하기' })).toBeNull()
    expect(fetch.mock.calls.every(([, options]) => !options.method || options.method === 'GET')).toBe(true)
  })

  it('예약 기록이 없는 과거 실행을 무료 실행으로 해석하지 않는다', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ as_of: time, state: 'missing', reservation: null, calls: [] })))
    render(<RunBudgetPanel runId={id} onExpired={vi.fn()} refreshKey={0} />)
    expect(await screen.findByText(/사용량이 없다는 뜻은 아니에요/)).toBeTruthy()
    expect(screen.queryByRole('table')).toBeNull()
  })

  it('확인된 사용량과 미확인 호출을 먼저 보여주고 상세 장부는 접는다', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(detail)))
    render(<RunBudgetPanel runId={id} onExpired={vi.fn()} refreshKey={0} />)
    const summary = (await screen.findByRole('heading', { name: '확인된 AI 사용량' })).closest<HTMLDivElement>('div.rounded-xl')!
    const usage = within(summary)
    expect(usage.getByText('확인된 AI 호출').nextElementSibling?.textContent).toBe('1회')
    expect(usage.getByText('AI에 보낸 양').nextElementSibling?.textContent).toBe('100토큰')
    expect(usage.getByText('AI가 출력한 양').nextElementSibling?.textContent).toBe('50토큰')
    const help = usage.getByRole('button', { name: '확인된 AI 사용량 도움말' })
    expect(help.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(help)
    expect(help.getAttribute('aria-expanded')).toBe('true')
    expect(usage.getByText(/실제 청구 금액은 별도로 확인/)).toBeTruthy()
    expect(screen.getByText(/사용량을 확인하지 못한 호출이 1회/)).toBeTruthy()
    const disclosure = screen.getByText('사용량과 확보해 둔 한도')
    expect(disclosure.closest('details')).toHaveProperty('open', false)
    fireEvent.click(disclosure)
    const actual = within(screen.getByRole('region', { name: '확인된 사용량' }))
    expect(actual.getByText('1회')).toBeTruthy()
    expect(actual.getByText('100토큰')).toBeTruthy()
    expect(actual.getByText('50토큰')).toBeTruthy()
    const uncertain = within(screen.getByRole('region', { name: '사용량이 확인되지 않은 요청' }))
    expect(uncertain.getByText('확인할 수 없음')).toBeTruthy()
    expect(uncertain.getByText('2,000토큰')).toBeTruthy()
    expect(within(screen.getByRole('region', { name: '아직 요청하지 않아 확보한 양' })).getByText('8,000토큰')).toBeTruthy()
    expect(within(screen.getByRole('region', { name: '정리 후 돌려놓을 양' })).getByText('1,950토큰')).toBeTruthy()
    expect(within(screen.getByRole('region', { name: '한도에 반영된 전체' })).getByText('12,000토큰')).toBeTruthy()
  })

  it('닫힌 예약도 미확인 호출을 표시하고 정산된 0토큰과 구분한다', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ ...detail, reservation: { ...reservation, closed_at: time },
      calls: [{ ...detail.calls[0], output_tokens: 0 }, detail.calls[1]],
    })))
    render(<RunBudgetPanel runId={id} onExpired={vi.fn()} refreshKey={0} />)
    expect(await screen.findByText(/예약 상태: 정리됨/)).toBeTruthy()
    fireEvent.click(screen.getByText('AI 요청별 사용량 · 2건'))
    const first = within(screen.getByText('요청 1 · 작업 종류 기록 없음').closest('li')!)
    expect(first.getByText('사용량 확인됨')).toBeTruthy()
    expect(first.getByText('0토큰')).toBeTruthy()
    const second = within(screen.getByText('요청 2 · 작업 종류 기록 없음').closest('li')!)
    expect(second.getByText('사용량 미확인')).toBeTruthy()
    expect(second.getAllByText('확인할 수 없음')).toHaveLength(2)
    expect(screen.getByText(/예약이 닫혀도 해당 호출의 최대 출력 몫은 유지/)).toBeTruthy()
  })

  it('갱신 실패에는 마지막 조회 기록과 오류를 함께 유지한다', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(json(page)).mockRejectedValue(new Error('offline')))
    render(<MemoryRouter><BudgetOverview onExpired={vi.fn()} refreshKey={0} /></MemoryRouter>)
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    fireEvent.click(screen.getByText('사용·예약 내역'))
    fireEvent.click(screen.getByText('누적 예산 상세 내역'))
    const confirmed = () => within(screen.getByRole('heading', { name: '확정 사용량' }).closest('section')!)
    expect(confirmed().getByText('100토큰')).toBeTruthy()
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000) })
    expect(screen.getAllByRole('alert').some((alert) => alert.textContent?.includes('마지막 조회 기록'))).toBe(true)
    expect(confirmed().getByText('100토큰')).toBeTruthy()
  })

  it('종료 정리의 반환분·미확인 유지분·근거를 읽기 전용으로 표시한다', async () => {
    const fetch = vi.fn().mockResolvedValue(json({ ...detail, reservation: { ...reservation, closed_at: time }, cleanup: cleanupRecord }))
    vi.stubGlobal('fetch', fetch)
    render(<RunBudgetPanel runId={id} onExpired={vi.fn()} refreshKey={0} />)
    const audit = await screen.findByRole('region', { name: '종료 예약 정리 이력' })
    expect(within(audit).getByText('반환: 4회 · 9,950출력 토큰')).toBeTruthy()
    expect(within(audit).getByText('유지된 미확인 몫: 1회 · 2,000출력 토큰')).toBeTruthy()
    expect(within(audit).getByText(/종료 근거: Prefect FAILED/)).toBeTruthy()
    expect(within(audit).getByText(/실제 결제 환불이나 미확인 사용량 보정이 아니며/)).toBeTruthy()
    expect(within(audit).queryByRole('button')).toBeNull()
    expect(fetch.mock.calls.every(([, options]) => !options.method || options.method === 'GET')).toBe(true)
  })

  it.each(['active', 'wrong-run', 'not-closed', 'wrong-total'])('확인할 수 없는 정리 근거 %s는 거절한다', async (scenario) => {
    const body = { ...detail, reservation: { ...reservation, closed_at: scenario === 'not-closed' ? null : time },
      cleanup: { ...cleanupRecord, evidence: { ...cleanupRecord.evidence,
        ...(scenario === 'active' ? { state_type: 'RUNNING' } : {}),
        ...(scenario === 'wrong-run' ? { run_id: '20000000-0000-4000-8000-000000000002' } : {}),
      }, ...(scenario === 'wrong-total' ? { after: { ...cleanupRecord.after, global_output_tokens: 0 } } : {}) },
    }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(body)))
    await expect(getRunBudget(id)).rejects.toThrow('운영 서버 응답을 확인할 수 없습니다.')
  })

  it('보정된 사용량과 원본 미정산 기록을 구분하고 증거·차액 이력을 GET으로 조회한다', async () => {
    const fetch = vi.fn().mockResolvedValue(json(correctedDetail))
    vi.stubGlobal('fetch', fetch)
    render(<RunBudgetPanel runId={id} onExpired={vi.fn()} refreshKey={0} />)
    const audit = await screen.findByRole('region', { name: '사용량 보정 이력' })
    expect(within(audit).getByText('확인 사용량: 입력 100 / 출력 50토큰')).toBeTruthy()
    expect(within(audit).getByText('예약 차액 반환: 1,950출력 토큰 · 호출 횟수 유지')).toBeTruthy()
    expect(within(audit).getByText(/증거 SHA-256/)).toBeTruthy()
    fireEvent.click(screen.getByText('AI 요청별 사용량 · 2건'))
    expect(screen.getByText('보정 기록으로 확인됨')).toBeTruthy()
    expect(screen.getByText(/원본 정산은 받지 못했으며/)).toBeTruthy()
    const corrected = within(screen.getByText('요청 2 · 작업 종류 기록 없음').closest('li')!)
    expect(corrected.getByText('100토큰')).toBeTruthy()
    expect(corrected.getByText('50토큰')).toBeTruthy()
    expect(corrected.queryByText('사용량 미확인')).toBeNull()
    fireEvent.click(screen.getByText('사용량과 확보해 둔 한도'))
    const confirmed = within(screen.getByRole('region', { name: '확인된 사용량' }))
    expect(confirmed.getByText('2회')).toBeTruthy()
    expect(confirmed.getByText('100토큰')).toBeTruthy()
    expect(confirmed.getByText('200토큰')).toBeTruthy()
    expect(within(audit).queryByRole('button')).toBeNull()
    expect(fetch.mock.calls.every(([, options]) => !options.method || options.method === 'GET')).toBe(true)
  })

  it('아직 승인된 요청이 없으면 빈 목록을 명확히 안내한다', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ ...detail, calls: [] })))
    render(<RunBudgetPanel runId={id} onExpired={vi.fn()} refreshKey={0} />)
    fireEvent.click(await screen.findByText('AI 요청별 사용량 · 0건'))
    expect(screen.getByText('아직 승인된 요청 기록이 없어요.')).toBeTruthy()
  })

  it.each(['wrong-run', 'wrong-call', 'settled', 'open', 'duplicate', 'wrong-delta', 'over-cap', 'fake-source'])('잘못된 사용량 보정 계약 %s를 거절한다', async (scenario) => {
    const record = { ...correction,
      ...(scenario === 'wrong-run' ? { run_id: '20000000-0000-4000-8000-000000000002' } : {}),
      ...(scenario === 'wrong-call' ? { sequence: 9 } : {}),
      ...(scenario === 'settled' ? { sequence: 0 } : {}),
      ...(scenario === 'wrong-delta' ? { after: { ...correction.after, global_output_tokens: 0 } } : {}),
      ...(scenario === 'over-cap' ? { output_tokens: 2001 } : {}),
      ...(scenario === 'fake-source' ? { source: 'MANUAL' } : {}),
    }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ ...correctedDetail,
      reservation: { ...correctedDetail.reservation, closed_at: scenario === 'open' ? null : time },
      corrections: scenario === 'duplicate' ? [record, record] : [record],
    })))
    await expect(getRunBudget(id)).rejects.toThrow('운영 서버 응답을 확인할 수 없습니다.')
  })

  it.each([401, 403])('권한 오류 %s에는 세션을 재확인한다', async (status) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({}, status)))
    const expired = vi.fn()
    render(<MemoryRouter><BudgetOverview onExpired={expired} refreshKey={0} /></MemoryRouter>)
    await waitFor(() => expect(expired).toHaveBeenCalledOnce())
    expect(screen.queryByRole('table')).toBeNull()
  })

  it('정산 시각만 있고 토큰이 없는 잘못된 응답은 거절한다', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ ...detail, calls: [{ ...detail.calls[0], output_tokens: null }] })))
    await expect(getRunBudget(id)).rejects.toThrow('운영 서버 응답을 확인할 수 없습니다.')
  })
})

it.each(['enforced', 'legacy_unknown', 'unconfigured'] as const)('누적 입력 %s 상태와 잔여 토큰을 구분한다', async (input_state) => {
  const unknown = input_state === 'legacy_unknown'
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ ...page, summary: { ...page.summary,
    input_state, legacy_live_run_count: 0,
    limits: { ...page.summary.limits, input_tokens: input_state === 'enforced' ? 300000 : null },
    allocated: { ...page.summary.allocated, input_tokens: unknown ? null : 196608 },
    remaining: { ...page.summary.remaining, input_tokens: input_state === 'enforced' ? 103392 : null },
    breakdown: { ...breakdown, unbounded_input_calls: unknown ? 1 : 0, unbounded_input_reservations: 0,
      unknown_input_tokens: 32768, unapproved_input_tokens: 131072, pending_release_input_tokens: 32668, allocated_input_tokens: 196608 },
  } })))
  render(<MemoryRouter><BudgetOverview onExpired={vi.fn()} refreshKey={0} /></MemoryRouter>)
  expect(await screen.findByText(input_state === 'enforced' ? '103,392토큰'
    : input_state === 'legacy_unknown' ? '이전 평가의 사용량을 확인해 주세요' : /입력 한도가 설정되지 않았습니다/)).toBeTruthy()
  fireEvent.click(screen.getByText('사용·예약 내역'))
  fireEvent.click(screen.getByText('누적 예산 상세 내역'))
  const usageSummary = within(screen.getByText('사용·예약 합계').parentElement!)
  expect(usageSummary.getByText(unknown ? '미확인·미설정' : '196,608토큰')).toBeTruthy()
  const unknownCard = within(screen.getByRole('heading', { name: '승인 후 사용량 미확인' }).closest('section')!)
  expect(unknownCard.getByText(unknown ? '확인할 수 없음' : '32,768토큰')).toBeTruthy()
  if (input_state === 'enforced') expect(within(screen.getByRole('region', { name: '남은 사용량' })).getByText('103,392토큰')).toBeTruthy()
})

it('입력 보정 차액 불일치와 예약 상한 초과 사용량을 거절한다', async () => {
  const bounded = { ...correctedDetail, reservation: { ...correctedDetail.reservation, max_input_tokens: 32768 },
    corrections: [{ ...correction, before: { ...correction.before, global_input_tokens: 32868, reservation_input_tokens: 32868 },
      after: { ...correction.after, global_input_tokens: 200, reservation_input_tokens: 200 } }] }
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(bounded)))
  expect((await getRunBudget(id)).reservation?.max_input_tokens).toBe(32768)
  for (const changed of [
    { ...bounded.corrections[0], after: { ...bounded.corrections[0].after, global_input_tokens: 100 } },
    { ...bounded.corrections[0], input_tokens: 32769 },
  ]) {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ ...bounded, corrections: [changed] })))
    await expect(getRunBudget(id)).rejects.toThrow()
  }
})


it('임베딩 승인과 답변의 개별 상한을 표시한다', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ ...detail, calls: [
    { ...detail.calls[0], operation_id: 'document_embedding:D1:0', max_input_tokens: 120, max_output_tokens: 0 },
    { ...detail.calls[1], operation_id: 'answer:E01', max_input_tokens: 32768, max_output_tokens: 2000 },
  ] })))
  render(<RunBudgetPanel runId={id} onExpired={vi.fn()} refreshKey={0} />)
  fireEvent.click(await screen.findByText('AI 요청별 사용량 · 2건'))
  expect(screen.getByText('요청 1 · 문서 검색 준비')).toBeTruthy()
  expect(screen.getByText('작업 식별자: document_embedding:D1:0')).toBeTruthy()
  expect(screen.getByText('한 번의 요청에 허용한 최대량: 입력 120토큰 / 출력 0토큰')).toBeTruthy()
  expect(screen.getByText('한 번의 요청에 허용한 최대량: 입력 32,768토큰 / 출력 2,000토큰')).toBeTruthy()
})

const embeddingCorrection = {
  ...correction, source: 'WORKER_EMBEDDING_RESPONSE', response_id: null,
  provider_request_id: 'req_embedding_first', output_tokens: 0,
  before: { ...correction.before, global_input_tokens: 1000, reservation_input_tokens: 1000,
    global_output_tokens: 0, reservation_output_tokens: 0, unknown_calls: 2, unknown_output_tokens: 0 },
  after: { ...correction.after, global_input_tokens: 600, reservation_input_tokens: 600,
    global_output_tokens: 0, reservation_output_tokens: 0, unknown_calls: 1, unknown_output_tokens: 0 },
}
const correctedEmbedding = {
  ...correctedDetail,
  reservation: { ...correctedDetail.reservation, max_input_tokens: 32768 },
  calls: [{ ...detail.calls[1], operation_id: 'document_embedding:D1:0', max_input_tokens: 500, max_output_tokens: 0 }],
  corrections: [embeddingCorrection],
}

it('임베딩 보정은 실제 요청 ID와 입력 차액을 표시하고 GET만 사용한다', async () => {
  const fetch = vi.fn().mockResolvedValue(json(correctedEmbedding))
  vi.stubGlobal('fetch', fetch)
  render(<RunBudgetPanel runId={id} onExpired={vi.fn()} refreshKey={0} />)
  const audit = await screen.findByRole('region', { name: '사용량 보정 이력' })
  expect(within(audit).getByText(/임베딩 요청: req_embedding_first/)).toBeTruthy()
  expect(within(audit).getByText(/입력 차액 반환: 400토큰/)).toBeTruthy()
  expect(within(audit).getByText('확인 사용량: 입력 100 / 출력 0토큰')).toBeTruthy()
  expect(within(audit).queryByText(/응답:/)).toBeNull()
  expect(within(audit).queryByRole('button')).toBeNull()
  expect(fetch.mock.calls.every(([, options]) => !options.method || options.method === 'GET')).toBe(true)
})

it('서로 다른 임베딩 요청은 null 응답 ID가 같아도 조회할 수 있다', async () => {
  const second = { ...embeddingCorrection, sequence: 2, request_id: '20000000-0000-4000-8000-000000000002',
    provider_request_id: 'req_embedding_second', before: embeddingCorrection.after,
    after: { ...embeddingCorrection.after, global_input_tokens: 200, reservation_input_tokens: 200, unknown_calls: 0 } }
  const body = { ...correctedEmbedding, calls: [...correctedEmbedding.calls,
    { ...correctedEmbedding.calls[0], sequence: 2, operation_id: 'query_embedding:E01:0' }],
    corrections: [embeddingCorrection, second] }
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(body)))
  expect((await getRunBudget(id)).corrections).toHaveLength(2)
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ ...body,
    corrections: [embeddingCorrection, { ...second, provider_request_id: embeddingCorrection.provider_request_id }],
  })))
  await expect(getRunBudget(id)).rejects.toThrow()
})

it.each(['missing-id', 'fake-response', 'answer-source', 'answer-call', 'legacy-call', 'output', 'input-delta', 'missing-input'])('잘못된 임베딩 보정 %s를 거절한다', async (fault) => {
  const record = { ...embeddingCorrection,
    ...(fault === 'missing-id' ? { provider_request_id: undefined } : {}),
    ...(fault === 'fake-response' ? { response_id: 'resp_invented' } : {}),
    ...(fault === 'answer-source' ? { source: 'WORKER_RESPONSE' } : {}),
    ...(fault === 'output' ? { output_tokens: 1 } : {}),
    ...(fault === 'input-delta' ? { after: { ...embeddingCorrection.after, global_input_tokens: 601, reservation_input_tokens: 601 } } : {}),
    ...(fault === 'missing-input' ? {
      before: { ...embeddingCorrection.before, global_input_tokens: undefined, reservation_input_tokens: undefined },
      after: { ...embeddingCorrection.after, global_input_tokens: undefined, reservation_input_tokens: undefined },
    } : {}),
  }
  const call = { ...correctedEmbedding.calls[0],
    ...(fault === 'answer-call' ? { operation_id: 'answer:E01' } : {}),
    ...(fault === 'legacy-call' ? { max_input_tokens: undefined, max_output_tokens: undefined } : {}),
  }
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ ...correctedEmbedding, calls: [call], corrections: [record] })))
  await expect(getRunBudget(id)).rejects.toThrow()
})
