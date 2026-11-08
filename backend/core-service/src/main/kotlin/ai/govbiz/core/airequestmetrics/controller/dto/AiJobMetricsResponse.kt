package ai.govbiz.core.airequestmetrics.controller.dto

import ai.govbiz.core.airequestmetrics.service.dto.AiJobMetricsResult
import java.time.LocalDate

data class AiJobMetricsResponse(
    val from: LocalDate, val to: LocalDate, val scope: String = "stored-ai-jobs", val features: List<AiJobFeatureResponse>,
)

data class AiJobFeatureResponse(
    val feature: String, val total: Long, val queued: Long, val running: Long,
    val succeeded: Long, val failed: Long, val interrupted: Long, val unknown: Long,
    val durationSamples: Long, val averageDurationMs: Double?,
) {
    companion object {
        fun from(result: AiJobMetricsResult) = AiJobFeatureResponse(
            result.feature, result.total, result.queued, result.running, result.succeeded, result.failed,
            result.interrupted, result.unknown, result.durationSamples, result.averageDurationMs,
        )
    }
}
