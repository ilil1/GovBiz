import { act, fireEvent, render, screen } from '@testing-library/react-native'
import { AppState, Keyboard, Platform, StyleSheet, Text } from 'react-native'
import { SafeAreaProvider, useSafeAreaInsets, type EdgeInsets } from 'react-native-safe-area-context'
import { useAuth } from '../auth/session'
import { assistantUseCase } from '../api/assistant'
import { Button } from '../ui'
import { AssistantProvider } from './AssistantProvider'
import { useAssistant } from './context'
import { defaultAssistantPosition, readAssistantPosition } from './assistantPosition'

// Keep the actual provider and hook so native measurement events update the nearest context.
jest.mock('react-native-safe-area-context', () => jest.requireActual('react-native-safe-area-context'))
jest.mock('expo-router', () => ({ usePathname: () => '/', useGlobalSearchParams: () => ({}), useRouter: () => ({ navigate: jest.fn() }) }))
jest.mock('../auth/session', () => ({ useAuth: jest.fn() }))
jest.mock('../api/assistant', () => ({ ...jest.requireActual('../api/assistant'), assistantUseCase: jest.fn() }))
jest.mock('../api/client', () => ({ ...jest.requireActual('../api/client'), getApiBaseUrl: () => 'https://api.example.test' }))
jest.mock('./assistantPosition', () => ({ ...jest.requireActual('./assistantPosition'), readAssistantPosition: jest.fn(), saveAssistantPosition: jest.fn() }))
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(), setItemAsync: jest.fn() }))

const originalAI = process.env.EXPO_PUBLIC_ASSISTANT_AI_ENABLED
const execute = jest.fn()
const frame = { x: 0, y: 0, width: 360, height: 832 }
const appInsets: EdgeInsets = { top: 44, bottom: 40, left: 0, right: 0 }

beforeEach(() => {
  process.env.EXPO_PUBLIC_ASSISTANT_AI_ENABLED = 'true'
  Object.defineProperty(AppState, 'currentState', { value: 'active', configurable: true, writable: true })
  jest.spyOn(Keyboard, 'isVisible').mockReturnValue(false)
  jest.mocked(useAuth).mockReturnValue({ status: 'signedIn', session: { accessToken: 'owner', expiresAt: '2099-01-01T00:00:00Z',
    account: { email: 'owner@example.test', company: null } }, invalidateSession: jest.fn() } as unknown as ReturnType<typeof useAuth>)
  execute.mockReset()
  jest.mocked(assistantUseCase).mockReturnValue({ execute } as unknown as ReturnType<typeof assistantUseCase>)
  jest.mocked(readAssistantPosition).mockResolvedValue(defaultAssistantPosition)
})
afterEach(() => {
  if (originalAI === undefined) delete process.env.EXPO_PUBLIC_ASSISTANT_AI_ENABLED
  else process.env.EXPO_PUBLIC_ASSISTANT_AI_ENABLED = originalAI
  jest.restoreAllMocks()
})

function Probe() {
  const assistant = useAssistant(), insets = useSafeAreaInsets()
  return <><Button label="도우미 열기 테스트" onPress={assistant.open} /><Text testID="app-bottom-inset">{insets.bottom}</Text></>
}
const bottomInset = () => StyleSheet.flatten(screen.getByTestId('assistant-bottom-safe-area').props.style).height
const topInset = () => StyleSheet.flatten(screen.getByTestId('assistant-keyboard-container').props.style).paddingTop
async function measure(provider: string, insets: EdgeInsets) {
  await act(async () => { fireEvent(screen.getByTestId(provider), 'insetsChange', { nativeEvent: { insets, frame } }) })
}

test.each(['ios', 'android'] as const)('%s follows modal measurements independently of the app and preserves the conversation and draft', async os => {
  jest.replaceProperty(Platform, 'OS', os)
  render(<SafeAreaProvider testID="app-safe-area-provider" initialMetrics={{ frame, insets: appInsets }}>
    <AssistantProvider><Probe /></AssistantProvider>
  </SafeAreaProvider>)
  fireEvent.press(screen.getByLabelText('도우미 열기 테스트'))
  await act(async () => undefined)
  fireEvent.press(screen.getByLabelText('검색이 왜 바로 안 되나요?'))
  fireEvent.changeText(screen.getByLabelText('도우미 질문'), '안전 영역이 바뀌어도 유지할 질문')

  await measure('assistant-modal-safe-area-provider', { top: 0, bottom: 0, left: 0, right: 0 })
  expect(bottomInset()).toBe(4)
  expect(topInset()).toBe(0)
  expect(screen.getByTestId('app-bottom-inset').props.children).toBe(40)

  await measure('assistant-modal-safe-area-provider', { top: 24, bottom: 16, left: 0, right: 0 })
  expect(bottomInset()).toBe(20)
  expect(topInset()).toBe(24)
  await measure('app-safe-area-provider', { ...appInsets, bottom: 48 })
  expect(bottomInset()).toBe(20)
  expect(screen.getByTestId('app-bottom-inset').props.children).toBe(48)
  await measure('assistant-modal-safe-area-provider', { top: 24, bottom: 24, left: 0, right: 0 })
  expect(bottomInset()).toBe(28)
  expect(screen.getByDisplayValue('안전 영역이 바뀌어도 유지할 질문')).toBeTruthy()
  expect(screen.getByText(/AI가 정리한 조건을 확인한 뒤/)).toBeTruthy()
  expect(execute).not.toHaveBeenCalled()
})
