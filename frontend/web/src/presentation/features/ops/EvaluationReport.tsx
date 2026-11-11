import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router'
import { getEvaluation, getEvaluationReview, getRagMaterial, OpsApiError } from '../../../data/ops/opsApi'
import type { EvaluationRun, RagComparison } from '../../../data/ops/opsApi'
import { WorkspacePageHeader } from '../../shared/workspace/WorkspacePageHeader'
import { workspacePageStyles as styles } from '../../shared/workspace/WorkspacePage.styles'

type Comparison = NonNullable<EvaluationRun['comparison']>
type CaseMaterial = { id: string; question: string; document: string; expected: string; candidate: string | null; reference: string | null }
type Metric = { label: string; description: string; candidate: number | null; reference: number | null; unit?: 'ms' | 'tokens'; candidateCoverage?: string; referenceCoverage?: string }
const percent = (value: number | null) => value === null ? '미측정' : `${Number((value * 100).toFixed(1))}%`
const statusLabel = (value: string) => ({ ANSWERED: '답변 제공', INSUFFICIENT_EVIDENCE: '근거 부족으로 답변 보류' })[value] ?? value
const origins = {
  'synthetic-contract-check': '합성 데이터 · 실제 모델 실행 없음',
  'integration-stub-replay': '테스트 대역의 실행 기록',
  'recorded-live-evaluation': '실제 모델로 생성한 실행 기록',
  'recorded-capture-replay': '저장된 실행 기록 재평가',
}
const ragDescriptions = {
  retrievalRecallAtK: ['근거 검색 재현율', '기대 근거 청크 중 검색 결과에 포함된 비율입니다. 기대 근거가 있는 사례만 측정합니다.'],
  answerCitationRecall: ['답변 인용 재현율', '기대 근거 청크 중 답변이 인용한 비율입니다. 문장의 사실성이나 불필요한 인용까지 평가하지는 않습니다.'],
  answerStatusAccuracy: ['답변 상태 일치율', '답변 제공·근거 부족 판단이 참조 조건과 일치한 비율입니다. 답변 내용 전체의 정확도를 뜻하지 않습니다.'],
} as const
const fixedDescriptions = {
  statusAccuracy: ['답변 상태 일치율', '답변 제공·근거 부족 판단이 참조 조건과 일치한 비율입니다.'],
  referenceCitationRecall: ['답변 인용 재현율', '참조 조건에서 기대한 근거를 답변이 얼마나 인용했는지 나타냅니다.'],
  failureRate: ['실행 실패율', '평가 사례 중 실행 오류가 기록된 비율입니다. 낮을수록 실행 오류가 적습니다.'],
  missingRate: ['응답 누락률', '평가 사례 중 응답 기록이 없는 비율입니다.'],
  meanLatencyMs: ['평균 응답 시간', '저장된 응답 지연 시간의 평균입니다. 단위는 밀리초(ms)입니다.'],
  meanInputTokens: ['평균 입력 토큰', '기록된 입력 토큰 사용량의 평균입니다. 요금이 아닌 토큰 수입니다.'],
  meanOutputTokens: ['평균 출력 토큰', '기록된 출력 토큰 사용량의 평균입니다. 요금이 아닌 토큰 수입니다.'],
  semanticFaithfulness: ['의미 충실도', '답변의 의미가 근거에 충실한지 평가한 값입니다. 측정 기록이 없으면 미측정으로 표시합니다.'],
} as const

