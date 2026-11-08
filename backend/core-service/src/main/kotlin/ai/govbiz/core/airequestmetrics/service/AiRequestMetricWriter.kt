package ai.govbiz.core.airequestmetrics.service

import java.time.LocalDate
import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.ThreadPoolExecutor
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicLong
import org.slf4j.LoggerFactory

/** 사용자 요청을 기다리게 하지 않도록 제한된 큐에서 집계를 기록합니다. */
class AiRequestMetricWriter(
    private val service: AiRequestMetricService,
    queueCapacity: Int = 1024,
) : AutoCloseable {
    private val rejected = AtomicLong()
    private val failed = AtomicLong()
    private val executor = ThreadPoolExecutor(
        1, 1, 0, TimeUnit.MILLISECONDS, ArrayBlockingQueue(queueCapacity),
        { task -> Thread(task, "ai-request-metrics").apply { isDaemon = true } },
        ThreadPoolExecutor.AbortPolicy(),
    )

    /** false는 큐 포화 또는 종료로 기록하지 못했음을 뜻합니다. 호출 측에서 재시도하지 않습니다. */
    fun submit(date: LocalDate, feature: String, status: Int, elapsedMs: Long): Boolean = try {
        executor.execute {
            try {
                service.record(date, feature, status, elapsedMs)
            } catch (error: Exception) {
                val count = failed.incrementAndGet()
                if ((count and (count - 1)) == 0L) {
                    log.warn("ai_request_metric_record_failed count_since_start={} error={}", count, error.javaClass.simpleName)
                }
            }
        }
        true
    } catch (_: RejectedExecutionException) {
        // 장애 중 요청마다 로그가 발생하지 않도록 1, 2, 4, 8...번째 거절만 기록합니다.
        val count = rejected.incrementAndGet()
        if ((count and (count - 1)) == 0L) log.warn("ai_request_metric_dropped count_since_start={}", count)
        false
    }

    override fun close() {
        executor.shutdown()
        try {
            if (!executor.awaitTermination(2, TimeUnit.SECONDS)) {
                val queued = executor.shutdownNow().size
                log.warn("ai_request_metric_shutdown_timeout queued_dropped={}", queued)
            }
        } catch (_: InterruptedException) {
            val queued = executor.shutdownNow().size
            Thread.currentThread().interrupt()
            log.warn("ai_request_metric_shutdown_interrupted queued_dropped={}", queued)
        }
    }

    private companion object {
        val log = LoggerFactory.getLogger(AiRequestMetricWriter::class.java)
    }
}
