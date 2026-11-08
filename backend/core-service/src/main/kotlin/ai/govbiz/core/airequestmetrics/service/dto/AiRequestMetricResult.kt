package ai.govbiz.core.airequestmetrics.service.dto

data class AiRequestMetricResult(
    val feature: String, val total: Long, val success: Long, val accepted: Long,
    val clientErrors: Long, val serverErrors: Long, val other: Long,
    val latencySamples: Long, val p50UpperMs: Int?, val p95UpperMs: Int?,
)
