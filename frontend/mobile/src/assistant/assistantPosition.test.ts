import * as SecureStore from 'expo-secure-store'
import { assistantPoint, clampAssistantPoint, defaultAssistantPosition, readAssistantPosition, saveAssistantPosition, snapAssistantPosition } from './assistantPosition'
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(), setItemAsync: jest.fn() }))
beforeEach(() => { jest.mocked(SecureStore.getItemAsync).mockReset().mockResolvedValue(null); jest.mocked(SecureStore.setItemAsync).mockReset().mockResolvedValue(undefined) })

test('edge placement is normalized across widths and avoids reserved input/footer space', () => {
  const bounds = { width: 390, minY: 96, maxY: 540 }
  expect(clampAssistantPoint({ x: -50, y: 900 }, bounds)).toEqual({ x: 12, y: 540 })
  const position = snapAssistantPosition({ x: 20, y: 318 }, bounds)
  expect(position).toEqual({ edge: 'left', height: .5 })
  expect(assistantPoint(position, { width: 320, minY: 100, maxY: 400 })).toEqual({ x: 12, y: 250 })
  expect(assistantPoint({ edge: 'right', height: 1 }, bounds)).toEqual({ x: 320, y: 540 })
})
test('no stored preference is a first use, while malformed preferences are errors', async () => {
  await expect(readAssistantPosition('https://api.test', 'owner@test')).resolves.toEqual(defaultAssistantPosition)
  jest.mocked(SecureStore.getItemAsync).mockResolvedValue('{"edge":"left","height":2}')
  await expect(readAssistantPosition('https://api.test', 'owner@test')).rejects.toBeInstanceOf(Error)
})
test('positions are isolated by API and account and do not store conversations or tokens', async () => {
  await saveAssistantPosition('https://api.test', 'a@test', { edge: 'left', height: .3 })
  await saveAssistantPosition('https://api.test', 'b@test', { edge: 'right', height: .7 })
  await saveAssistantPosition('https://other.test', 'a@test', { edge: 'right', height: .6 })
  const calls = jest.mocked(SecureStore.setItemAsync).mock.calls
  expect(new Set(calls.map(([key]) => key)).size).toBe(3)
  for (const [key, data] of calls) { expect(key).toMatch(/^[a-zA-Z0-9._-]+$/); expect(Object.keys(JSON.parse(data)).sort()).toEqual(['edge', 'height']) }
})
test('writes serialize and failed storage is not reported as success', async () => {
  jest.mocked(SecureStore.setItemAsync).mockRejectedValueOnce(new Error('storage unavailable'))
  await expect(saveAssistantPosition('https://api.test', 'owner@test', { edge: 'left', height: .2 })).rejects.toThrow('storage unavailable')
  await expect(saveAssistantPosition('https://api.test', 'owner@test', { edge: 'right', height: .9 })).resolves.toBeUndefined()
})
