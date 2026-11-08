import { useEffect, useRef, useState } from 'react'
import { z } from 'zod'
import { workspacePageStyles as styles } from '../../shared/workspace/WorkspacePage.styles'

const count = z.number().int().nonnegative()
const seconds = z.number().finite().nonnegative().nullable()
const metricsSchema = z.object({
  from_time: z.iso.datetime({ offset: true }), to_time: z.iso.datetime({ offset: true }),
  scope: z.literal('observed-root-traces'),
  results: z.array(z.object({
    name: z.enum(['search.total', 'evidence.total', 'assistant.total']),
    observed: count, completed: count, in_progress: count, errors: count, warnings: count,
    latency_samples: count, missing_latency: count, p50_seconds: seconds, p95_seconds: seconds,
  })),
})
type Metrics = z.infer<typeof metricsSchema>
const labels: Record<string, string> = { 'search.total': '공고 검색', 'evidence.total': '공고 근거 답변', 'assistant.total': 'AI 도우미' }
const duration = (value: number | null) => value === null ? '기록 없음' : `${value.toLocaleString('ko-KR', { maximumFractionDigits: 3 })}초`

export function TraceMetricsPanel({ onExpired }: { onExpired: () => void }) {
  const [days, setDays] = useState('7')
  const [range, setRange] = useState('7')
  const [revision, setRevision] = useState(0)
  const [data, setData] = useState<Metrics | null>(null)
  const [error, setError] = useState('')
  const expiry = useRef(onExpired); expiry.current = onExpired
  useEffect(() => {
    const controller = new AbortController()
    const end = new Date()
    const query = new URLSearchParams({ from_time: new Date(end.getTime() - Number(range) * 86_400_000).toISOString(), to_time: end.toISOString() })
    setData(null); setError('')
    fetch(`/api/v1/ops/trace-metrics?${query}`, { credentials: 'same-origin', cache: 'no-store', signal: controller.signal })
      .then(async (response) => {
        if (response.status === 401 || response.status === 403) { expiry.current(); return }
        if (!response.ok) throw new Error('집계를 불러오지 못했습니다.')
        const parsed = metricsSchema.safeParse(await response.json())
        if (!parsed.success) throw new Error('집계 응답을 확인하지 못했습니다.')
        if (!controller.signal.aborted) setData(parsed.data)
      }).catch(() => { if (!controller.signal.aborted) setError('실행 집계를 불러오지 못했습니다. 잠시 후 다시 조회해 주세요.') })
    return () => controller.abort()
  }, [range, revision])
  return <section className={styles.card} aria-label="추적된 실행 집계">
    <h2 className={styles.cardTitle}>추적된 실행 집계</h2>
    <p className="text-sm text-ink-muted">Langfuse에 수집된 검색·근거 답변·도우미의 시작 단계만 집계합니다. 추적되지 않았거나 전송이 누락된 요청은 포함되지 않으므로 전체 사용자 요청의 실패율이 아닙니다.</p>
    <p className="text-sm text-ink-muted">환경별 필터가 없어 같은 프로젝트의 개발·운영 추적이 함께 포함될 수 있습니다.</p>
    <form className="flex flex-wrap items-end gap-3" onSubmit={(event) => { event.preventDefault(); setRange(days); setRevision((value) => value + 1) }}>
      <label className="grid gap-1 text-sm">집계 기간<select value={days} onChange={(event) => setDays(event.target.value)} className="min-h-11 rounded-xl border border-line bg-white px-3">
        <option value="1">최근 24시간</option><option value="7">최근 7일</option><option value="30">최근 30일</option>
      </select></label>
      <button className={styles.secondaryButton}>집계 조회</button>
    </form>
    {error ? <p role="alert">{error}</p> : !data ? <p role="status">실행 집계를 불러오고 있습니다.</p> : <>
      <p className="text-xs text-ink-muted">조회 범위: {new Date(data.from_time).toLocaleString('ko-KR')} ~ {new Date(data.to_time).toLocaleString('ko-KR')} · 최신 추적은 반영이 지연될 수 있습니다.</p>
      <p className="text-xs text-ink-muted">오류·주의는 종료된 실행의 기록 수준 기준입니다. 응답 시간은 종료되고 시간이 기록된 실행만 사용합니다. 미기록은 0초로 계산하지 않습니다.</p>
      {data.results.map((item) => <div key={item.name} className="rounded-xl bg-surface-muted p-3 text-sm">
        <h3 className="font-semibold">{labels[item.name]}</h3>
        <p>관측 {item.observed.toLocaleString('ko-KR')}건 · 종료 {item.completed.toLocaleString('ko-KR')}건 · 진행 중 {item.in_progress.toLocaleString('ko-KR')}건</p>
        <p>오류 {item.errors.toLocaleString('ko-KR')}건 · 종료된 추적 중 오류 비율 {item.completed === 0 ? '미측정' : `${(item.errors * 100 / item.completed).toLocaleString('ko-KR', { maximumFractionDigits: 1 })}%`} · 주의 {item.warnings.toLocaleString('ko-KR')}건</p>
        <p>시간 기록 {item.latency_samples.toLocaleString('ko-KR')}건 · 시간 미기록 {item.missing_latency.toLocaleString('ko-KR')}건 · 중앙값 {duration(item.p50_seconds)} · 상위 95% 지점 {duration(item.p95_seconds)}</p>
      </div>)}
    </>}
  </section>
}