function metrics(comparison: Comparison): Metric[] {
  if (comparison.schema_version === 2) return comparison.metrics.map((item) => ({
    label: fixedDescriptions[item.key][0], description: fixedDescriptions[item.key][1],
    candidate: item.candidate, reference: item.reference,
    unit: item.key === 'meanLatencyMs' ? 'ms' : ['meanInputTokens', 'meanOutputTokens'].includes(item.key) ? 'tokens' : undefined,
  }))
  return (Object.keys(ragDescriptions) as Array<keyof typeof ragDescriptions>).map((key) => {
    const current = comparison.current.metrics[key], reference = comparison.reference.metrics[key]
    return {
      label: ragDescriptions[key][0], description: ragDescriptions[key][1], candidate: current.value, reference: reference.value,
      candidateCoverage: `${current.measuredCaseCount}건 측정 / 대상 ${current.eligibleCaseCount}건`,
      referenceCoverage: `${reference.measuredCaseCount}건 측정 / 대상 ${reference.eligibleCaseCount}건`,
    }
  })
}

type CaseChange = { id: string; index: number; change: 'improved' | 'worse' | 'same' | 'unavailable' }

function caseChanges(comparison: Comparison): Array<{ label: string; cases: CaseChange[] }> {
  const definitions = comparison.schema_version === 3
    ? [
        { label: '근거 검색 재현율', key: 'retrievalRecallAtK' as const },
        { label: '답변 인용 재현율', key: 'answerCitationRecall' as const },
        { label: '답변 상태 일치율', key: 'answerStatusMatches' as const },
      ]
    : [
        { label: '답변 인용 재현율', key: 'citation_recall' as const },
        { label: '답변 상태 일치율', key: 'status_match' as const },
      ]
  return definitions.map(({ label, key }) => ({
    label,
    cases: comparison.case_ids.map((id, index) => {
      let candidate: number | boolean | null | undefined = undefined
      let reference: number | boolean | null | undefined = undefined
      if (comparison.schema_version === 3 && (key === 'retrievalRecallAtK' || key === 'answerCitationRecall' || key === 'answerStatusMatches')) {
        candidate = comparison.current.cases.find((item) => item.caseId === id)?.[key]
        reference = comparison.reference.cases.find((item) => item.caseId === id)?.[key]
      } else if (comparison.schema_version === 2 && (key === 'citation_recall' || key === 'status_match')) {
        const item = comparison.cases.find((entry) => entry.case_id === id)
        candidate = item?.candidate.outcome === 'success' ? item.candidate[key] : null
        reference = item?.reference.outcome === 'success' ? item.reference[key] : null
      }
      const change = candidate == null || reference == null ? 'unavailable'
        : Number(candidate) > Number(reference) ? 'improved'
          : Number(candidate) < Number(reference) ? 'worse' : 'same'
      return { id, index, change }
    }),
  }))
}

