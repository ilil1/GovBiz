package ai.govbiz.core.airequestmetrics.web

import ai.govbiz.core.airequestmetrics.service.AiRequestMetricWriter
import jakarta.servlet.FilterChain
import jakarta.servlet.http.HttpServletRequest
import jakarta.servlet.http.HttpServletResponse
import java.time.Instant
import java.time.ZoneOffset
import org.slf4j.LoggerFactory
import org.springframework.core.Ordered
import org.springframework.core.annotation.Order
import org.springframework.web.filter.OncePerRequestFilter

/** 요청 본문·계정·경로 식별자를 저장하지 않고 허용된 공개 HTTP 요청만 센다. */
@Order(Ordered.HIGHEST_PRECEDENCE + 20)
class AiRequestMetricFilter(private val writer: AiRequestMetricWriter) : OncePerRequestFilter() {
    override fun doFilterInternal(request: HttpServletRequest, response: HttpServletResponse, chain: FilterChain) {
        val feature = featureOf(request.method, request.requestURI.removePrefix(request.contextPath))
        if (feature == null) {
            chain.doFilter(request, response)
            return
        }
        val date = Instant.now().atZone(ZoneOffset.UTC).toLocalDate()
        val started = System.nanoTime()
        var thrown = false
        try {
            chain.doFilter(request, response)
        } catch (error: Throwable) {
            thrown = true
            throw error
        } finally {
            val elapsed = (System.nanoTime() - started).coerceAtLeast(0) / 1_000_000
            try {
                writer.submit(date, feature, if (thrown) 500 else response.status, elapsed)
            } catch (error: Exception) {
                // 제출 장애도 업무 응답을 바꾸지 않으며 본문·예외 원문을 남기지 않는다.
                log.warn("ai_request_metric_submit_failed feature={} error={}", feature, error.javaClass.simpleName)
            }
        }
    }

    companion object {
        private val log = LoggerFactory.getLogger(AiRequestMetricFilter::class.java)
        private val section = Regex("^/api/v1/application-preparations/[0-9]+/sections/[^/]+/(messages|drafts)$")
        private val document = Regex("^/api/v1/application-preparations/[0-9]+/documents/jobs$")
        private val review = Regex("^/api/v1/combination-reviews/[0-9]+/runs$")

        fun featureOf(method: String, path: String): String? = when {
            method in setOf("GET", "POST") && path == "/api/v1/support-programs/search" -> "AI_SEARCH"
            method != "POST" -> null
            path == "/api/v1/support-programs/detail/answers" -> "EVIDENCE_QUESTION"
            path == "/api/v1/support-programs/conversation/interpret" -> "SEARCH_CONVERSATION"
            path == "/api/v1/assistant/messages" -> "ASSISTANT"
            path == "/api/v1/gov-agent/messages" -> "GOV_AGENT"
            path == "/api/v1/application-preparations/forms/discover" ||
                path == "/api/v1/application-preparations/forms/discovery-jobs" -> "APPLICATION_DISCOVERY"
            section.matches(path) -> "APPLICATION_SECTION"
            document.matches(path) -> "APPLICATION_DOCUMENT"
            review.matches(path) -> "COMBINATION_REVIEW"
            else -> null
        }
    }
}
