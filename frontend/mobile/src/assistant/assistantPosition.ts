import * as SecureStore from 'expo-secure-store'
import { z } from 'zod'

export const assistantButtonSize = 58
export type AssistantBounds = { width: number; minY: number; maxY: number }
export type AssistantPosition = { edge: 'left' | 'right'; height: number }
export const defaultAssistantPosition: AssistantPosition = { edge: 'right', height: .94 }
const positionSchema = z.object({ edge: z.enum(['left', 'right']), height: z.number().finite().min(0).max(1) })
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))

export function assistantPoint(position: AssistantPosition, bounds: AssistantBounds) {
  const minY = bounds.minY, maxY = Math.max(minY, bounds.maxY)
  return { x: position.edge === 'left' ? 12 : Math.max(12, bounds.width - assistantButtonSize - 12), y: minY + clamp(position.height, 0, 1) * (maxY - minY) }
}
export function clampAssistantPoint(point: { x: number; y: number }, bounds: AssistantBounds) {
  return { x: clamp(point.x, 12, Math.max(12, bounds.width - assistantButtonSize - 12)), y: clamp(point.y, bounds.minY, Math.max(bounds.minY, bounds.maxY)) }
}
export function snapAssistantPosition(point: { x: number; y: number }, bounds: AssistantBounds): AssistantPosition {
  return { edge: point.x + assistantButtonSize / 2 < bounds.width / 2 ? 'left' : 'right',
    height: clamp((point.y - bounds.minY) / (bounds.maxY - bounds.minY || 1), 0, 1) }
}
function positionKey(api: string, email: string) {
  return `govbiz.assistant.position.${Array.from(`${api}|${email.toLowerCase()}`).map(char => char.codePointAt(0)!.toString(16).padStart(6, '0')).join('')}`
}
let storageWork: Promise<void> = Promise.resolve()
export async function readAssistantPosition(api: string, email: string): Promise<AssistantPosition> {
  await storageWork.catch(() => undefined)
  const value = await SecureStore.getItemAsync(positionKey(api, email))
  if (value === null) return { ...defaultAssistantPosition }
  return positionSchema.parse(JSON.parse(value))
}
export function saveAssistantPosition(api: string, email: string, position: AssistantPosition): Promise<void> {
  storageWork = storageWork.catch(() => undefined).then(() => SecureStore.setItemAsync(positionKey(api, email), JSON.stringify(positionSchema.parse(position))))
  return storageWork
}