export function EvaluationReport({ onExpired }: { onExpired: () => void }) {
  const { runId = '' } = useParams()
  const [run, setRun] = useState<EvaluationRun | null>(null)
  const [material, setMaterial] = useState<CaseMaterial[] | null>(null)
  const [dataType, setDataType] = useState<string | undefined>()
  const [error, setError] = useState('')
  const [materialError, setMaterialError] = useState('')
  const [reload, setReload] = useState(0)
  const expiry = useRef(onExpired); expiry.current = onExpired
  useEffect(() => {
    const controller = new AbortController()
    setRun(null); setMaterial(null); setDataType(undefined); setError(''); setMaterialError('')
    const read = async () => {
      let loaded = false
      try {
        const result = await getEvaluation(runId, controller.signal)
        if (controller.signal.aborted) return
        setRun(result); loaded = true
        if (result.status !== 'COMPLETED' || !result.comparison) return
        if (result.comparison.schema_version === 3) {
          const source = await getRagMaterial(runId, controller.signal)
          if (controller.signal.aborted) return
          setDataType(source.data_type)
          setMaterial(source.cases.map((item) => ({ id: item.case_id, question: item.question, document: item.document_id,
            expected: item.expected_status, candidate: item.candidate.answer, reference: item.reference.answer })))
        } else {
          const review = await getEvaluationReview(runId, controller.signal)
          if (controller.signal.aborted) return
          if (!review.material) { setMaterialError(review.material_error || '저장된 질문·답변 자료가 없습니다.'); return }
          setDataType(review.material.data_type)
          setMaterial(review.material.cases.map((item) => ({ id: item.case_id, question: item.question, document: item.document_title,
            expected: item.expected_status, candidate: item.answer, reference: item.reference_answer })))
        }
      } catch (reason) {
        if (controller.signal.aborted) return
        if (reason instanceof OpsApiError && [401, 403].includes(reason.status)) { expiry.current(); return }
        const message = reason instanceof Error ? reason.message : '보고서를 불러오지 못했습니다.'
        if (loaded) setMaterialError(message)
        else setError(message)
      }
    }
    void read()
    return () => controller.abort()
  }, [runId, reload])
  const comparison = run?.status === 'COMPLETED' ? run.comparison : null
  const changes = comparison ? caseChanges(comparison) : []
  const detailPath = `/ops/evaluations/${runId}`
  return <>
    <WorkspacePageHeader title="Evidently 평가 보고서" parent={{ to: detailPath, label: '평가 상세' }}
      actions={<button className={styles.secondaryButton} onClick={() => setReload((value) => value + 1)}>보고서 새로고침</button>} />
    <div className={styles.content}>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      {!run && !error && <p role="status">저장된 평가 결과를 불러오고 있습니다.</p>}
      {run && <>
        <section className={styles.card} aria-label="평가 대상">
          <p className="text-xs font-bold text-brand-primary">저장 결과 조회 · 새 모델 호출 없음</p>
          <h2 className="text-xl font-bold break-words">{run.dataset_label}</h2>
          <p className="text-sm leading-6">{comparison?.schema_version === 3
            ? '고정해 둔 공고 원문·청크에서 근거를 검색하고 답변한 결과입니다. 실시간 공고 검색 전체나 운영 색인의 성능을 측정한 자료는 아닙니다.'
            : comparison?.schema_version === 2 ? '고정된 근거를 제공했을 때의 답변 평가입니다. 검색·임베딩 성능은 이 보고서에 포함되지 않습니다.' : '저장된 평가 실행의 보고서입니다.'}</p>
          <p className="text-sm text-ink-muted">평가 사례 {comparison ? `${comparison.case_ids.length}건 · ${comparison.case_ids.join(', ')}` : '확인 불가'} · 실행 상태 {run.status_label}</p>
          <p className="text-xs text-ink-muted">완료 시각 {run.finished_at ? new Date(run.finished_at).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }) + ' (서울)' : '기록 없음'} · 원문 자료 {dataType === 'official-html-snapshot' ? '공식 공고 HTML 스냅샷' : dataType === 'synthetic' ? '합성 자료' : materialError || !comparison ? '확인 불가' : material ? '유형 미기록' : '확인 중'}</p>
          <p className="text-xs break-all text-ink-muted">실행 ID: {run.id}</p>
        </section>
        {comparison ? <>
          <section aria-label="지표 해설" className={styles.card}>
            <h2 className={styles.cardTitle}>지표 한눈에 보기</h2>
            {comparison.comparison === 'self-replay' && <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">동일한 저장 기록끼리의 재현 확인입니다. 모델 개선 전후의 비교가 아닙니다.</p>}
            {comparison.schema_version === 3 && [comparison.current, comparison.reference].some((value) => ['synthetic-contract-check', 'integration-stub-replay'].includes(value.measurementKind)) && <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">합성 데이터 또는 테스트 대역이 포함되어 있습니다. 실패율이나 점수 차이를 실제 모델의 성능 개선으로 해석할 수 없습니다.</p>}
            <p className="text-sm text-ink-muted">후보와 비교 대상을 나란히 표시합니다. 사례 변화는 같은 질문에서 양쪽 모두 측정된 점수만 비교하며, 점수가 높아지면 개선·낮아지면 악화로 표시합니다. 미측정은 0점이 아닙니다. 사례 번호를 눌러 질문과 답변을 확인하세요.</p>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {metrics(comparison).map((item) => <MetricCard key={item.label} metric={item} changes={changes.find((value) => value.label === item.label)?.cases} />)}
              {changes.filter((item) => !metrics(comparison).some((metric) => metric.label === item.label)).map((item) => <div key={item.label} className="min-w-0 rounded-xl border border-line p-4"><h3 className="font-bold">{item.label}</h3><CaseChangeCard label={item.label} cases={item.cases} /></div>)}
            </div>
            {comparison.schema_version === 3 ? <RagExecution comparison={comparison} /> : <p className="text-xs text-ink-muted">이 형식의 기록에는 지표별 측정 건수가 없습니다. 전체 사례 수를 모든 지표의 표본 수로 해석하지 마세요.</p>}
            <p className="text-xs text-ink-muted">점수 변화는 답변의 사실성이나 품질 합격을 뜻하지 않습니다. 사람 검토는 평가 상세에서 별도로 확인하세요.</p>
          </section>
          <section aria-label="비교 데이터 안내" className={styles.card}>
            <h2 className={styles.cardTitle}>무엇을 비교하나요?</h2>
            <p className="text-sm">후보(Current)는 이번에 확인할 답변 기록, 비교 대상(Reference)은 함께 선택한 기록입니다. 비교 대상이라는 이유만으로 사람이 승인한 정답이나 운영 기준이 되지는 않습니다.</p>
            <div className="grid gap-3 md:grid-cols-2">
              {(['candidate', 'reference'] as const).map((side) => {
                const rag = comparison.schema_version === 3 ? (side === 'candidate' ? comparison.current : comparison.reference) : null
                const fixed = comparison.schema_version === 2 ? (side === 'candidate' ? comparison.candidate_execution : comparison.reference_execution) : null
                return <div key={side} className={`rounded-xl border p-4 ${side === 'candidate' ? 'border-brand-primary/20 bg-brand-soft' : 'border-line bg-surface-muted'}`}>
                  <h3 className="text-sm font-bold">{side === 'candidate' ? '후보 · Current' : '비교 대상 · Reference'}</h3>
                  <p className="mt-2 text-sm break-words">{side === 'candidate' ? run.candidate_label : run.reference_label}</p>
                  {rag && <p className="mt-1 text-xs">{origins[rag.measurementKind]}</p>}
                  <p className="mt-3 text-sm">답변 모델: {rag?.execution.model ?? fixed?.model ?? '기록 없음'}</p>
                  {rag && <p className="text-xs text-ink-muted">임베딩 모델: {rag.execution.embeddingModel ?? '기록 없음'}</p>}
                  {fixed?.started_at && <p className="text-xs text-ink-muted">응답 생성: {new Date(fixed.started_at).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })} (서울)</p>}
                </div>
              })}
            </div>
          </section>
          <section aria-label="평가 질문과 답변" className={styles.card}>
            <h2 className={styles.cardTitle}>어떤 질문으로 평가했나요?</h2>
            <p className="text-sm text-ink-muted">사례를 펼치면 저장된 답변을 볼 수 있습니다. 참조 조건과의 일치가 사실성에 대한 사람의 승인을 뜻하지는 않습니다.</p>
            {materialError && <p role="alert" className="text-sm text-red-700">질문·답변 조회 실패: {materialError} 위 지표는 별도로 조회된 기록입니다. 보고서 새로고침으로 다시 확인할 수 있습니다.</p>}
            {!material && !materialError && <p role="status">질문·답변을 불러오고 있습니다.</p>}
            {comparison.case_ids.map((id, index) => {
              const source = material?.find((item) => item.id === id)
              const rag = comparison.schema_version === 3 ? [comparison.current, comparison.reference].map((side) => side.cases.find((item) => item.caseId === id)) : null
              const fixed = comparison.schema_version === 2 ? comparison.cases.find((item) => item.case_id === id) : null
              return <details key={id} id={`evaluation-case-${index}`} className="rounded-xl border border-line p-4">
                <summary className="cursor-pointer text-sm font-semibold leading-6"><span className="mr-2 text-brand-primary">{id}</span>{source?.question ?? '질문 자료 확인 필요'}</summary>
                <div className="mt-3 space-y-3 text-sm leading-6">
                  {source && <p className="text-ink-muted">공고: {source.document} · 예상 판단: {statusLabel(source.expected)}</p>}
                  {rag && rag.map((item, side) => <p key={side}>{side === 0 ? '후보' : '비교 대상'}: {item ? <>검색 재현율 {percent(item.retrievalRecallAtK)} · 인용 재현율 {percent(item.answerCitationRecall)} · 상태 판단 {item.answerStatusMatches === null ? '미측정' : item.answerStatusMatches ? '참조와 일치' : '참조와 불일치'}<br />실행: {item.failure ? `실패 (${item.failure.stage} · ${item.failure.code})` : '실패 기록 없음'}</> : '사례 기록 없음'}</p>)}
                  {fixed && ([['후보', fixed.candidate], ['비교 대상', fixed.reference]] as const).map(([label, item]) => <p key={label}>{label} 실행: {({ success: '응답 기록 있음', error: '실행 오류', missing: '응답 누락' })[item.outcome]} · 상태 일치 {percent(item.status_match)} · 인용 재현율 {percent(item.citation_recall)}</p>)}
                  {source && <div className="grid gap-3 xl:grid-cols-2">{([['후보 답변', source.candidate], ['비교 대상 답변', source.reference]] as const).map(([label, answer]) => <div key={label} className="rounded-lg bg-surface-muted p-3"><h3 className="mb-2 font-bold">{label}</h3><p className="whitespace-pre-wrap break-words">{answer || '저장된 답변 없음'}</p></div>)}</div>}
                </div>
              </details>
            })}
            <Link className={styles.quietLink} to={detailPath}>평가 상세에서 원문·검토 상태 확인 →</Link>
          </section>
        </> : <p role="status">{run.status !== 'COMPLETED' ? '아직 완료된 평가 보고서가 없습니다.' : '이 실행에는 지표 해설에 필요한 비교 기록이 없습니다. 제공되는 원본 보고서에서 확인해 주세요.'}</p>}
        {run.status === 'COMPLETED' && run.report_url && <section className={styles.card} aria-label="Evidently 원본 차트">
          <h2 className={styles.cardTitle}>Evidently 원본 차트</h2>
          <p className="text-sm">Current는 후보, Reference는 비교 대상이며 Row count는 평가 사례 수입니다. Mean은 해당 지표의 평균입니다.</p>
          <p className="text-sm">새로 생성된 원본의 paired_available 지표는 같은 사례에서 양쪽이 모두 측정된 비율입니다. paired_delta 지표는 그 사례들의 후보 점수에서 비교 대상 점수를 뺀 값입니다. paired_delta 차트의 Current는 이 점수 차이이고 Reference는 변화 없음(0) 기준선입니다. 양수는 후보 점수가 높고 음수는 낮습니다. 이전에 생성된 원본에는 이 지표가 없을 수 있습니다.</p>
          <p className="text-sm">지표 이름에서 retrieval_recall은 근거 검색 재현율, citation_recall은 답변 인용 재현율, status_match는 답변 상태 일치를 뜻합니다. 예를 들어 paired_available_citation_recall의 Mean이 0.5라면 전체 사례 중 절반에서 양쪽 점수를 비교할 수 있다는 뜻입니다.</p>
          {comparison?.schema_version === 3 && <p className="text-sm">failed의 0은 실패 없음, 1은 실행 실패입니다. Mean이 0이면 실패율 0%이며 답변 정확도 100%를 뜻하지 않습니다. 양쪽 모두 측정값이 있는 지표만 담긴 원본에는 일부 점수 차트가 없을 수 있습니다. 위 해설에서는 후보만 측정된 점수도 표시합니다.</p>}
          <p className="text-sm">두 열 보기는 저장된 원본을 검증한 뒤 배치만 바꿔 표시합니다. 저장된 보고서 파일과 점수는 바뀌지 않습니다.</p>
          <div><a className={styles.secondaryButton} href={`${run.report_url}?view=compact`} target="_blank" rel="noopener noreferrer">원본 차트 새 탭에서 보기 ↗</a></div>
        </section>}
      </>}
    </div>
  </>
}

