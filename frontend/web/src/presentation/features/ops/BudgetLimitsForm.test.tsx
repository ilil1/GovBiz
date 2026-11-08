// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { setBudgetLimits, type BudgetLimitsInput, type BudgetSummary } from '../../../data/ops/opsApi'
import { BudgetLimitsForm } from './BudgetLimitsForm'

const at = '2026-10-03T01:00:00Z'
const owner = 'core:81'
const summary: BudgetSummary = {
  state: 'unconfigured', limits_revision: 'a'.repeat(64), limits: null, allocated: null,
  remaining: null, breakdown: null, reservation_count: 0, legacy_live_run_count: 2,
  change_count: 0, recent_changes: [],
}
const session = { user: { id: owner, username: '관리자' }, csrf_token: 'csrf-test', live_enabled: false, datasets: [] }
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const success = (data: BudgetLimitsInput) => ({ change: {
  request_id: data.request_id, actor: owner, source: 'CORE_ADMIN', reason: data.reason,
  previous_limits: null, limits: { calls: data.calls, output_tokens: data.output_tokens, input_tokens: data.input_tokens }, created_at: at,
} })
const mount = (onSaved = vi.fn(), onExpired = vi.fn(), data = summary) => {
  render(<BudgetLimitsForm summary={data} owner={owner} onSaved={onSaved} onExpired={onExpired} />)
  return { onSaved, onExpired }
}
const fill = () => {
  fireEvent.click(screen.getByRole('button', { name: /AI 평가 사용량 (설정|변경)하기/ }))
  fireEvent.click(screen.getByRole('button', { name: '필요량 확인 없이 직접 입력' }))
  expect(screen.getByText(/필요한 양은 이전 단계에서 확인/)).toBeTruthy()
  fireEvent.change(screen.getByLabelText('AI 요청 허용 횟수'), { target: { value: '7' } })
  fireEvent.change(screen.getByLabelText('AI 답변 허용량 (출력 토큰)'), { target: { value: '776' } })
  fireEvent.change(screen.getByLabelText('한도 변경 사유'), { target: { value: ' 검토한 과거 사용량 한도 ' } })
}
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

const profile = 'b'.repeat(64)
const config = { model: 'test-model', fixture_sha256: 'c'.repeat(64), max_model_calls: 6, max_output_tokens: 25 }
const catalog = { datasets: [{
  id: 'fixed', label: '공고 답변 평가', case_ids: ['Q01'], fixture: 'fixture',
  evaluation_scope: 'fixed-answer-context-only', captures: [{ id: 'capture', label: '기준' }],
  baseline: null, live_config: config, live_options: [{ live_config: config, execution_profile: profile }],
  execution_profiles: { replay: 'a'.repeat(64), live: profile },
}] }
const required = { calls: 6, input_tokens: 100, output_tokens: 50 }
const readiness = { as_of: at, dataset_id: 'fixed', execution_profile: profile,
  evaluation_scope: 'fixed-answer-context-only', model: 'test-model', state: 'blocked',
  required, remaining: null, blockers: [{ code: 'BUDGET_UNCONFIGURED', message: '누적 한도를 설정하세요.' }], warnings: [],
}
const setupPlanning = () => {
  const fetch = vi.fn(async (url: string, _options?: RequestInit) => {
    if (url.includes('/evaluation-catalog')) return json(catalog)
    if (url.includes('/evaluations/live-readiness?')) return json(readiness)
    return json({ detail: '예상하지 못한 요청' }, 500)
  })
  vi.stubGlobal('fetch', fetch)
  return fetch
}
const inspectNeeds = async () => {
  fireEvent.click(screen.getByRole('button', { name: /AI 평가 사용량 (설정|변경)하기/ }))
  expect(screen.getByText('1. 어떤 평가를 할지 고르세요')).toBeTruthy()
  expect(screen.queryByRole('button', { name: '필요한 양 계산하기' })).toBeNull()
  const dataset = await screen.findByRole('combobox', { name: '평가 자료 선택' })
  fireEvent.change(dataset, { target: { value: 'fixed' } })
  fireEvent.change(screen.getByRole('combobox', { name: '평가 모델 선택' }), { target: { value: 'test-model' } })
  fireEvent.click(screen.getByRole('button', { name: '필요량 확인' }))
  await screen.findByText('이번 평가에 필요한 최대 양')
}

