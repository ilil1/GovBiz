package ai.govbiz.core.airequestmetrics.controller.dto

import ai.govbiz.core.airequestmetrics.service.dto.AiRequestMetricResult
import java.time.LocalDate

data class AiRequestMetricsResponse(
    val from: LocalDate,
    val to: LocalDate,
    val scope: String = "core-http-requests",
    val features: List<AiRequestMetricResponse>,
)

data class AiRequestMetricsDailyResponse(
    val from: LocalDate,
    val to: LocalDate,
    val scope: String = "core-http-requests",
    val days: List<AiRequestMetricDayResponse>,
)

data class AiRequestMetricDayResponse(val date: LocalDate, val features: List<AiRequestMetricResponse>)

data class AiRequestMetricResponse(
    val feature: String, val total: Long, val success: Long, val accepted: Long,
    val clientErrors: Long, val serverErrors: Long, val other: Long,
    val latencySamples: Long, val p50UpperMs: Int?, val p95UpperMs: Int?,
) {
    companion object {
        fun from(value: AiRequestMetricResult) = AiRequestMetricResponse(value.feature, value.total,
            value.success, value.accepted, value.clientErrors, value.serverErrors, value.other,
            value.latencySamples, value.p50UpperMs, value.p95UpperMs)
    }
}
