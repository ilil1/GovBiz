package ai.govbiz.core.airequestmetrics.service

import ai.govbiz.core.airequestmetrics.domain.AiRequestMetric
import ai.govbiz.core.airequestmetrics.repository.AiRequestMetricRepository
import java.time.LocalDate
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Test
import org.mockito.Mockito.doReturn
import org.mockito.Mockito.mock
import org.mockito.Mockito.verify

class AiRequestMetricServiceTest {
    private val repo = mock(AiRequestMetricRepository::class.java)
    private val service = AiRequestMetricService(repo)
    private val day = LocalDate.of(2026, 11, 8)

    @Test
    fun separatesAcceptedErrorsAndLatencyBuckets() {
        service.record(day, "ASSISTANT", 202, 101)
        service.record(day, "ASSISTANT", 500, 120_001)
        verify(repo).increment(day, "ASSISTANT", "ACCEPTED", 250)
        verify(repo).increment(day, "ASSISTANT", "SERVER_ERROR", 0)
    }

    @Test
    fun calculatesCountsAndNearestRankBucketUpperBound() {
        doReturn(listOf(AiRequestMetric("ASSISTANT", "SUCCESS", 100, 19),
            AiRequestMetric("ASSISTANT", "ACCEPTED", 0, 1))).`when`(repo).list(day, day)
        val item = service.summary(day, day).single()
        assertEquals(20L, item.total)
        assertEquals(19L, item.success)
        assertEquals(1L, item.accepted)
        assertEquals(100, item.p50UpperMs)
        assertEquals(100, item.p95UpperMs)
        doReturn(listOf(AiRequestMetric("ASSISTANT", "SERVER_ERROR", 0, 1))).`when`(repo).list(day, day)
        assertNull(service.summary(day, day).single().p95UpperMs)
    }

    @Test
    fun rejectsReversedOrTooLongPeriod() {
        assertThrows(IllegalArgumentException::class.java) { service.summary(day, day.minusDays(1)) }
        assertThrows(IllegalArgumentException::class.java) { service.summary(day, day.plusDays(31)) }
        assertThrows(IllegalArgumentException::class.java) { service.daily(day, day.plusDays(31)) }
    }

    @Test
    fun dailySeparatesDatesAndPreservesMissingDatesAndBucketSemantics() {
        val after = day.plusDays(2)
        doReturn(mapOf(after to listOf(AiRequestMetric("ASSISTANT", "SERVER_ERROR", 0, 1)),
            day to listOf(AiRequestMetric("ASSISTANT", "SUCCESS", 100, 19),
                AiRequestMetric("ASSISTANT", "ACCEPTED", 250, 1), AiRequestMetric("AI_SEARCH", "CLIENT_ERROR", 500, 1))))
            .`when`(repo).listDaily(day, after)
        val result = service.daily(day, after)
        assertEquals(listOf(day, after), result.keys.toList())
        assertEquals(null, result[day.plusDays(1)])
        val assistant = result.getValue(day).single { it.feature == "ASSISTANT" }
        assertEquals(19L, assistant.success)
        assertEquals(1L, assistant.accepted)
        assertEquals(100, assistant.p95UpperMs)
        assertEquals(1L, result.getValue(day).single { it.feature == "AI_SEARCH" }.clientErrors)
        assertNull(result.getValue(after).single().p95UpperMs)
    }
}
