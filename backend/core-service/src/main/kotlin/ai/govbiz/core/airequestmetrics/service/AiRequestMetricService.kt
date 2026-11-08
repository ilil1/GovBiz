package ai.govbiz.core.airequestmetrics.service

import ai.govbiz.core.airequestmetrics.repository.AiRequestMetricRepository
import ai.govbiz.core.airequestmetrics.domain.AiRequestMetric
import ai.govbiz.core.airequestmetrics.service.dto.AiRequestMetricResult
import java.time.LocalDate
import java.time.temporal.ChronoUnit
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Propagation
import org.springframework.transaction.annotation.Transactional

@Service
class AiRequestMetricService(private val repository: AiRequestMetricRepository) {
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    fun record(date: LocalDate, feature: String, status: Int, elapsedMs: Long) {
        val outcome = when (status) {
            202 -> "ACCEPTED"
            in 200..299 -> "SUCCESS"
            in 400..499 -> "CLIENT_ERROR"
            in 500..599 -> "SERVER_ERROR"
            else -> "OTHER"
        }
        val bucket = BUCKETS.firstOrNull { elapsedMs <= it } ?: 0
        repository.increment(date, feature, outcome, bucket)
    }

    fun summary(from: LocalDate, to: LocalDate): List<AiRequestMetricResult> {
        validatePeriod(from, to)
        return aggregate(repository.list(from, to))
    }

    fun daily(from: LocalDate, to: LocalDate): Map<LocalDate, List<AiRequestMetricResult>> {
        validatePeriod(from, to)
        return repository.listDaily(from, to).toSortedMap().mapValues { (_, rows) -> aggregate(rows) }
    }

    private fun validatePeriod(from: LocalDate, to: LocalDate) {
        require(!to.isBefore(from) && ChronoUnit.DAYS.between(from, to) < 31) { "period must be 1~31 days" }
    }

    private fun aggregate(metrics: List<AiRequestMetric>): List<AiRequestMetricResult> =
        metrics.groupBy { it.feature }.toSortedMap().map { (feature, rows) ->
            val total = rows.sumOf { it.count }
            fun count(outcome: String) = rows.filter { it.outcome == outcome }.sumOf { it.count }
            fun percentile(numerator: Long): Int? {
                val target = (total * numerator + 99) / 100
                var cumulative = 0L
                for ((bucket, count) in rows.groupBy { it.bucket }.mapValues { (_, values) -> values.sumOf { it.count } }
                    .entries.sortedBy { if (it.key == 0) Int.MAX_VALUE else it.key }) {
                    cumulative += count
                    if (cumulative >= target) return bucket.takeIf { it != 0 }
                }
                return null
            }
            AiRequestMetricResult(feature, total, count("SUCCESS"), count("ACCEPTED"), count("CLIENT_ERROR"),
                count("SERVER_ERROR"), count("OTHER"), total, percentile(50), percentile(95))
        }

    companion object {
        val BUCKETS = listOf(100, 250, 500, 1_000, 2_500, 5_000, 10_000, 30_000, 60_000, 120_000)
    }
}
