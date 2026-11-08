import { useEffect, useRef, useState } from 'react'
import { z } from 'zod'
import { workspacePageStyles as styles } from '../../shared/workspace/WorkspacePage.styles'

const count = z.number().int().nonnegative()
const upper = z.number().finite().nonnegative().nullable()
const featureSchema = z.object({
  feature: z.string().min(1), total: count, success: count, accepted: count, clientErrors: count,
  serverErrors: count, other: count, latencySamples: count, p50UpperMs: upper, p95UpperMs: upper,
}).refine((row) => row.total === row.success + row.accepted + row.clientErrors + row.serverErrors + row.other
  && row.latencySamples <= row.total)
const responseSchema = z.object({ from: z.iso.date(), to: z.iso.date(), scope: z.literal('core-http-requests'), features: z.array(featureSchema) })
type Result = z.infer<typeof responseSchema>
const labels: Record<string, string> = {
  AI_SEARCH: '공고 검색', EVIDENCE_QUESTION: '공고 근거 답변', SEARCH_CONVERSATION: '검색 대화',
  ASSISTANT: 'AI 도우미', GOV_AGENT: '관리자 에이전트', APPLICATION_DISCOVERY: '신청 양식 탐색',
  APPLICATION_SECTION: '신청서 문항 작성', APPLICATION_DOCUMENT: '신청 문서 생성', COMBINATION_REVIEW: '중복 지원 검토',
}

function duration(value: number | null, samples: number): string {
  if (!samples) return '미측정'
  return value === null ? '120초 초과' : `${(value / 1000).toLocaleString('ko-KR', { maximumFractionDigits: 3 })}초 이하`
}

export function RequestMetricsPanel({ onExpired }: { onExpired: () => void }) {
  const [days, setDays] = useState('7')
  const [range, setRange] = useState('7')
  const [revision, setRevision] = useState(0)
  const [data, setData] = useState<Result | null>(null)
  const [error, setError] = useState('')
  const expiry = useRef(onExpired); expiry.current = onExpired
  useEffect(() => {
    const controller = new AbortController()
    const end = new Date()
    const today = Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate())
    const from = new Date(today - (Number(range) - 1) * 86_400_000).toISOString().slice(0, 10)
    const to = new Date(today).toISOString().slice(0, 10)
    const query = new URLSearchParams({ from, to })
    setData(null); setError('')
    fetch(`/api/v1/admin/ai-request-metrics?${query}`, { credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]) })
      .then(async (response) => {
        if (response.status === 401 || response.status === 403) { expiry.current(); return }
        if (!response.ok) throw new Error('unavailable')
        const parsed = responseSchema.safeParse(await response.json())
        if (!parsed.success || parsed.data.from !== from || parsed.data.to !== to) throw new Error('invalid')
        if (!controller.signal.aborted) setData(parsed.data)
      }).catch(() => { if (!controller.signal.aborted) setError('HTTP 요청 집계를 불러오지 못했습니다. 잠시 후 다시 조회해 주세요.') })
    return () => controller.abort()
  }, [range, revision])
  return <section className={styles.card} aria-label="AI 기능 HTTP 요청 집계">
    <h2 className={styles.cardTitle}>AI 기능 HTTP 요청 집계</h2>
    <p className="text-sm text-ink-muted">지정된 AI 기능의 Core HTTP 요청 중 기록된 응답을 UTC 날짜로 집계합니다. 저장 실패·프로세스 종료나 Core 이전의 실패는 누락될 수 있습니다. AI 모델 호출 여부나 답변의 품질을 뜻하지 않습니다.</p>
    <p className="text-sm text-ink-muted">접수(202)는 작업 완료가 아닙니다. 클라이언트 오류(4xx)와 서버 오류(5xx)를 나누며, 시간은 고정 구간의 상한으로 계산한 근삿값입니다.</p>
    <form className="flex flex-wrap items-end gap-3" onSubmit={(event) => { event.preventDefault(); setRange(days); setRevision((value) => value + 1) }}>
      <label className="grid gap-1 text-sm">HTTP 집계 기간<select value={days} onChange={(event) => setDays(event.target.value)} className="min-h-11 rounded-xl border border-line bg-white px-3">
        <option value="1">오늘 (UTC)</option><option value="7">최근 7일 (UTC)</option><option value="30">최근 30일 (UTC)</option>
      </select></label>
      <button className={styles.secondaryButton}>HTTP 집계 조회</button>
    </form>
    {error ? <p role="alert">{error}</p> : !data ? <p role="status">HTTP 요청 집계를 불러오고 있습니다.</p> : <>
      <p className="text-xs text-ink-muted">조회 범위: {data.from} ~ {data.to} (UTC) · 기록이 없는 과거 기간은 0건이더라도 실제 요청이 없었다는 뜻이 아닙니다.</p>
      {!data.features.length && <p className="text-sm">기록된 요청이 없습니다.</p>}
      {data.features.map((row) => <div key={row.feature} className="rounded-xl bg-surface-muted p-3 text-sm">
        <h3 className="font-semibold">{labels[row.feature] ?? row.feature}</h3>
        <p>기록 {row.total.toLocaleString('ko-KR')}건 · 응답 성공 {row.success.toLocaleString('ko-KR')}건 · 접수 {row.accepted.toLocaleString('ko-KR')}건</p>
        <p>클라이언트 오류 {row.clientErrors.toLocaleString('ko-KR')}건 · 서버 오류 {row.serverErrors.toLocaleString('ko-KR')}건 · 기록 중 서버 오류 비율 {row.total ? `${(row.serverErrors * 100 / row.total).toLocaleString('ko-KR', { maximumFractionDigits: 1 })}%` : '미측정'} · 기타 {row.other.toLocaleString('ko-KR')}건</p>
        <p>시간 기록 {row.latencySamples.toLocaleString('ko-KR')}건 · 중앙값 {duration(row.p50UpperMs, row.latencySamples)} · 상위 95% 지점 {duration(row.p95UpperMs, row.latencySamples)}</p>
      </div>)}
    </>}
  </section>
}
