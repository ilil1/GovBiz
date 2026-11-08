package ai.govbiz.core.airequestmetrics.service.dto

data class AiJobMetricsResult(
    val feature: String, val total: Long, val queued: Long, val running: Long,
    val succeeded: Long, val failed: Long, val interrupted: Long, val unknown: Long,
    val durationSamples: Long, val averageDurationMs: Double?,
)
