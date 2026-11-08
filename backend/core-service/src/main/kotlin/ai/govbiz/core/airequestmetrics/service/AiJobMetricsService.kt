package ai.govbiz.core.airequestmetrics.service

import ai.govbiz.core._common.domain.JobStatusSummary
import ai.govbiz.core.airequestmetrics.service.dto.AiJobMetricsResult
import ai.govbiz.core.applicationpreparation.repository.ApplicationDocumentGenerationJobRepository
import ai.govbiz.core.applicationpreparation.repository.ApplicationFormDiscoveryJobRepository
import ai.govbiz.core.combinationreview.repository.CombinationReviewRunRepository
import java.time.LocalDate
import java.time.temporal.ChronoUnit
import org.springframework.stereotype.Service

/** 각 기능의 저장된 고유 작업 행을 접수 시각 기준으로 조회합니다. */
@Service
class AiJobMetricsService(
    private val discovery: ApplicationFormDiscoveryJobRepository,
    private val document: ApplicationDocumentGenerationJobRepository,
    private val review: CombinationReviewRunRepository,
) {
    fun summary(from: LocalDate, to: LocalDate): List<AiJobMetricsResult> {
        require(!to.isBefore(from) && ChronoUnit.DAYS.between(from, to) < 31) { "period must be 1~31 days" }
        // DB의 DATETIME은 서울 시각이며, 공개 조회 기간은 UTC 날짜다.
        val start = from.atStartOfDay().plusHours(9)
        val until = to.plusDays(1).atStartOfDay().plusHours(9)
        return listOf(
            result("APPLICATION_DISCOVERY", discovery.summarize(start, until)),
            result("APPLICATION_DOCUMENT", document.summarize(start, until)),
            result("COMBINATION_REVIEW", review.summarize(start, until)),
        )
    }

    private fun result(feature: String, rows: List<JobStatusSummary>): AiJobMetricsResult {
        check(rows.all { it.status in STATUSES && it.count >= 0 && it.durationSamples in 0..it.count && it.durationMillis >= 0 })
        check(rows.map { it.status }.distinct().size == rows.size)
        fun count(status: String) = rows.firstOrNull { it.status == status }?.count ?: 0L
        val samples = rows.sumOf { it.durationSamples }
        return AiJobMetricsResult(
            feature, rows.sumOf { it.count }, count("QUEUED"), count("RUNNING"), count("SUCCEEDED"),
            count("FAILED"), count("INTERRUPTED"), count("UNKNOWN"), samples,
            if (samples == 0L) null else rows.sumOf { it.durationMillis }.toDouble() / samples,
        )
    }

    private companion object {
        val STATUSES = setOf("QUEUED", "RUNNING", "SUCCEEDED", "FAILED", "INTERRUPTED", "UNKNOWN")
    }
}
