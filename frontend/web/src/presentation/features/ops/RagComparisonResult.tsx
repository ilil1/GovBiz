import type { RagComparison } from '../../../data/ops/opsApi'
import { workspacePageStyles as styles } from '../../shared/workspace/WorkspacePage.styles'
import { EvaluationHelp } from './EvaluationHelp'

const origins = {
  'synthetic-contract-check': '연습용 자료로 확인',
  'integration-stub-replay': '테스트용 답변으로 확인',
  'recorded-live-evaluation': '새로 만든 답변으로 확인',
  'recorded-capture-replay': '저장된 답변으로 확인',
}
const stages = { not_started: '시작 전', source: '공고 확인', chunk: '공고 준비', index: '자료 준비', search: '내용 찾기', answer: '답변 작성' }
const metricLabels = { retrievalRecallAtK: '필요한 공고 내용을 찾은 비율', answerCitationRecall: '필요한 내용을 근거로 표시한 비율', answerStatusAccuracy: '예상대로 답변하거나 보류한 비율' }
const metricHelp = { retrievalRecallAtK: '평가 자료에서 필요하다고 정한 공고 내용을 검색 결과에서 얼마나 찾았는지 보여줘요.', answerCitationRecall: '답변에 표시해야 한다고 정한 공고 내용을 근거로 얼마나 표시했는지 보여줘요.', answerStatusAccuracy: '답변할 질문에 답하고 근거가 부족한 질문에 답변을 보류했는지 보여줘요.' }
const measure = (value: number | null) => value === null ? '확인하지 못함' : `${Number((value * 100).toFixed(2))}%`

export function RagComparisonResult({ comparison }: { comparison: RagComparison }) {
  const current = comparison.current
  return <section className={styles.card} aria-label="RAG 기준·후보 비교">
    <h2 className={styles.cardTitle}>검색과 답변 결과</h2>
    <p className="text-sm text-ink-muted">{current.measurementKind === 'synthetic-contract-check' ? '연습용 자료로 확인한 결과입니다. 실제 모델의 성능은 알 수 없습니다.' : current.measurementKind === 'integration-stub-replay' ? '모델 대신 테스트용 답변으로 확인한 결과입니다.' : current.liveExecutionPerformed ? '새로 만든 답변을 확인한 결과입니다.' : '저장된 답변을 다시 확인한 결과입니다.'}</p>
    <div className="grid gap-3 sm:grid-cols-3">{(Object.keys(metricLabels) as Array<keyof typeof metricLabels>).map((key) => {
      const value = current.metrics[key].value
      return <div key={key} className="rounded-xl bg-[#f3f7f5] p-4"><EvaluationHelp label={metricLabels[key]} title={<p className="text-sm text-ink-muted">{metricLabels[key]}</p>}><p>{metricHelp[key]}</p></EvaluationHelp><strong className="mt-2 block text-2xl">{measure(value)}</strong></div>
    })}</div>
    <p className="text-sm text-ink-muted">답변까지 진행 {current.coverage.answerCaseCount} / {current.caseCount}건 · 실패 {current.coverage.failedCaseCount}건. 실행 완료가 품질 합격을 뜻하지는 않습니다.</p>
    <details className="text-sm"><summary className="cursor-pointer font-semibold">이전 결과와 비교하기</summary>
      <p className="mt-2 text-ink-muted">{comparison.comparison === 'self-replay' ? '같은 기록을 다시 확인한 결과입니다.' : '이전 기준과 이번 결과를 비교합니다.'} 괄호는 측정한 질문 수 / 측정 대상 수입니다.</p>
      <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr>{['확인한 내용', '기준 (측정 / 대상)', '이번 결과 (측정 / 대상)', '차이'].map((label) => <th key={label} className="p-2">{label}</th>)}</tr></thead><tbody>
        {(Object.keys(metricLabels) as Array<keyof typeof metricLabels>).map((key) => {
          const before = comparison.reference.metrics[key], after = current.metrics[key]
          return <tr key={key}><th className="p-2">{metricLabels[key]}</th><td>{measure(before.value)} ({before.measuredCaseCount} / {before.eligibleCaseCount})</td><td>{measure(after.value)} ({after.measuredCaseCount} / {after.eligibleCaseCount})</td><td>{before.value === null || after.value === null ? '비교할 수 없음' : `${Number(((after.value - before.value) * 100).toFixed(2))}%p`}</td></tr>
        })}
      </tbody></table></div>
      <p className="text-xs text-ink-muted">차이는 두 비율의 차이(%p)입니다.</p>
    </details>
    <details className="text-xs leading-5 text-ink-muted"><summary className="cursor-pointer font-semibold">결과를 읽을 때 알아둘 점</summary>
      <p>확인하지 못한 질문은 비율에 포함하지 않았어요. 근거를 인용했더라도 답변 내용이 맞는지는 직접 확인해야 해요. 다음 평가의 기준으로 쓰려면 실제 모델 기록과 사람의 검토가 필요해요.</p>
      <p>{current.liveExecutionPerformed ? '실제 서비스에서 공고를 찾는 성능은 측정하지 않았어요.' : '저장된 기록을 다시 확인해 AI를 추가로 호출하지 않았어요.'}</p>
    </details>
    <details><summary className="cursor-pointer font-semibold">비교한 실행의 모델과 기록 보기</summary><div className="mt-3 grid gap-3 md:grid-cols-2">{([['기준', comparison.reference], ['후보', current]] as const).map(([label, report]) => <div key={label} className="rounded-xl bg-[#f3f7f5] p-3 text-xs break-all">
      <strong>{label} 기록</strong><p>{origins[report.measurementKind]}</p>
      <p>답변 모델: {report.execution.model ?? '실행 없음'}</p><p>임베딩 모델: {report.execution.embeddingModel ?? '실행 없음'}</p>
      <p>자료: {report.fixtureSha256}</p><p>캡처: {report.captureSha256}</p><p>프롬프트: {report.execution.promptSha256 ?? '실행 없음'}</p>
    </div>)}</div></details>
    <details><summary className="cursor-pointer font-semibold">질문별 검색·답변 결과 보기</summary>
      {current.cases.map((item) => <article key={item.caseId} className="border-b border-line py-3 text-sm break-all">
        <strong>{item.caseId}</strong><p>필요한 공고 내용을 찾은 비율 {measure(item.retrievalRecallAtK)} · 필요한 내용을 근거로 표시한 비율 {measure(item.answerCitationRecall)}</p>
        <p>{item.failure ? `${stages[item.failure.stage]} 중 문제가 생겼어요` : '답변을 만들었어요'}</p>{item.failure && <details><summary className="cursor-pointer text-xs">관리자용 오류 코드</summary><span>{item.failure.code}</span></details>}
        <p>찾은 내용: {item.retrievedChunkIds?.join(', ') ?? '미측정'}</p><p>답변에 사용한 내용: {item.citedChunkIds?.join(', ') ?? '미측정'}</p>
      </article>)}
    </details>
  </section>
}
