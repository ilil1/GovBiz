package ai.govbiz.core.airequestmetrics.service

import ai.govbiz.core._common.domain.JobStatusSummary
import ai.govbiz.core.applicationpreparation.repository.ApplicationDocumentGenerationJobRepository
import ai.govbiz.core.applicationpreparation.repository.ApplicationFormDiscoveryJobRepository
import ai.govbiz.core.combinationreview.repository.CombinationReviewRunRepository
import java.time.LocalDate
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Test
import org.mockito.Mockito.doReturn
import org.mockito.Mockito.mock

class AiJobMetricsServiceTest {
    private val discovery = mock(ApplicationFormDiscoveryJobRepository::class.java)
    private val document = mock(ApplicationDocumentGenerationJobRepository::class.java)
    private val review = mock(CombinationReviewRunRepository::class.java)
    private val service = AiJobMetricsService(discovery, document, review)

    @Test
    fun convertsUtcDatesToSeoulAndReportsStatesAndFinishedDurations() {
        val day = LocalDate.of(2026, 11, 8)
        val from = day.atStartOfDay().plusHours(9)
        val until = day.plusDays(1).atStartOfDay().plusHours(9)
        doReturn(listOf(JobStatusSummary("QUEUED", 1, 0, 0), JobStatusSummary("SUCCEEDED", 2, 2, 3000), JobStatusSummary("UNKNOWN", 1, 1, 500)))
            .`when`(discovery).summarize(from, until)
        doReturn(emptyList<JobStatusSummary>()).`when`(document).summarize(from, until)
        doReturn(listOf(JobStatusSummary("INTERRUPTED", 1, 0, 0))).`when`(review).summarize(from, until)
        val results = service.summary(day, day)
        assertEquals(listOf("APPLICATION_DISCOVERY", "APPLICATION_DOCUMENT", "COMBINATION_REVIEW"), results.map { it.feature })
        assertEquals(4L, results[0].total)
        assertEquals(2L, results[0].succeeded)
        assertEquals(1L, results[0].unknown)
        assertEquals(3L, results[0].durationSamples)
        assertEquals(3500.0 / 3, results[0].averageDurationMs)
        assertEquals(0L, results[1].total)
        assertNull(results[1].averageDurationMs)
        assertEquals(1L, results[2].interrupted)
    }

    @Test
    fun rejectsInvalidPeriodsBeforeReadingRepositories() {
        val day = LocalDate.of(2026, 11, 8)
        assertThrows(IllegalArgumentException::class.java) { service.summary(day, day.minusDays(1)) }
        assertThrows(IllegalArgumentException::class.java) { service.summary(day, day.plusDays(31)) }
    }
}