function MetricCard({ metric, changes }: { metric: Metric; changes?: CaseChange[] }) {
  const format = (value: number | null) => value === null ? '미측정' : metric.unit ? `${value.toLocaleString('ko-KR', { maximumFractionDigits: 1 })} ${metric.unit === 'tokens' ? '토큰' : 'ms'}` : percent(value)
  return <article aria-label={metric.label} className="min-w-0 rounded-xl border border-line p-4">
    <div className="flex items-start justify-between gap-2"><h3 className="font-bold">{metric.label}</h3><details className="text-xs text-ink-muted"><summary className="cursor-pointer whitespace-nowrap">지표 설명</summary><p className="mt-2 leading-5">{metric.description}</p></details></div>
    <div className="mt-3 grid grid-cols-2 gap-2">
      {([['후보', metric.candidate, metric.candidateCoverage], ['비교 대상', metric.reference, metric.referenceCoverage]] as const).map(([label, value, coverage]) => <div key={label} className="min-w-0 rounded-lg bg-surface-muted p-2">
        <span className="text-xs font-semibold text-ink-muted">{label}</span><p className="mt-1 break-words text-xl font-bold tabular-nums">{format(value)}</p>{coverage && <p className="mt-1 text-xs">{coverage}</p>}
      </div>)}
    </div>
    {changes && <CaseChangeCard label={metric.label} cases={changes} />}
  </article>
}

