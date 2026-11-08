package ai.govbiz.core.airequestmetrics.repository

import ai.govbiz.core.airequestmetrics.repository.mapper.AiRequestMetricMapper
import ai.govbiz.core.airequestmetrics.domain.AiRequestMetric
import java.time.LocalDate
import org.springframework.stereotype.Repository

@Repository
class AiRequestMetricRepository(private val mapper: AiRequestMetricMapper) {
    fun increment(date: LocalDate, feature: String, outcome: String, bucket: Int) {
        mapper.increment(date, feature, outcome, bucket)
    }

    fun list(from: LocalDate, to: LocalDate): List<AiRequestMetric> =
        mapper.list(from, to).map { AiRequestMetric(it.feature, it.outcome, it.latencyBucketMs, it.requestCount) }
}
