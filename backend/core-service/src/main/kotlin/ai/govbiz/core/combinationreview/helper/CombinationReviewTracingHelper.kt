package ai.govbiz.core.combinationreview.helper

import ai.govbiz.core._common.exception.AiServiceCallException
import ai.govbiz.core._common.exception.AiServiceFailure
import ai.govbiz.core.combinationreview.facade.exception.AiCombinationReviewFacadeException
import io.opentelemetry.api.OpenTelemetry
import io.opentelemetry.api.trace.Span
import io.opentelemetry.api.trace.StatusCode
import io.opentelemetry.api.trace.Tracer
import io.opentelemetry.context.Context
import io.opentelemetry.context.ContextKey
import org.slf4j.LoggerFactory

/** 큐에서 처리한 중복 검토와 내부 모델 요청을 본문 없이 연결한다. */
class CombinationReviewTracingHelper(
    private val tracer: Tracer = OpenTelemetry.noop().getTracer("govbiz-combination"),
    private val environment: String = "development",
    private val release: String = "",
) {
    fun <T> observe(action: () -> T): T {
        val span = tracer.spanBuilder("combination.total").setNoParent().startSpan()
        span.setAttribute("langfuse.trace.name", "combination-review")
        span.setAttribute("langfuse.environment", environment)
        if (release.isNotEmpty()) span.setAttribute("langfuse.release", release)
        val scope = Context.current().with(span).with(COMBINATION_CONTEXT, true).makeCurrent()
        try {
            return action().also { span.setAttribute("langfuse.observation.metadata.outcome", "completed") }
        } catch (error: Throwable) {
            val aiError = if (error is AiCombinationReviewFacadeException) error.cause else error
            val outcome = if (aiError is AiServiceCallException && aiError.failure == AiServiceFailure.TIMEOUT) "timeout" else "failed"
            span.setStatus(StatusCode.ERROR)
            span.setAttribute("langfuse.observation.level", "ERROR")
            span.setAttribute("langfuse.observation.status_message", outcome)
            span.setAttribute("langfuse.observation.metadata.outcome", outcome)
            throw error
        } finally {
            if (span.isRecording) logger.info("combination_review trace_id={}", span.spanContext.traceId)
            scope.close()
            span.end()
        }
    }

    companion object {
        private val COMBINATION_CONTEXT = ContextKey.named<Boolean>("govbiz-combination")
        private val logger = LoggerFactory.getLogger(CombinationReviewTracingHelper::class.java)

        fun currentTraceParent(): String? {
            if (Context.current().get(COMBINATION_CONTEXT) != true) return null
            val context = Span.current().spanContext
            return if (context.isValid && context.isSampled) "00-${context.traceId}-${context.spanId}-01" else null
        }

        fun currentTraceId(): String? = currentTraceParent()?.split('-')?.get(1)
    }
}
