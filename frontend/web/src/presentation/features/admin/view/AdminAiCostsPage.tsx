import { useEffect, type ReactNode } from 'react'
import { Link } from 'react-router'

import { SelectField } from '../../../shared/workspace/SelectField'
import { workspacePageStyles } from '../../../shared/workspace/WorkspacePage.styles'
import { WorkspacePageHeader } from '../../../shared/workspace/WorkspacePageHeader'
import { adminAccessMessages } from '../viewmodel/adminAccountAccess'
import { adminAiCostMessages, useAdminAiCostViewModel } from '../viewmodel/useAdminAiCostViewModel'
import { adminAccountsPageStyles } from './AdminAccountsPage.styles'
import { adminAiCostsPageStyles as styles } from './AdminAiCostsPage.styles'
import { exampleCostUseCases, useMonitoringDemo } from '../../ops/MonitoringDemoContext'
import { EvaluationHelp } from '../../ops/EvaluationHelp'

type ViewModel = ReturnType<typeof useAdminAiCostViewModel>

/**
 * 관리자 AI 비용입니다. 동일 UTC 기간에 함께 수집한 OpenAI 사용량 추정·실제 비용을 비교하고 앱 기록을 별도로 나눠 봅니다.
 * 가격표는 고치지 않고 시작일이 다른 가격을 더합니다. 회원 이메일이 있어 이 화면을 열면 감사 기록에 남습니다.
 */
