import { act, fireEvent, render, screen } from '@testing-library/react-native'
import { PanResponder, type GestureResponderEvent, type PanResponderGestureState } from 'react-native'
import { FloatingAssistantButton } from './FloatingAssistantButton'

let callbacks: Parameters<typeof PanResponder.create>[0]
const event = {} as GestureResponderEvent
beforeEach(() => { jest.useFakeTimers(); jest.spyOn(PanResponder, 'create').mockImplementation(value => { callbacks = value; return { panHandlers: {} } }) })
afterEach(() => { jest.useRealTimers(); jest.restoreAllMocks() })
function setup() {
  const open = jest.fn(), move = jest.fn()
  render(<FloatingAssistantButton bounds={{ width: 390, minY: 96, maxY: 540 }} position={{ edge: 'right', height: .9 }} onOpen={open} onMove={move} />)
  return { open, move }
}
test('a short tap opens, while a held drag snaps and does not call the assistant', () => {
  const { open, move } = setup()
  act(() => { callbacks.onPanResponderGrant?.(event, {} as PanResponderGestureState); callbacks.onPanResponderRelease?.(event, {} as PanResponderGestureState) })
  expect(open).toHaveBeenCalledTimes(1)
  act(() => { callbacks.onPanResponderGrant?.(event, {} as PanResponderGestureState); jest.advanceTimersByTime(350); callbacks.onPanResponderMove?.(event, { dx: -500, dy: -200 } as PanResponderGestureState); callbacks.onPanResponderRelease?.(event, {} as PanResponderGestureState) })
  expect(open).toHaveBeenCalledTimes(1)
  expect(move).toHaveBeenCalledWith(expect.objectContaining({ edge: 'left' }))
})
test('a terminated gesture neither opens the assistant nor saves an incomplete drag', () => {
  const { open, move } = setup()
  act(() => { callbacks.onPanResponderGrant?.(event, {} as PanResponderGestureState); jest.advanceTimersByTime(350); callbacks.onPanResponderMove?.(event, { dx: -300, dy: 30 } as PanResponderGestureState); callbacks.onPanResponderTerminate?.(event, {} as PanResponderGestureState) })
  expect(open).not.toHaveBeenCalled(); expect(move).not.toHaveBeenCalled()
})
test('screen reader actions can move the button without using a drag gesture', () => {
  const { open, move } = setup()
  fireEvent(screen.getByLabelText('GovBiz 도우미 열기'), 'accessibilityAction', { nativeEvent: { actionName: 'moveLeft' } })
  expect(move).toHaveBeenCalledWith({ edge: 'left', height: .9 })
  fireEvent(screen.getByLabelText('GovBiz 도우미 열기'), 'accessibilityTap')
  expect(open).toHaveBeenCalledTimes(1)
})
