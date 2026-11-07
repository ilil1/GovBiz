import { useEffect, useMemo, useRef, useState } from 'react'
import { Animated, PanResponder, Platform, StyleSheet, Text, type PanResponderGestureState } from 'react-native'
import { AppIcon } from '../components/AppIcon'
import { colors } from '../ui'
import { assistantButtonSize, assistantPoint, clampAssistantPoint, snapAssistantPosition, type AssistantBounds, type AssistantPosition } from './assistantPosition'

export function FloatingAssistantButton({ bounds, position, onOpen, onMove, onMoveStart }: {
  bounds: AssistantBounds; position: AssistantPosition; onOpen(): void; onMove(position: AssistantPosition): void; onMoveStart?(): void
}) {
  const current = useRef(assistantPoint(position, bounds))
  const animated = useRef(new Animated.ValueXY(current.current)).current
  const hold = useRef<ReturnType<typeof setTimeout> | null>(null)
  const gesture = useRef<{ start: { x: number; y: number }; delta: { x: number; y: number }; moving: boolean; displaced: boolean } | null>(null)
  const [moving, setMoving] = useState(false)
  const update = (point: { x: number; y: number }) => { current.current = point; animated.setValue(point) }
  useEffect(() => {
    if (hold.current) clearTimeout(hold.current)
    gesture.current = null; setMoving(false); update(assistantPoint(position, bounds))
  }, [position, bounds, animated])
  useEffect(() => () => { if (hold.current) clearTimeout(hold.current) }, [])
  const pan = useMemo(() => {
    function move(state: PanResponderGestureState) {
      const active = gesture.current
      if (!active) return
      active.delta = { x: state.dx, y: state.dy }
      if (Math.hypot(state.dx, state.dy) > 8) active.displaced = true
      if (Platform.OS === 'web' && active.displaced && !active.moving) { active.moving = true; onMoveStart?.(); setMoving(true) }
      if (active.moving) update(clampAssistantPoint({ x: active.start.x + state.dx, y: active.start.y + state.dy }, bounds))
    }
    function finish(cancelled = false) {
      if (hold.current) clearTimeout(hold.current)
      const active = gesture.current; gesture.current = null; setMoving(false)
      if (!active) return
      if (!cancelled && active.moving) {
        const snapped = snapAssistantPosition(current.current, bounds)
        update(assistantPoint(snapped, bounds)); onMove(snapped)
      } else {
        update(assistantPoint(position, bounds))
        if (!cancelled && !active.displaced) onOpen()
      }
    }
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        gesture.current = { start: current.current, delta: { x: 0, y: 0 }, moving: false, displaced: false }
        hold.current = setTimeout(() => {
          const active = gesture.current
          if (!active) return
          active.moving = true; onMoveStart?.(); setMoving(true)
          update(clampAssistantPoint({ x: active.start.x + active.delta.x, y: active.start.y + active.delta.y }, bounds))
        }, 320)
      },
      onPanResponderMove: (_event, state) => move(state),
      onPanResponderRelease: () => finish(),
      onPanResponderTerminate: () => finish(true),
      onPanResponderTerminationRequest: () => false,
    })
  }, [bounds, position, onOpen, onMove, onMoveStart, animated])
  return <Animated.View {...pan.panHandlers} testID="assistant-floating-button" accessible accessibilityRole="button"
    accessibilityLabel="GovBiz 도우미 열기" accessibilityHint="길게 누른 뒤 끌어서 위치를 옮길 수 있어요"
    onAccessibilityTap={onOpen} accessibilityActions={[{ name: 'activate', label: '도우미 열기' },
      { name: 'moveLeft', label: '왼쪽으로 이동' }, { name: 'moveRight', label: '오른쪽으로 이동' },
      { name: 'increment', label: '아래로 이동' }, { name: 'decrement', label: '위로 이동' }]}
    onAccessibilityAction={({ nativeEvent: { actionName } }) => {
      if (actionName === 'activate') onOpen()
      else onMove({ edge: actionName === 'moveLeft' ? 'left' : actionName === 'moveRight' ? 'right' : position.edge,
        height: Math.max(0, Math.min(1, position.height + (actionName === 'increment' ? .08 : actionName === 'decrement' ? -.08 : 0))) })
    }} style={[local.button, moving && local.moving, { transform: animated.getTranslateTransform() }]}>
    <AppIcon name="message" color={colors.surface} size={24} /><Text maxFontSizeMultiplier={1.2} style={local.label}>도우미</Text>
  </Animated.View>
}
const local = StyleSheet.create({
  button: { position: 'absolute', top: 0, left: 0, width: assistantButtonSize, height: assistantButtonSize, borderRadius: 20,
    backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', gap: 3,
    elevation: 5, shadowColor: colors.text, shadowOpacity: .18, shadowOffset: { width: 0, height: 4 }, shadowRadius: 8 },
  moving: { elevation: 9, shadowOpacity: .3 }, label: { color: colors.surface, fontSize: 11, fontWeight: '600' },
})
