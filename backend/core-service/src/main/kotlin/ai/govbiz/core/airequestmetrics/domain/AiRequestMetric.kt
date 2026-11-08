package ai.govbiz.core.airequestmetrics.domain

data class AiRequestMetric(val feature: String, val outcome: String, val bucket: Int, val count: Long)
