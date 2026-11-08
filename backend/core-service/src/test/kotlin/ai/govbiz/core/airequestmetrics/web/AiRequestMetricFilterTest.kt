package ai.govbiz.core.airequestmetrics.web

import ai.govbiz.core.airequestmetrics.service.AiRequestMetricService
import ai.govbiz.core.airequestmetrics.service.AiRequestMetricWriter
import ai.govbiz.core.airequestmetrics.repository.AiRequestMetricRepository
import jakarta.servlet.FilterChain
import java.time.LocalDate
import java.time.Duration
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Assertions.assertTimeoutPreemptively
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.mockito.Mockito.mock
import org.springframework.mock.web.MockHttpServletRequest
import org.springframework.mock.web.MockHttpServletResponse

class AiRequestMetricFilterTest {
    private class RecordingService : AiRequestMetricService(mock(AiRequestMetricRepository::class.java)) {
        val recorded = CountDownLatch(1)
        val release = CountDownLatch(1)
        var captured: Pair<String, Int>? = null
        var fail = false
        var block = false
        override fun record(date: LocalDate, feature: String, status: Int, elapsedMs: Long) {
            captured = feature to status
            recorded.countDown()
            if (block) release.await(5, TimeUnit.SECONDS)
            if (fail) throw IllegalStateException("private")
        }
    }
    @Test
    fun classifiesOnlyExplicitRoutesWithoutPersistingDynamicIdentifiers() {
        assertEquals("AI_SEARCH", AiRequestMetricFilter.featureOf("GET", "/api/v1/support-programs/search"))
        // 결과 토큰을 복원할 뿐 새 검색이나 모델 호출은 하지 않는다.
        assertEquals(null, AiRequestMetricFilter.featureOf("POST", "/api/v1/support-programs/search/results"))
        assertEquals("APPLICATION_SECTION", AiRequestMetricFilter.featureOf("POST", "/api/v1/application-preparations/12/sections/private/drafts"))
        assertEquals("APPLICATION_DOCUMENT", AiRequestMetricFilter.featureOf("POST", "/api/v1/application-preparations/12/documents/jobs"))
        assertEquals(null, AiRequestMetricFilter.featureOf("GET", "/api/v1/application-preparations/12/documents/jobs"))
    }

    @Test
    fun storageFailureDoesNotChangeResponse() {
        val service = RecordingService().apply { fail = true }
        val request = MockHttpServletRequest("POST", "/api/v1/assistant/messages")
        val response = MockHttpServletResponse()
        AiRequestMetricWriter(service).use { writer ->
            AiRequestMetricFilter(writer).doFilter(request, response, FilterChain { _, res -> (res as MockHttpServletResponse).status = 202 })
            assertTrue(service.recorded.await(2, TimeUnit.SECONDS))
            assertEquals(202, response.status)
        }
    }

    @Test
    fun thrownRequestIsRecordedAsServerFailureAndRethrown() {
        val service = RecordingService()
        val request = MockHttpServletRequest("POST", "/api/v1/assistant/messages")
        val response = MockHttpServletResponse()
        AiRequestMetricWriter(service).use { writer ->
            assertThrows(IllegalStateException::class.java) {
                AiRequestMetricFilter(writer).doFilter(request, response, FilterChain { _, _ -> throw IllegalStateException("private") })
            }
            assertTrue(service.recorded.await(2, TimeUnit.SECONDS))
            assertEquals("ASSISTANT" to 500, service.captured)
        }
    }

    @Test
    fun responseDoesNotWaitForBlockedDatabaseWrite() {
        val service = RecordingService().apply { block = true }
        val request = MockHttpServletRequest("POST", "/api/v1/assistant/messages")
        val response = MockHttpServletResponse()
        AiRequestMetricWriter(service).use { writer ->
            try {
                assertTimeoutPreemptively(Duration.ofSeconds(2)) {
                    AiRequestMetricFilter(writer).doFilter(request, response, FilterChain { _, res -> (res as MockHttpServletResponse).status = 503 })
                }
                assertTrue(service.recorded.await(2, TimeUnit.SECONDS))
                assertEquals(503, response.status)
            } finally {
                service.release.countDown()
            }
        }
    }
}