describe('관리자 누적 한도 변경', () => {
  it('처음 설정과 기존 설정 변경을 구분해 안내한다', () => {
    const view = render(<BudgetLimitsForm summary={summary} owner={owner} onSaved={vi.fn()} onExpired={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'AI 평가 사용량 설정하기' })).toBeTruthy()
    view.rerender(<BudgetLimitsForm summary={{ ...summary, state: 'consistent', limits: { calls: 10, input_tokens: null, output_tokens: 100 } }} owner={owner} onSaved={vi.fn()} onExpired={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'AI 평가 사용량 변경하기' })).toBeTruthy()
  })
  it('필요한 양 확인과 직접 입력을 단계별로 오가며 입력을 보존한다', async () => {
    setupPlanning()
    mount(vi.fn(), vi.fn(), { ...summary, input_state: 'legacy_unknown' })
    await inspectNeeds()
    expect(screen.queryByRole('textbox', { name: 'AI 요청 허용 횟수' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '확인한 양을 보고 직접 입력' }))
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: '2. 얼마나 사용할지 정하기' }))
    expect(screen.getByText('이번 평가 1회 최대 100토큰')).toBeTruthy()
    expect(screen.getByText('이번 평가 1회 최대 6회')).toBeTruthy()
    expect(screen.getByText('이번 평가 1회 최대 50토큰')).toBeTruthy()
    expect(screen.getByText(/전체 허용량에는 이전 사용량도 포함해야/)).toBeTruthy()
    expect(screen.getByText(/검색·RAG 평가를 실행할 수 없습니다/)).toBeTruthy()
    fireEvent.change(screen.getByLabelText('AI 요청 허용 횟수'), { target: { value: '9' } })
    fireEvent.click(screen.getByRole('button', { name: '이전: 필요한 양 확인' }))
    expect(screen.getByRole('combobox', { name: '평가 자료 선택' })).toHaveProperty('value', 'fixed')
    expect(screen.getByText('이번 평가에 필요한 최대 양')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '확인한 양을 보고 직접 입력' }))
    expect(screen.getByLabelText('AI 요청 허용 횟수')).toHaveProperty('value', '9')
    expect(screen.queryByRole('button', { name: '확인한 한도 저장' })).toBeNull()
  })

  it('평가 자료가 없으면 등록 화면으로 이동할 수 있고 설정을 저장하지 않는다', async () => {
    const fetch = vi.fn(async () => json({ datasets: [] }))
    vi.stubGlobal('fetch', fetch)
    mount()
    fireEvent.click(screen.getByRole('button', { name: /AI 평가 사용량 (설정|변경)하기/ }))
    expect((await screen.findByRole('link', { name: '평가 자료 등록하러 가기' })).getAttribute('href')).toBe('/ops/datasets')
    expect(fetch.mock.calls).toHaveLength(1)
  })

  it('과거 입력 사용량을 모르면 기록 위치와 입력 칸을 비워두는 방법을 안내한다', async () => {
    setupPlanning()
    mount(vi.fn(), vi.fn(), { ...summary, input_state: 'legacy_unknown' })
    fireEvent.click(screen.getByRole('button', { name: /AI 평가 사용량 (설정|변경)하기/ }))
    fireEvent.click(screen.getByRole('button', { name: '필요량 확인 없이 직접 입력' }))
    expect(screen.getByRole('link', { name: '이전 평가 기록으로 이동' }).getAttribute('href')).toBe('#budget-unaccounted')
    expect(screen.getByText(/지금은 이 칸을 비워 두세요/)).toBeTruthy()
    expect(screen.getByLabelText('AI에 보내는 내용 허용량 (입력 토큰)')).toHaveProperty('value', '')
  })

  it('확인할 기록이 없으면 이동할 수 없는 링크 대신 관리자 확인을 안내한다', () => {
    setupPlanning()
    mount(vi.fn(), vi.fn(), { ...summary, input_state: 'legacy_unknown', legacy_live_run_count: 0 })
    fireEvent.click(screen.getByRole('button', { name: /AI 평가 사용량 (설정|변경)하기/ }))
    fireEvent.click(screen.getByRole('button', { name: '필요량 확인 없이 직접 입력' }))
    expect(screen.queryByRole('link', { name: '이전 평가 기록으로 이동' })).toBeNull()
    expect(screen.getByText(/관리자에게 과거 사용 기록 확인을 요청하세요/)).toBeTruthy()
  })

  it('한도가 없는 경우 필요량만 무료로 확인하고 미확인 사용량을 0으로 적용하지 않는다', async () => {
    const fetch = setupPlanning()
    mount(vi.fn(), vi.fn(), { ...summary, input_state: 'legacy_unknown' })
    await inspectNeeds()
    expect(screen.queryByRole('button', { name: '계산한 값으로 입력하고 계속' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '확인한 양을 보고 직접 입력' }))
    expect(screen.getByLabelText('AI 요청 허용 횟수')).toHaveProperty('value', '')
    expect(screen.getByLabelText('AI에 보내는 내용 허용량 (입력 토큰)')).toHaveProperty('value', '')
    expect(screen.getByLabelText('AI 답변 허용량 (출력 토큰)')).toHaveProperty('value', '')
    expect(fetch.mock.calls).toHaveLength(2)
    expect(fetch.mock.calls.every(([url]) => url.includes('/evaluation-catalog') || url.includes('/evaluations/live-readiness?'))).toBe(true)
    expect(fetch.mock.calls.every(([, options]) => !options?.method || options.method === 'GET')).toBe(true)
  })

  it('필요량을 확인해도 자동 저장하지 않고 사용자가 적용할 때 기존 한도를 낮추지 않는다', async () => {
    const fetch = setupPlanning()
    mount(vi.fn(), vi.fn(), { ...summary, state: 'consistent', input_state: 'enforced',
      limits: { calls: 21, input_tokens: 1000, output_tokens: 120 },
      allocated: { calls: 20, input_tokens: 200, output_tokens: 100 },
      remaining: { calls: 1, input_tokens: 800, output_tokens: 20 }, legacy_live_run_count: 0,
    })
    await inspectNeeds()
    expect(screen.getByLabelText('AI 요청 허용 횟수')).toHaveProperty('value', '21')
    fireEvent.click(screen.getByRole('button', { name: '계산한 값으로 입력하고 계속' }))
    expect(screen.getByLabelText('AI 요청 허용 횟수')).toHaveProperty('value', '26')
    expect(screen.getByLabelText('AI에 보내는 내용 허용량 (입력 토큰)')).toHaveProperty('value', '1000')
    expect(screen.getByLabelText('AI 답변 허용량 (출력 토큰)')).toHaveProperty('value', '150')
    expect(screen.getByRole('status').textContent).toContain('아직 저장되지는 않았습니다')
    fireEvent.change(screen.getByLabelText('AI에 보내는 내용 허용량 (입력 토큰)'), { target: { value: '1400' } })
    expect(screen.queryByText(/아직 저장되지는 않았습니다/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '이전: 필요한 양 확인' }))
    fireEvent.click(screen.getByRole('button', { name: '계산한 값으로 입력하고 계속' }))
    expect(screen.getByLabelText('AI에 보내는 내용 허용량 (입력 토큰)')).toHaveProperty('value', '1400')
    expect(fetch.mock.calls).toHaveLength(2)
    expect(screen.queryByRole('button', { name: '확인한 한도 저장' })).toBeNull()
  })

  it('변경 확인 후 입력 수정으로 돌아가도 자료와 무료 점검 결과가 유지된다', async () => {
    const fetch = setupPlanning()
    const { onSaved } = mount(vi.fn(), vi.fn(), { ...summary, state: 'consistent', input_state: 'enforced',
      limits: { calls: 21, input_tokens: 1000, output_tokens: 120 },
      allocated: { calls: 20, input_tokens: 200, output_tokens: 100 },
      remaining: { calls: 1, input_tokens: 800, output_tokens: 20 }, legacy_live_run_count: 0,
    })
    await inspectNeeds()
    fireEvent.click(screen.getByRole('button', { name: '계산한 값으로 입력하고 계속' }))
    fireEvent.change(screen.getByLabelText('한도 변경 사유'), { target: { value: '평가 준비' } })
    fireEvent.click(screen.getByRole('button', { name: '입력 내용 확인' }))
    expect(screen.getByRole('button', { name: '확인한 한도 저장' })).toBeTruthy()
    expect(onSaved).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '입력 수정' }))
    fireEvent.click(screen.getByRole('button', { name: '이전: 필요한 양 확인' }))
    expect(screen.getByRole('combobox', { name: '평가 자료 선택' })).toHaveProperty('value', 'fixed')
    expect(screen.getByRole('combobox', { name: '평가 모델 선택' })).toHaveProperty('value', 'test-model')
    expect(screen.getByText('이번 평가에 필요한 최대 양')).toBeTruthy()
    expect(fetch.mock.calls).toHaveLength(2)
    expect(fetch.mock.calls.every(([, options]) => !options?.method || options.method === 'GET')).toBe(true)
  })

  it('0으로 입력한 한도는 미설정과 구분하여 저장 전에 확인한다', () => {
    const fetch = setupPlanning()
    const { onSaved } = mount()
    fill()
    fireEvent.change(screen.getByLabelText('AI 요청 허용 횟수'), { target: { value: '0' } })
    fireEvent.change(screen.getByLabelText('AI 답변 허용량 (출력 토큰)'), { target: { value: '0' } })
    fireEvent.click(screen.getByRole('button', { name: '입력 내용 확인' }))
    expect(screen.getByText('호출: 미설정 → 0회')).toBeTruthy()
    expect(screen.getByText('출력: 미설정 → 0토큰')).toBeTruthy()
    expect(screen.getByText('입력: 미설정 → 미설정')).toBeTruthy()
    expect(onSaved).not.toHaveBeenCalled()
    expect(fetch.mock.calls.every(([url, options]) => url.endsWith('/evaluation-catalog') && (!options?.method || options.method === 'GET'))).toBe(true)
  })

  it('과거 입력 사용량을 모르면 호출·출력만 계산하고 입력 한도는 건드리지 않는다', async () => {
    const fetch = setupPlanning()
    mount(vi.fn(), vi.fn(), { ...summary, state: 'consistent', input_state: 'legacy_unknown',
      limits: { calls: 21, input_tokens: null, output_tokens: 120 },
      allocated: { calls: 20, input_tokens: null, output_tokens: 100 },
      remaining: { calls: 1, input_tokens: null, output_tokens: 20 },
    })
    await inspectNeeds()
    fireEvent.change(screen.getByLabelText('AI에 보내는 내용 허용량 (입력 토큰)'), { target: { value: '777' } })
    fireEvent.click(screen.getByRole('button', { name: '계산한 값으로 입력하고 계속' }))
    expect(screen.getByLabelText('AI 요청 허용 횟수')).toHaveProperty('value', '26')
    expect(screen.getByLabelText('AI 답변 허용량 (출력 토큰)')).toHaveProperty('value', '150')
    expect(screen.getByLabelText('AI에 보내는 내용 허용량 (입력 토큰)')).toHaveProperty('value', '777')
    expect(fetch.mock.calls).toHaveLength(2)
  })

  it('확인하는 동안 다른 관리자가 한도를 변경하면 이전 결과로 입력하지 못한다', async () => {
    const fetch = setupPlanning(), onSaved = vi.fn(), onExpired = vi.fn()
    const data: BudgetSummary = { ...summary, state: 'consistent', input_state: 'enforced',
      limits: { calls: 21, input_tokens: 1000, output_tokens: 120 },
      allocated: { calls: 20, input_tokens: 200, output_tokens: 100 },
      remaining: { calls: 1, input_tokens: 800, output_tokens: 20 }, legacy_live_run_count: 0,
    }
    const view = render(<BudgetLimitsForm summary={data} owner={owner} onSaved={onSaved} onExpired={onExpired} />)
    await inspectNeeds()
    view.rerender(<BudgetLimitsForm summary={{ ...data, limits_revision: 'd'.repeat(64) }} owner={owner} onSaved={onSaved} onExpired={onExpired} />)
    expect(screen.queryByRole('button', { name: '계산한 값으로 입력하고 계속' })).toBeNull()
    expect(screen.queryByRole('button', { name: '확인한 양을 보고 직접 입력' })).toBeNull()
    expect(screen.getByRole('alert').textContent).toContain('한도 설정이 변경되었습니다')
    expect(screen.getByLabelText('AI 요청 허용 횟수')).toHaveProperty('value', '21')
    expect(fetch.mock.calls).toHaveLength(2)
    expect(onSaved).not.toHaveBeenCalled()
  })

  it('필요량 확인 중 자료를 바꾸면 이전 응답을 입력에 사용하지 않는다', async () => {
    let resolve!: (response: Response) => void
    const pending = new Promise<Response>((done) => { resolve = done })
    const fetch = vi.fn(async (url: string) => url.includes('/evaluation-catalog') ? json(catalog) : pending)
    vi.stubGlobal('fetch', fetch)
    mount(vi.fn(), vi.fn(), { ...summary, state: 'consistent', input_state: 'enforced',
      limits: { calls: 21, input_tokens: 1000, output_tokens: 120 },
      allocated: { calls: 20, input_tokens: 200, output_tokens: 100 },
      remaining: { calls: 1, input_tokens: 800, output_tokens: 20 }, legacy_live_run_count: 0,
    })
    fireEvent.click(screen.getByRole('button', { name: /AI 평가 사용량 (설정|변경)하기/ }))
    const select = await screen.findByRole('combobox', { name: '평가 자료 선택' })
    fireEvent.change(select, { target: { value: 'fixed' } })
    fireEvent.click(screen.getByRole('button', { name: '필요량 확인' }))
    fireEvent.change(select, { target: { value: '' } })
    await act(async () => { resolve(json(readiness)); await pending })
    expect(screen.queryByRole('button', { name: '계산한 값으로 입력하고 계속' })).toBeNull()
    expect(screen.getByLabelText('AI 요청 허용 횟수')).toHaveProperty('value', '21')
    expect(fetch.mock.calls).toHaveLength(2)
  })

  it.each([
    ['AI 요청 허용 횟수', '-1'], ['AI에 보내는 내용 허용량 (입력 토큰)', '1.5'], ['AI 답변 허용량 (출력 토큰)', '9007199254740992'],
  ])('%s에 잘못 입력한 값 %s가 있으면 어떤 항목도 자동 변경하지 않는다', async (label, invalid) => {
    const fetch = setupPlanning()
    mount(vi.fn(), vi.fn(), { ...summary, state: 'consistent', input_state: 'enforced',
      limits: { calls: 21, input_tokens: 1000, output_tokens: 120 },
      allocated: { calls: 20, input_tokens: 200, output_tokens: 100 },
      remaining: { calls: 1, input_tokens: 800, output_tokens: 20 }, legacy_live_run_count: 0,
    })
    await inspectNeeds()
    fireEvent.change(screen.getByLabelText(label), { target: { value: invalid } })
    const labels = ['AI 요청 허용 횟수', 'AI에 보내는 내용 허용량 (입력 토큰)', 'AI 답변 허용량 (출력 토큰)']
    const before = labels.map((name) => (screen.getByLabelText(name) as HTMLInputElement).value)
    fireEvent.click(screen.getByRole('button', { name: '계산한 값으로 입력하고 계속' }))
    expect(labels.map((name) => (screen.getByLabelText(name) as HTMLInputElement).value)).toEqual(before)
    expect(screen.getByRole('alert').textContent).toContain('0 이상의 안전한 정수')
    expect(fetch.mock.calls).toHaveLength(2)
  })

  it('설명은 각 입력에 연결하고 설정 화면을 열거나 값을 입력해도 한도를 저장하지 않는다', () => {
    const fetch = vi.fn(async (_url: string, _options?: RequestInit) => json(catalog)); vi.stubGlobal('fetch', fetch)
    const { onSaved } = mount()
    fireEvent.click(screen.getByRole('button', { name: /AI 평가 사용량 (설정|변경)하기/ }))
    fireEvent.click(screen.getByRole('button', { name: '필요량 확인 없이 직접 입력' }))
    expect(screen.getByText(/현재 20회 할당 \+ 추가 6회 예약 = 호출 한도 26회/)).toBeTruthy()
    expect(screen.getByRole('textbox', { name: 'AI 요청 허용 횟수', description: /API 호출의 총횟수/ })).toHaveProperty('value', '')
    expect(screen.getByRole('textbox', { name: 'AI 답변 허용량 (출력 토큰)', description: /최대 출력량을 합산/ })).toHaveProperty('value', '')
    expect(screen.getByRole('textbox', { name: 'AI에 보내는 내용 허용량 (입력 토큰)', description: /최초 미설정은 빈칸.*한 번 설정하면 해제할 수 없습니다.*숫자 0/ })).toHaveProperty('value', '')
    expect(screen.getByRole('textbox', { name: '한도 변경 사유', description: /평가 목적·범위/ })).toHaveProperty('value', '')
    fireEvent.change(screen.getByLabelText('AI 요청 허용 횟수'), { target: { value: '26' } })
    fireEvent.click(screen.getByRole('button', { name: '닫기' }))
    expect(fetch.mock.calls.every(([url, options]) => url.endsWith('/evaluation-catalog') && (!options?.method || options.method === 'GET'))).toBe(true)
    expect(onSaved).not.toHaveBeenCalled()
  })

  it('한도를 검토한 뒤 다시 수정해도 입력값을 유지하고 저장 전까지 요청하지 않는다', () => {
    const fetch = vi.fn(async (_url: string, _options?: RequestInit) => json(catalog)); vi.stubGlobal('fetch', fetch)
    const { onSaved } = mount()
    fill()
    expect(screen.queryByRole('button', { name: /AI 평가 사용량 (설정|변경)하기/ })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '입력 내용 확인' }))
    expect(screen.getByText('호출: 미설정 → 7회')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '입력 수정' }))
    expect(screen.getByLabelText('AI 요청 허용 횟수')).toHaveProperty('value', '7')
    expect(screen.getByLabelText('AI 답변 허용량 (출력 토큰)')).toHaveProperty('value', '776')
    expect(screen.getByLabelText('한도 변경 사유')).toHaveProperty('value', ' 검토한 과거 사용량 한도 ')
    expect(fetch.mock.calls.every(([url, options]) => url.endsWith('/evaluation-catalog') && (!options?.method || options.method === 'GET'))).toBe(true)
    expect(onSaved).not.toHaveBeenCalled()
  })

  it('변경 내용을 확인한 후에만 세션·CSRF와 한도 버전을 보내고 입력 미설정은 null로 보낸다', async () => {
    const fetch = vi.fn(async (url: string, options?: RequestInit) => json(url.endsWith('/evaluation-catalog') ? catalog : url.endsWith('/session') ? session : success(JSON.parse(options!.body as string))))
    vi.stubGlobal('fetch', fetch)
    const { onSaved } = mount()
    fill()
    fireEvent.click(screen.getByRole('button', { name: '입력 내용 확인' }))
    expect(fetch.mock.calls.every(([url, options]) => url.endsWith('/evaluation-catalog') && (!options?.method || options.method === 'GET'))).toBe(true)
    expect(screen.getByText('호출: 미설정 → 7회')).toBeTruthy()
    expect(screen.getByText('입력: 미설정 → 미설정')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '확인한 한도 저장' }))
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1))
    const [url, options] = fetch.mock.calls.find(([value]) => value.endsWith('/budget/limits'))!
    expect(url).toBe('/api/v1/ops/budget/limits')
    expect(options).toMatchObject({ method: 'POST', headers: { 'X-CSRFToken': 'csrf-test' } })
    expect(JSON.parse(options!.body as string)).toMatchObject({ calls: 7, output_tokens: 776, input_tokens: null, expected_revision: summary.limits_revision, reason: '검토한 과거 사용량 한도' })
  })

  it('응답 유실 후 재시도는 같은 요청 ID와 조회 버전을 유지한다', async () => {
    const writes: BudgetLimitsInput[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, options?: RequestInit) => {
      if (url.endsWith('/evaluation-catalog')) return json(catalog)
      if (url.endsWith('/session')) return json(session)
      const data = JSON.parse(options!.body as string) as BudgetLimitsInput
      writes.push(data)
      if (writes.length === 1) throw new TypeError('응답 유실')
      return json(success(data))
    }))
    const { onSaved } = mount()
    fill(); fireEvent.click(screen.getByRole('button', { name: '입력 내용 확인' }))
    fireEvent.click(screen.getByRole('button', { name: '확인한 한도 저장' }))
    await screen.findByRole('alert')
    expect(onSaved).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: '입력 수정' })).toHaveProperty('disabled', true)
    fireEvent.click(screen.getByRole('button', { name: '확인한 한도 저장' }))
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1))
    expect(writes).toHaveLength(2)
    expect(writes[1]).toEqual(writes[0])
  })

  it('다른 관리자가 먼저 수정한 한도는 자동으로 덮어쓰지 않고 재검토를 안내한다', async () => {
    const fetch = vi.fn(async (url: string) => url.endsWith('/evaluation-catalog') ? json(catalog) : url.endsWith('/session') ? json(session) : json({ code: 'BUDGET_CHANGE_CONFLICT', detail: '최신 한도를 조회하고 다시 검토하세요.' }, 409))
    vi.stubGlobal('fetch', fetch)
    const { onSaved } = mount()
    fill(); fireEvent.click(screen.getByRole('button', { name: '입력 내용 확인' }))
    fireEvent.click(screen.getByRole('button', { name: '확인한 한도 저장' }))
    expect((await screen.findByRole('alert')).textContent).toContain('최신 한도를 조회하고 다시 검토하세요.')
    expect(onSaved).not.toHaveBeenCalled()
    expect(fetch).toHaveBeenCalledTimes(3)
  })

  it.each([null, { id: 'core:82', username: '다른 관리자' }])('검토 도중 세션 소유자가 변경되면 저장하지 않는다: %j', async (user) => {
    const fetch = vi.fn(async (url: string) => url.endsWith('/evaluation-catalog') ? json(catalog) : json({ ...session, user }))
    vi.stubGlobal('fetch', fetch)
    const { onSaved, onExpired } = mount()
    fill(); fireEvent.click(screen.getByRole('button', { name: '입력 내용 확인' }))
    fireEvent.click(screen.getByRole('button', { name: '확인한 한도 저장' }))
    await waitFor(() => expect(onExpired).toHaveBeenCalledTimes(1))
    expect(onSaved).not.toHaveBeenCalled()
    expect(fetch.mock.calls.map(([url]) => url)).toEqual(['/api/v1/ops/evaluation-catalog', '/api/v1/ops/session'])
  })

  it.each(['-1', '1.2', '9007199254740992'])('잘못된 정수 한도 %s는 저장 확인으로 진행하지 않는다', (calls) => {
    mount(); fill()
    fireEvent.change(screen.getByLabelText('AI 요청 허용 횟수'), { target: { value: calls } })
    fireEvent.click(screen.getByRole('button', { name: '입력 내용 확인' }))
    expect(screen.getByRole('alert')).toBeTruthy()
    expect(screen.queryByRole('button', { name: '확인한 한도 저장' })).toBeNull()
  })

  it('한도 버전이 없는 구형 서버와 불일치 장부에서는 수정할 수 없다', () => {
    const { unmount } = render(<BudgetLimitsForm summary={{ ...summary, limits_revision: undefined }} owner={owner} onSaved={vi.fn()} onExpired={vi.fn()} />)
    expect(screen.queryByRole('button')).toBeNull()
    unmount(); mount(vi.fn(), vi.fn(), { ...summary, state: 'inconsistent' })
    expect((screen.getByRole('button', { name: /AI 평가 사용량 (설정|변경)하기/ }) as HTMLButtonElement).disabled).toBe(true)
  })

  it.each([{ source: 'CLI' }, { actor: 'core:82' }, { request_id: '20000000-0000-4000-8000-000000000002' }, { limits: { calls: 999, output_tokens: 776, input_tokens: null } }])('다른 요청이나 인증되지 않은 이력을 저장 성공으로 표시하지 않는다: %j', async (changes) => {
    const data: BudgetLimitsInput = { request_id: '10000000-0000-4000-8000-000000000001', expected_revision: summary.limits_revision!, calls: 7, output_tokens: 776, input_tokens: null, reason: '검토' }
    vi.stubGlobal('fetch', vi.fn(async (url: string) => json(url.endsWith('/session') ? session : { change: { ...success(data).change, ...changes } })))
    await expect(setBudgetLimits(data, owner)).rejects.toThrow()
  })
})
