// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { TraceCoveragePanel } from './TraceCoveragePanel'

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

function setup(features: unknown[]) {
  const fetch = vi.fn(async (path: string) => {
    const query = new URL(path, 'https://govbiz.test').searchParams
    return new Response(JSON.stringify({ from: query.get('from'), to: query.get('to'), features }), { status: 200 })
  })
  vi.stubGlobal('fetch', fetch)
  return fetch
}

it('앱 호출과 추적 번호 기록을 서로 구분한다', async () => {
  const fetch = setup([{ feature: 'AI_SEARCH', calls: 10, linkedCalls: 6 }])
  render(<TraceCoveragePanel onExpired={vi.fn()} />)
  const table = await screen.findByRole('table')
  expect(within(table).getByText('공고 검색')).toBeTruthy()
  expect(within(table).getByText('10건')).toBeTruthy()
  expect(within(table).getByText('6건')).toBeTruthy()
  expect(within(table).getByText('4건')).toBeTruthy()
  const summary = screen.getByLabelText('추적 번호 저장 요약')
  expect(within(summary).getByText('10건')).toBeTruthy()
  expect(within(summary).getByText('6건')).toBeTruthy()
  expect(within(summary).getByText('4건')).toBeTruthy()
  expect(screen.getByText(/미기록 원인은 확인할 수 없습니다/)).toBeTruthy()
  const help = screen.getByRole('button', { name: '추적 번호 저장 현황 도움말' })
  expect(help.getAttribute('aria-expanded')).toBe('false')
  fireEvent.click(help)
  expect(help.getAttribute('aria-expanded')).toBe('true')
  expect(screen.getByText(/번호가 없는 이유는 이 화면에서 구분할 수 없습니다/)).toBeTruthy()
  expect(screen.getByText(/추적 서버에 도착했는지는 별도/)).toBeTruthy()
  fireEvent.change(screen.getByLabelText('연결 현황 기간 (UTC)'), { target: { value: '1' } })
  const query = new URL(fetch.mock.calls.at(-1)![0], 'https://govbiz.test').searchParams
  expect(query.get('from')).toBe(query.get('to'))
})

it('번호 미기록은 각 기능의 차이를 합산하며 0건도 실패 없음으로 단정하지 않는다', async () => {
  setup([{ feature: 'AI_SEARCH', calls: 10, linkedCalls: 6 }, { feature: 'ASSISTANT', calls: 2, linkedCalls: 2 }])
  render(<TraceCoveragePanel onExpired={vi.fn()} />)
  const summary = await screen.findByLabelText('추적 번호 저장 요약')
  expect(within(summary).getByText('12건')).toBeTruthy()
  expect(within(summary).getByText('4건')).toBeTruthy()
  expect(screen.getByText(/추적 서버에 도착했는지는 별도/)).toBeTruthy()
})

it('잘못된 집계를 정상 수치로 표시하지 않는다', async () => {
  setup([{ feature: 'AI_SEARCH', calls: 1, linkedCalls: 2 }])
  render(<TraceCoveragePanel onExpired={vi.fn()} />)
  expect(await screen.findByRole('alert')).toBeTruthy()
  expect(screen.queryByRole('table')).toBeNull()
})

it('기록이 없어도 실제 호출이 없었다고 단정하지 않는다', async () => {
  setup([])
  render(<TraceCoveragePanel onExpired={vi.fn()} />)
  expect(await screen.findByText(/실제 호출이 없었다는 뜻은 아닙니다/)).toBeTruthy()
})

it('기능이 기록되지 않은 호출을 구분해 보여준다', async () => {
  setup([{ calls: 2, linkedCalls: 0 }])
  render(<TraceCoveragePanel onExpired={vi.fn()} />)
  expect(await screen.findByText('기능 미기록')).toBeTruthy()
})
