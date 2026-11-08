import { useId, useState, type ReactNode } from 'react'

export function EvaluationHelp({ label, title, children }: { label: string; title: ReactNode; children: ReactNode }) {
  const id = useId()
  const [open, setOpen] = useState(false)

  return <div className="min-w-0">
    <div className="flex min-w-0 items-center gap-1">
      <div className="min-w-0 flex-1">{title}</div>
      <button type="button" aria-label={`${label} 도움말`} aria-expanded={open} aria-controls={open ? id : undefined} onClick={() => setOpen((value) => !value)} className="flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-primary"><span aria-hidden="true" className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-brand-primary text-sm font-semibold text-brand-primary">?</span></button>
    </div>
    {open && <div id={id} className="mt-1 min-w-0 rounded-xl border border-line bg-surface-muted p-4 text-sm leading-6 text-ink [overflow-wrap:anywhere]">{children}</div>}
  </div>
}