function CaseChangeCard({ label, cases }: { label: string; cases: CaseChange[] }) {
  return <article aria-label={`${label} 사례별 변화`} className="mt-3 border-t border-line pt-2">
    <h4 className="text-xs font-semibold text-ink-muted">같은 질문의 점수 변화</h4>
    <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-1">
      {([['improved', '개선'], ['worse', '악화'], ['same', '동일'], ['unavailable', '비교 불가']] as const).map(([key, title]) => {
        const items = cases.filter((item) => item.change === key)
        return <div key={key} className="min-w-0 break-words text-xs leading-5"><span className="font-semibold">{title} {items.length}건</span>{items.length > 0 && <> · {items.map((item, index) => <span key={item.id}>{index > 0 && ', '}<a className={styles.quietLink} href={`#evaluation-case-${item.index}`} onClick={() => {
          const details = document.getElementById(`evaluation-case-${item.index}`)
          if (details instanceof HTMLDetailsElement) details.open = true
        }}>{item.id}</a></span>)}</>}</div>
      })}
    </div>
  </article>
}

function RagExecution({ comparison }: { comparison: RagComparison }) {
  return <div className="rounded-xl bg-surface-muted p-4 text-sm">
    <h3 className="mb-2 font-bold">실행 도달 범위 · 점수와 별도로 확인</h3>
    {([['후보', comparison.current], ['비교 대상', comparison.reference]] as const).map(([label, report]) => <p key={label} className="leading-7">{label}: 전체 {report.caseCount}건 중 검색 도달 {report.coverage.retrievalCaseCount}건 · 답변 도달 {report.coverage.answerCaseCount}건 · 실패 {report.coverage.failedCaseCount}건</p>)}
    <p className="mt-2 text-xs text-ink-muted">실패가 없어도 답변이 정확하거나 모든 근거를 찾았다는 뜻은 아닙니다.</p>
  </div>
}
