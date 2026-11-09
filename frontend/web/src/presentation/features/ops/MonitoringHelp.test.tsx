// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { MonitoringHelp } from './MonitoringHelp'

afterEach(cleanup)

function setup() {
  return render(<section aria-label="모니터링 카드">
    <MonitoringHelp label="요청 현황" title={<h2>요청 현황</h2>}>
      <p>기록된 요청의 설명입니다.</p>
    </MonitoringHelp>
    <p>주변 지표</p>
  </section>)
}

describe('모니터링 도움말', () => {
  it('버튼으로 토글하고 설명은 카드 바깥의 별도 레이어에 표시한다', async () => {
    setup()
    const card = screen.getByRole('region', { name: '모니터링 카드' })
    const button = within(card).getByRole('button', { name: '요청 현황 도움말' })
    expect(button.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(button)
    const explanation = await screen.findByText('기록된 요청의 설명입니다.')
    expect(button.getAttribute('aria-expanded')).toBe('true')
    expect(button.getAttribute('aria-controls')).toBe(explanation.parentElement?.id)
    expect(button.getAttribute('aria-describedby')).toBe(explanation.parentElement?.id)
    expect(card.contains(explanation)).toBe(false)
    expect(within(card).getByText('주변 지표')).toBeTruthy()
    await waitFor(() => expect(explanation.parentElement?.style.visibility).toBe('visible'))
    fireEvent.click(button)
    expect(button.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByText('기록된 요청의 설명입니다.')).toBeNull()
  })

  it('도움말 내부 클릭에는 유지하고 외부 클릭에는 닫는다', async () => {
    setup()
    const button = screen.getByRole('button', { name: '요청 현황 도움말' })
    fireEvent.click(button)
    const explanation = await screen.findByText('기록된 요청의 설명입니다.')
    fireEvent.pointerDown(explanation)
    expect(button.getAttribute('aria-expanded')).toBe('true')
    fireEvent.pointerDown(screen.getByText('주변 지표'))
    expect(button.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByText('기록된 요청의 설명입니다.')).toBeNull()
  })

  it('Escape로 닫고 버튼에 포커스를 돌려준다', async () => {
    setup()
    const button = screen.getByRole('button', { name: '요청 현황 도움말' })
    fireEvent.click(button)
    await screen.findByText('기록된 요청의 설명입니다.')
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(button.getAttribute('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(button)
  })

  it('다른 도움말을 선택하면 이전 도움말은 닫힌다', async () => {
    render(<>
      <MonitoringHelp label="첫 번째" title="첫 번째">첫 설명</MonitoringHelp>
      <MonitoringHelp label="두 번째" title="두 번째">두 번째 설명</MonitoringHelp>
    </>)
    const first = screen.getByRole('button', { name: '첫 번째 도움말' })
    const second = screen.getByRole('button', { name: '두 번째 도움말' })
    fireEvent.click(first)
    await screen.findByText('첫 설명')
    fireEvent.pointerDown(second)
    fireEvent.click(second)
    expect(first.getAttribute('aria-expanded')).toBe('false')
    expect(second.getAttribute('aria-expanded')).toBe('true')
    expect(screen.queryByText('첫 설명')).toBeNull()
    expect(await screen.findByText('두 번째 설명')).toBeTruthy()
  })

  it('키보드로 다른 도움말에 포커스를 옮기면 이전 설명을 닫는다', async () => {
    render(<>
      <MonitoringHelp label="첫 번째" title="첫 번째">첫 설명</MonitoringHelp>
      <MonitoringHelp label="두 번째" title="두 번째">두 번째 설명</MonitoringHelp>
    </>)
    const first = screen.getByRole('button', { name: '첫 번째 도움말' })
    const second = screen.getByRole('button', { name: '두 번째 도움말' })
    first.focus()
    fireEvent.click(first)
    await screen.findByText('첫 설명')
    fireEvent.focusIn(second)
    expect(first.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(second)
    expect(await screen.findByText('두 번째 설명')).toBeTruthy()
  })
})
