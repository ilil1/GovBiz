package ai.govbiz.core.airequestmetrics.web

import ai.govbiz.core.airequestmetrics.service.AiRequestMetricService
import ai.govbiz.core.airequestmetrics.repository.AiRequestMetricRepository
import jakarta.servlet.FilterChain
import java.time.LocalDate
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Test
import org.mockito.Mockito.mock
import org.springframework.mock.web.MockHttpServletRequest
import org.springframework.mock.web.MockHttpServletResponse

class AiRequestMetricFilterTest {
    private class RecordingService : AiRequestMetricService(mock(AiRequestMetricRepository::class.java)) {
        var captured: Pair<String, Int>? = null
        var fail = false
        override fun record(date: LocalDate, feature: String, status: Int, elapsedMs: Long) {
            captured = feature to status
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
        AiRequestMetricFilter(service).doFilter(request, response, FilterChain { _, res -> (res as MockHttpServletResponse).status = 202 })
        assertEquals(202, response.status)
    }

    @Test
    fun thrownRequestIsRecordedAsServerFailureAndRethrown() {
        val service = RecordingService()
        val request = MockHttpServletRequest("POST", "/api/v1/assistant/messages")
        val response = MockHttpServletResponse()
        assertThrows(IllegalStateException::class.java) {
            AiRequestMetricFilter(service).doFilter(request, response, FilterChain { _, _ -> throw IllegalStateException("private") })
        }
        assertEquals("ASSISTANT" to 500, service.captured)
    }
}
