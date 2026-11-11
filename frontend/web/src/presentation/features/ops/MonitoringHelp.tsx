import { autoUpdate, flip, offset, shift, size, useFloating } from '@floating-ui/react-dom'
import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

/** 모니터링 설명을 주변 지표의 배치를 바꾸지 않고 표시합니다. */
export function MonitoringHelp({ label, title, children, compact = false }: { label: string; title: ReactNode; children: ReactNode; compact?: boolean }) {
  const id = useId()
  const [open, setOpen] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const { refs, floatingStyles, isPositioned } = useFloating({
    open,
    placement: 'bottom-start',
    strategy: 'fixed',
    whileElementsMounted: autoUpdate,
    middleware: [
      offset(8),
      flip({ padding: 8 }),
      shift({ padding: 8 }),
      size({
        padding: 8,
        apply({ availableWidth, availableHeight, elements }) {
          Object.assign(elements.floating.style, {
            maxWidth: `${Math.max(0, availableWidth)}px`,
            maxHeight: `${Math.max(0, availableHeight)}px`,
          })
        },
      }),
    ],
  })

  useEffect(() => {
    if (!open) return
    function closeOnOutsideInteraction(event: PointerEvent | FocusEvent) {
      const target = event.target
      if (target instanceof Node && !buttonRef.current?.contains(target) && !refs.floating.current?.contains(target)) {
        setOpen(false)
      }
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key !== 'Escape') return
      event.preventDefault()
      setOpen(false)
      buttonRef.current?.focus()
    }
    document.addEventListener('pointerdown', closeOnOutsideInteraction)
    document.addEventListener('focusin', closeOnOutsideInteraction)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsideInteraction)
      document.removeEventListener('focusin', closeOnOutsideInteraction)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [open, refs])

  return <div className="min-w-0">
    <div className="flex min-w-0 items-center gap-1">
      <div className={compact ? 'min-w-0' : 'min-w-0 flex-1'}>{title}</div>
      <button ref={(node) => { buttonRef.current = node; refs.setReference(node) }} type="button" aria-label={`${label} 도움말`} aria-expanded={open}
        aria-controls={open ? id : undefined} aria-describedby={open ? id : undefined}
        onClick={() => setOpen((value) => !value)}
        className="flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-primary"><span aria-hidden="true" className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-brand-primary text-sm font-semibold text-brand-primary">?</span></button>
    </div>
    {open && createPortal(<div id={id} ref={refs.setFloating} style={{ ...floatingStyles, visibility: isPositioned ? 'visible' : 'hidden' }}
      className="z-50 w-[22rem] overflow-auto rounded-xl border border-line bg-white p-4 text-sm leading-6 text-ink shadow-lg [overflow-wrap:anywhere]">{children}</div>, document.body)}
  </div>
}