export function AdminAiCostsPage({ title = 'AI 비용', children, onExpired, compact = false, monitoringDetail = false, monitoringBackTo = '/ops/usage' }: {
  title?: string
  children?: ReactNode
  onExpired?: () => void
  compact?: boolean
  monitoringDetail?: boolean
  monitoringBackTo?: string
} = {}) {
  const { isExample } = useMonitoringDemo()
  const vm = useAdminAiCostViewModel(isExample ? exampleCostUseCases : {})
  const form = vm.form
  const monitoring = compact || monitoringDetail
  useEffect(() => {
    if (vm.phase === 'signed-out') onExpired?.()
  }, [vm.phase, onExpired])

  return (
    <>
      <WorkspacePageHeader title={title} parent={monitoringDetail ? { to: monitoringBackTo, label: '실사용 모니터링' } : undefined} />

      <div className={workspacePageStyles.content}>
        {children}
        <CostPanel compact={monitoring} standalone={monitoringDetail} phase={vm.phase} hasTestData={!isExample && vm.byModel.some((row) => row.label?.startsWith('demo-local-'))}>
        {monitoring && !monitoringDetail && <h2 className="m-0 text-xl font-bold tracking-tight text-ink">AI 사용량과 비용</h2>}
        {isExample && <p role="status" className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm font-semibold text-amber-950">예시 데이터 · 아래 사용량과 비용은 실제 기록이나 청구 금액이 아닙니다.</p>}
        {vm.byModel.some((row) => row.label?.startsWith('demo-local-')) ? (
          <p className={adminAccountsPageStyles.notice} role="status">
            이 기간에는 로컬 테스트용 가상 데이터가 앱 기록에 포함되어 있습니다. 아래 앱 사용량은 실제 사용량만의 합계가 아닙니다.
          </p>
        ) : null}
        {monitoring ? <EvaluationHelp label="비용 계산 기준" title={<span className="text-sm font-semibold text-ink">비용 계산 기준</span>}><p className="m-0">{vm.basis}</p></EvaluationHelp> : <p className={styles.intro}>{vm.basis}</p>}

        {vm.notice ? (
          <p className={adminAccountsPageStyles.notice} role="status">
            <span>{vm.notice}</span>
            <button className={workspacePageStyles.quietLink} type="button" onClick={vm.dismissNotice}>닫기</button>
          </p>
        ) : null}

        <div className={styles.toolbar}>
          <form className={styles.filterForm} aria-label="기간" onSubmit={form.submit} noValidate>
            <label className={styles.field}>시작일
              <input className={styles.dateInput} type="date" name="from" value={form.values.from}
                max={form.values.to || undefined} onChange={(event) => form.updateFrom(event.target.value)} />
            </label>
            <label className={styles.field}>종료일
              <input className={styles.dateInput} type="date" name="to" value={form.values.to}
                min={form.values.from || undefined} onChange={(event) => form.updateTo(event.target.value)} />
            </label>
            <div className={styles.formActions}>
              <button className={workspacePageStyles.primaryButton} type="submit">조회</button>
            </div>
          </form>
          {!isExample && <button className={workspacePageStyles.secondaryButton} type="button" disabled={!vm.sync.configured || vm.sync.busy} onClick={vm.sync.run}>
            {vm.sync.busy ? '가져오는 중…' : '사용량·비용 가져오기'}
          </button>}
        </div>
        {form.error ? <p className={styles.formError} role="alert">{form.error}</p> : null}
        {!isExample && vm.phase === 'ready' && !vm.sync.configured && <p className="m-0 text-sm leading-6 text-ink-muted">OpenAI 사용량과 비용을 새로 가져오는 설정이 없습니다. 이전에 가져온 기록이 있다면 아래에서 확인할 수 있습니다.</p>}

        {vm.phase === 'signed-out' ? (
          <p className={workspacePageStyles.emptyNote} role="status">로그인이 필요합니다.</p>
        ) : vm.phase === 'forbidden' ? (
          <p className={workspacePageStyles.emptyNote} role="alert">{adminAccessMessages.forbidden}</p>
        ) : vm.phase === 'failed' ? (
          <p className={workspacePageStyles.emptyNote} role="alert">
            {adminAiCostMessages.failed}{' '}
            <button className={workspacePageStyles.quietLink} type="button" onClick={vm.retry}>다시 시도</button>
          </p>
        ) : vm.phase === 'loading' ? (
          <p className={workspacePageStyles.emptyNote} role="status">{adminAiCostMessages.loading}</p>
        ) : (
          <CostSections vm={vm} compact={monitoring} standalone={monitoringDetail} />
        )}

        {!isExample && vm.phase === 'ready' && <CostDetailGroup compact={monitoring} label="모델 가격표와 단가 설정"><PriceSection vm={vm} /></CostDetailGroup>}
        </CostPanel>
      </div>
    </>
  )
}

function CostPanel({ compact, standalone, phase, hasTestData, children }: { compact: boolean; standalone: boolean; phase: ViewModel['phase']; hasTestData: boolean; children: ReactNode }) {
  if (!compact) return <>{children}</>
  if (standalone) return <section aria-label="AI 사용량과 비용" className="grid min-w-0 gap-5 rounded-2xl border border-line bg-white p-5 sm:p-6">{children}</section>
  const message = phase === 'failed' ? '조회하지 못했습니다. 열어서 다시 시도해 주세요.'
    : phase === 'forbidden' ? '조회 권한을 확인해 주세요.'
      : phase === 'signed-out' ? '로그인이 필요합니다.'
        : phase === 'loading' ? '비용을 불러오는 중…'
          : hasTestData ? '조회된 앱 기록에 테스트 데이터가 포함되어 있습니다.' : '앱 사용량과 비용을 확인합니다.'
  return <details className="group rounded-2xl border border-line bg-white">
    <summary className="flex min-h-16 cursor-pointer list-none items-center justify-between gap-4 p-5 focus-visible:outline-2 focus-visible:outline-brand-primary sm:px-6">
      <span className="min-w-0"><span className="block text-base font-bold text-ink">비용은 얼마나 들었나요?</span><span role="status" className={`mt-1 block text-sm ${phase === 'failed' || phase === 'forbidden' ? 'text-danger' : 'text-ink-muted'}`}>{message}</span></span>
      <span className="shrink-0 text-sm font-bold text-brand-primary group-open:hidden">펼치기 +</span><span className="hidden shrink-0 text-sm font-bold text-brand-primary group-open:inline">접기 −</span>
    </summary>
    <section aria-label="AI 사용량과 비용" className="grid min-w-0 gap-5 border-t border-line p-5 sm:p-6">{children}</section>
  </details>
}

function CostSections({ vm, compact, standalone }: { vm: ViewModel; compact: boolean; standalone: boolean }) {
  const headingClass = compact ? 'm-0 text-base font-bold text-ink' : workspacePageStyles.cardTitle
  const noteClass = compact ? 'm-0 text-sm leading-6 text-ink-muted' : styles.sectionNote
  const application = <>
    {compact ? <EvaluationHelp label="앱 사용량" title={<h3 className={headingClass}>{vm.applicationTitle}</h3>}><p className="m-0">앱이 직접 기록한 호출과 토큰으로 계산한 추정치입니다. Core 밖 호출의 사용자·기능은 이 내역에 자동 연결되지 않아요.</p></EvaluationHelp> : <h2 className={headingClass}>{vm.applicationTitle}</h2>}
    <p className={compact ? 'm-0 text-xs leading-5 text-ink-muted' : styles.sectionNote}>
      {compact ? '앱 기록 기준 · 일부 호출은 연결되지 않을 수 있습니다.' : '앱에 기록된 호출만 기능·모델·회원별로 나눠요. Core 밖 호출의 사용자·기능은 이 내역에 자동 연결되지 않아요.'}
    </p>
    {compact && vm.applicationPeriod && <p className="m-0 text-xs leading-5 text-ink-muted">조회된 기간: {vm.applicationPeriod}</p>}
    <CostStats label="앱 사용량 요약" rows={vm.applicationStats} compact={compact} />
  </>
  return (
    <>
      {compact && application}
      {compact ? <EvaluationHelp label="OpenAI 비용 비교" title={<h3 className={headingClass}>OpenAI 비용 비교 · UTC</h3>}><p className="m-0">OpenAI에서 함께 가져온 사용량의 추정 비용과 제공된 비용을 비교합니다.</p></EvaluationHelp> : <h2 className={headingClass}>OpenAI 비용 비교 · UTC</h2>}
      {compact && <p className="m-0 text-xs leading-5 text-ink-muted">앱 기록과 범위가 다를 수 있으며, 최종 청구액이 아닐 수 있습니다.</p>}
      {vm.comparisonPeriod ? <p className={noteClass}>{vm.comparisonPeriod}</p> : null}
      {vm.comparisonNote ? <p className={noteClass} role="status">{vm.comparisonNote}</p> : null}
      {vm.currentDayNote ? <p className={noteClass}>{vm.currentDayNote}</p> : null}
      <CostStats label="비용 요약" rows={vm.stats} compact={compact} comparison />

      <CostDetailGroup compact={compact && !standalone} label="날짜별 비용 보기"><section className={workspacePageStyles.card} aria-label="날짜별">
        {compact ? <EvaluationHelp label="날짜별 OpenAI 비용" title={<h2 className={workspacePageStyles.cardTitle}>날짜별 OpenAI 비용</h2>}><p className="m-0">UTC 하루는 서울 오전 9시에 시작합니다. 사용량은 동기화 때 함께 수집한 값입니다.</p></EvaluationHelp> : <><h2 className={workspacePageStyles.cardTitle}>날짜별 OpenAI 비용</h2><p className={styles.sectionNote}>추정과 실제 모두 UTC 하루(서울 오전 9시 시작) 기준이에요. 사용량은 동기화 때 함께 수집한 값이에요.</p></>}
        <Table head={['날짜(UTC)', '호출', '추정', '실제']} empty="이 기간에 함께 가져온 사용량·비용이 없어요."
          rows={vm.days.map((row) => ({ key: row.date, cells: [row.date, row.calls, row.estimated, row.actual] }))} />
      </section></CostDetailGroup>

      {!compact && application}

      <CostDetailGroup compact={compact && !standalone} label="기능·모델·회원별 사용량 보기"><div className={styles.sectionGrid}>
        <section className={`${workspacePageStyles.card} min-w-0`} aria-label="기능별">
          <h2 className={workspacePageStyles.cardTitle}>기능별</h2>
          <Table head={['기능', '호출', '토큰', '추정 비용']} empty="이 기간에 기록된 AI 호출이 없어요." firstColumn="feature" wrapDetails
            rows={vm.byFeature.map((row) => ({ key: row.key, cells: [row.label, row.calls, row.tokens, row.note ? `${row.cost} · ${row.note}` : row.cost] }))} />
        </section>
        <section className={`${workspacePageStyles.card} min-w-0`} aria-label="모델별">
          <h2 className={workspacePageStyles.cardTitle}>모델별</h2>
          <Table head={['모델', '처리 등급', '호출', '토큰', '추정 비용']} empty="이 기간에 기록된 AI 호출이 없어요." firstColumn="model" wrapDetails
            rows={vm.byModel.map((row) => ({ key: row.key, cells: [row.label, row.tier, row.calls, row.tokens, row.cost] }))} />
        </section>
      </div>

      <div className={styles.sectionGrid}>
        <section className={`${workspacePageStyles.card} min-w-0`} aria-label="회원 사용량">
          <h2 className={workspacePageStyles.cardTitle}>회원 사용량</h2>
          {vm.topAccounts.length === 0 ? (
            <p className={styles.sectionNote}>회원에게 붙은 AI 호출이 없어요.</p>
          ) : (
            <div className={adminAccountsPageStyles.tableScroll} role="region" aria-label="회원 사용량 표 가로 스크롤" tabIndex={0}>
              <table className={workspacePageStyles.table}>
                <thead><tr>{['회원', '요금제', '호출', '추정 비용'].map((label) => <th className={workspacePageStyles.tableHeadCell} key={label}>{label}</th>)}</tr></thead>
                <tbody>
                  {vm.topAccounts.map((row) => (
                    <tr key={row.id}>
                      <td className={workspacePageStyles.tableCell}><Link className={adminAccountsPageStyles.emailLink} to={row.path}>{row.email}</Link></td>
                      <td className={workspacePageStyles.tableCell}>{row.plan}</td>
                      <td className={`${workspacePageStyles.tableCell} ${styles.numberCell}`}>{row.calls}</td>
                      <td className={`${workspacePageStyles.tableCell} ${styles.numberCell}`}>{row.cost}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div></CostDetailGroup>
    </>
  )
}

function CostStats({ label, rows, compact, comparison = false }: {
  label: string
  rows: ViewModel['stats']
  compact: boolean
  comparison?: boolean
}) {
  const layout = compact ? (comparison ? styles.monitorComparisonStats : styles.monitorStats) : adminAccountsPageStyles.statRow
  return <section className={layout} aria-label={label}>
    {rows.map((stat) => <div className={compact ? styles.monitorStat : adminAccountsPageStyles.statCell} key={stat.label}>
      <span className={compact ? styles.monitorStatLabel : adminAccountsPageStyles.statLabel}>{stat.label}</span>
      <strong className={compact ? styles.monitorStatValue : adminAccountsPageStyles.statValue}>{compact && stat.value === '—' ? '미확인' : stat.value}</strong>
      {stat.note ? <span className={compact ? styles.monitorStatNote : styles.statNote}>{stat.note}</span> : null}
    </div>)}
  </section>
}

function CostDetailGroup({ compact, label, children }: { compact: boolean; label: string; children: ReactNode }) {
  if (!compact) return <>{children}</>
  return <details className="rounded-2xl border border-line bg-white"><summary className="min-h-11 cursor-pointer content-center px-4 text-sm font-bold text-brand-primary focus-visible:outline-2 focus-visible:outline-brand-primary">{label}</summary><div className="grid gap-4 border-t border-line p-4">{children}</div></details>
}

function Table({ head, rows, empty, firstColumn, wrapDetails = false }: {
  head: string[]
  rows: { key: string; cells: string[] }[]
  empty: string
  firstColumn?: 'feature' | 'model'
  wrapDetails?: boolean
}) {
  if (rows.length === 0) return <p className={styles.sectionNote}>{empty}</p>
  const labelClass = firstColumn === 'model' ? styles.modelCell : firstColumn === 'feature' ? styles.featureCell : ''
  return (
    <div className={adminAccountsPageStyles.tableScroll} role="region" aria-label={`${head[0]} 표 가로 스크롤`} tabIndex={0}>
      <table className={workspacePageStyles.table}>
        <thead><tr>{head.map((label) => <th className={workspacePageStyles.tableHeadCell} key={label}>{label}</th>)}</tr></thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key}>
              {row.cells.map((cell, index) => (
                <td className={`${workspacePageStyles.tableCell} ${index === 0 ? labelClass : wrapDetails && index >= head.length - 2 ? styles.detailCell : styles.numberCell}`} key={index}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function PriceSection({ vm }: { vm: ViewModel }) {
  const form = vm.priceForm
  return (
    <section className={workspacePageStyles.card} aria-label="가격표">
      <h2 className={workspacePageStyles.cardTitle}>가격표 (1M 토큰당 USD)</h2>
      <p className={styles.sectionNote}>모델 이름은 앞부분으로 맞춰 날짜가 붙은 모델에도 적용해요. 가격이 바뀌면 고치지 말고 새 시작일로 더해 주세요. 캐시 쓰기 단가가 비어 있으면 쓰기 비용을 확정하지 않아요.</p>
      <Table head={['모델', '처리 등급', '입력', '캐시 읽기', '캐시 쓰기', '12시간 캐시 쓰기', '출력', '시작일', '비고']} firstColumn="model"
        empty={vm.phase === 'loading' ? '가격표를 불러오는 중이에요.' : '가격이 없어요.'}
        rows={vm.prices.map((row) => ({ key: String(row.id), cells: [row.model, row.tier, row.input, row.cached, row.cacheWrite, row.cacheWrite12h, row.output, row.effectiveFrom, row.note] }))} />
      <form className={styles.filterForm} aria-label="가격 추가" onSubmit={form.submit} noValidate>
        <label className={styles.field}>모델
          <input className={styles.textInput} type="text" name="modelPrefix" autoComplete="off" placeholder="gpt-5.6-luna"
            value={form.values.modelPrefix} onChange={(event) => form.update('modelPrefix', event.target.value)} />
        </label>
        <label className={styles.field}>처리 등급
          <SelectField className={styles.tierSelect} label="처리 등급" value={form.values.serviceTier}
            options={form.tierOptions} onChange={(value) => form.update('serviceTier', value)} />
        </label>
        <label className={styles.field}>입력
          <input className={styles.numberInput} type="text" inputMode="decimal" name="inputUsdPerMillion"
            value={form.values.inputUsdPerMillion} onChange={(event) => form.update('inputUsdPerMillion', event.target.value)} />
        </label>
        <label className={styles.field}>캐시 읽기
          <input className={styles.numberInput} type="text" inputMode="decimal" name="cachedInputUsdPerMillion"
            value={form.values.cachedInputUsdPerMillion} onChange={(event) => form.update('cachedInputUsdPerMillion', event.target.value)} />
        </label>
        <label className={styles.field}>캐시 쓰기
          <input className={styles.numberInput} type="text" inputMode="decimal" name="cacheWriteInputUsdPerMillion"
            value={form.values.cacheWriteInputUsdPerMillion} onChange={(event) => form.update('cacheWriteInputUsdPerMillion', event.target.value)} />
        </label>
        <label className={styles.field}>12시간 캐시 쓰기
          <input className={styles.numberInput} type="text" inputMode="decimal" name="cacheWrite12hInputUsdPerMillion"
            value={form.values.cacheWrite12hInputUsdPerMillion} onChange={(event) => form.update('cacheWrite12hInputUsdPerMillion', event.target.value)} />
        </label>
        <label className={styles.field}>출력
          <input className={styles.numberInput} type="text" inputMode="decimal" name="outputUsdPerMillion"
            value={form.values.outputUsdPerMillion} onChange={(event) => form.update('outputUsdPerMillion', event.target.value)} />
        </label>
        <label className={styles.field}>시작일
          <input className={styles.dateInput} type="date" name="effectiveFrom"
            value={form.values.effectiveFrom} onChange={(event) => form.update('effectiveFrom', event.target.value)} />
        </label>
        <label className={styles.field}>비고
          <input className={styles.textInput} type="text" name="note" maxLength={200}
            value={form.values.note} onChange={(event) => form.update('note', event.target.value)} />
        </label>
        <div className={styles.formActions}>
          <button className={workspacePageStyles.primaryButton} type="submit" disabled={form.busy}>{form.busy ? '더하는 중…' : '가격 추가'}</button>
        </div>
      </form>
      {form.error ? <p className={styles.formError} role="alert">{form.error}</p> : null}
    </section>
  )
}
