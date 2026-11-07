import { useState } from 'react'
import { Keyboard, Platform, StyleSheet, type KeyboardEvent, type KeyboardEventName } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react-native'
import { assistantOrigin } from '../assistant/assistantNavigation'
import { AssistantScreen } from './AssistantScreen'

type KeyboardListener = (event: KeyboardEvent) => void
let listeners: Map<KeyboardEventName, Set<KeyboardListener>>
const onSend = jest.fn()

beforeEach(() => {
  listeners = new Map()
  onSend.mockReset()
  jest.spyOn(Keyboard, 'isVisible').mockReturnValue(false)
  jest.mocked(useSafeAreaInsets).mockReturnValue({ top: 44, bottom: 34, left: 0, right: 0 })
  const subscribe = Keyboard.addListener.bind(Keyboard)
  jest.spyOn(Keyboard, 'addListener').mockImplementation((name, listener) => {
    const subscription = subscribe(name, listener)
    const callbacks = listeners.get(name) ?? new Set<KeyboardListener>()
    callbacks.add(listener); listeners.set(name, callbacks)
    const remove = subscription.remove.bind(subscription)
    subscription.remove = () => { callbacks.delete(listener); remove() }
    return subscription
  })
})
afterEach(() => { cleanup(); jest.restoreAllMocks() })

function AssistantHost() {
  const [draft, setDraft] = useState('')
  return <AssistantScreen origin={assistantOrigin('/', {})} messages={[]} draft={draft} onDraft={setDraft} onSend={onSend}
    onClose={jest.fn()} onStop={jest.fn()} onReset={jest.fn()} onHelp={jest.fn()} busy={false} error={null} retryRemaining={0}
    aiEnabled showHelp actionsFor={() => ({ actions: [], invalid: false })} onNavigate={jest.fn()} />
}
const containerStyle = () => StyleSheet.flatten(screen.getByTestId('assistant-keyboard-container').props.style)
const safeAreaHeight = () => StyleSheet.flatten(screen.getByTestId('assistant-bottom-safe-area').props.style).height
async function keyboard(visible: boolean) {
  const name = Platform.OS === 'ios' ? visible ? 'keyboardWillShow' : 'keyboardWillHide'
    : visible ? 'keyboardDidShow' : 'keyboardDidHide'
  const coordinates = { screenX: 0, screenY: visible ? 480 : 832, width: 360, height: visible ? 352 : 0 }
  const event = { duration: 0, easing: 'keyboard', startCoordinates: coordinates, endCoordinates: coordinates, isEventFromThisApp: true } as KeyboardEvent
  await act(async () => { listeners.get(name)?.forEach(callback => callback(event)) })
}

test.each(['ios', 'android'] as const)('%s removes the bottom inset above the keyboard and restores it without sending or losing the draft', async os => {
  jest.replaceProperty(Platform, 'OS', os)
  render(<AssistantHost />)
  await act(async () => {
    fireEvent(screen.getByTestId('assistant-keyboard-container'), 'layout', { persist: jest.fn(),
      nativeEvent: { layout: { x: 0, y: 0, width: 360, height: 832 } } })
  })
  expect(safeAreaHeight()).toBe(38)
  fireEvent.changeText(screen.getByLabelText('도우미 질문'), '작성 중인 질문\n다음 줄도 유지')
  await keyboard(true)
  await waitFor(() => {
    expect(safeAreaHeight()).toBe(0)
    if (os === 'ios') expect(containerStyle().paddingBottom).toBe(352)
    else expect(containerStyle()).toMatchObject({ height: 480, flex: 0 })
  })
  await keyboard(false)
  expect(safeAreaHeight()).toBe(38)
  if (os === 'ios') expect(containerStyle().paddingBottom).toBe(0)
  else expect(containerStyle().height).toBeUndefined()
  expect(screen.getByDisplayValue('작성 중인 질문\n다음 줄도 유지')).toBeTruthy()
  expect(onSend).not.toHaveBeenCalled()
})
