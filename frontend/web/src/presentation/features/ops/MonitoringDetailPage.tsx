import type { ReactNode } from 'react'
import { Link } from 'react-router'

import { WorkspacePageHeader } from '../../shared/workspace/WorkspacePageHeader'
import { workspacePageStyles as styles } from '../../shared/workspace/WorkspacePage.styles'
import { JobMetricsPanel } from './JobMetricsPanel'
import { ModelTraceMetricsPanel } from './ModelTraceMetricsPanel'
import { useMonitoringDemo } from './MonitoringDemoContext'
import { RequestMetricsPanel } from './RequestMetricsPanel'
import { TraceCoveragePanel } from './TraceCoveragePanel'
import { TraceMetricsPanel } from './TraceMetricsPanel'

export type MonitoringSection = 'requests' | 'jobs' | 'models' | 'traces'

const detailTitles: Record<MonitoringSection, string> = {
  requests: '요청과 서버 오류',
  jobs: '작업 결과',
  models: '모델 실행',
  traces: '추적 수집과 연결',
}

/** 각 상세는 기존 집계 API를 사용하고, 선택된 예시 모드를 그대로 따릅니다. */
export function MonitoringDetailPage({ section, onExpired, modeBanner }: { section: MonitoringSection; onExpired: () => void; modeBanner?: ReactNode }) {
  const { isExample } = useMonitoringDemo()
  const overviewPath = isExample ? '/ops/usage?example=1' : '/ops/usage'

  return <>
    <WorkspacePageHeader title={detailTitles[section]} parent={{ to: overviewPath, label: '실사용 모니터링' }} />
    <div className={styles.content}>
      {modeBanner}
      <div className="flex justify-end">
        <Link to={overviewPath} className={styles.secondaryButton}>전체 현황으로 돌아가기</Link>
      </div>
      {section === 'requests' && <RequestMetricsPanel onExpired={onExpired} detailPage />}
      {section === 'jobs' && <JobMetricsPanel onExpired={onExpired} detailPage />}
      {section === 'models' && <ModelTraceMetricsPanel onExpired={onExpired} detailPage />}
      {section === 'traces' && <><TraceMetricsPanel onExpired={onExpired} /><TraceCoveragePanel onExpired={onExpired} /></>}
      {section === 'traces' && !isExample && <p className="m-0 text-sm leading-6 text-ink-muted">특정 실행의 처리 단계나 오류는 <Link to="/ops/traces" className="font-semibold text-brand-primary underline underline-offset-4">AI 실행 추적</Link>에서 확인하세요.</p>}
    </div>
  </>
}
