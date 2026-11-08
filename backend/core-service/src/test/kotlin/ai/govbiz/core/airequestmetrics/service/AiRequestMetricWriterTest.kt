package ai.govbiz.core.airequestmetrics.service

import ai.govbiz.core.airequestmetrics.repository.AiRequestMetricRepository
import java.time.Duration
import java.time.LocalDate
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTimeoutPreemptively
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.extension.ExtendWith
import org.mockito.Mockito.mock
import org.springframework.boot.test.system.CapturedOutput
import org.springframework.boot.test.system.OutputCaptureExtension

@ExtendWith(OutputCaptureExtension::class)
class AiRequestMetricWriterTest {
    private val day = LocalDate.of(2026, 11, 8)

    private class PausingService : AiRequestMetricService(mock(AiRequestMetricRepository::class.java)) {
        val entered = CountDownLatch(1)
        val release = CountDownLatch(1)
        val calls = AtomicInteger()
        override fun record(date: LocalDate, feature: String, status: Int, elapsedMs: Long) {
            calls.incrementAndGet()
            entered.countDown()
            release.await(10, TimeUnit.SECONDS)
        }
    }

    @Test
    fun boundedQueueRejectsWithoutWaitingAndDrainsAcceptedRecords(output: CapturedOutput) {
        val service = PausingService()
        AiRequestMetricWriter(service, queueCapacity = 1).use { writer ->
            try {
                assertTrue(writer.submit(day, "ASSISTANT", 200, 10))
                assertTrue(service.entered.await(2, TimeUnit.SECONDS))
                assertTrue(writer.submit(day, "ASSISTANT", 500, 20))
                assertTimeoutPreemptively(Duration.ofSeconds(1)) {
                    assertFalse(writer.submit(day, "ASSISTANT", 200, 30))
                }
            } finally {
                service.release.countDown()
            }
        }
        assertEquals(2, service.calls.get())
        assertTrue(output.out.contains("ai_request_metric_dropped count_since_start=1"))
    }

    @Test
    fun databaseFailureDoesNotPreventSubsequentRecords(output: CapturedOutput) {
        val calls = AtomicInteger()
        val finished = CountDownLatch(1)
        val service = object : AiRequestMetricService(mock(AiRequestMetricRepository::class.java)) {
            override fun record(date: LocalDate, feature: String, status: Int, elapsedMs: Long) {
                if (calls.incrementAndGet() <= 3) throw IllegalStateException("private database detail")
                finished.countDown()
            }
        }
        AiRequestMetricWriter(service).use { writer ->
            assertTrue(writer.submit(day, "ASSISTANT", 200, 1))
            assertTrue(writer.submit(day, "ASSISTANT", 500, 2))
            assertTrue(writer.submit(day, "ASSISTANT", 500, 3))
            assertTrue(writer.submit(day, "ASSISTANT", 200, 4))
            assertTrue(finished.await(2, TimeUnit.SECONDS))
        }
        assertEquals(4, calls.get())
        assertTrue(output.out.contains("ai_request_metric_record_failed count_since_start=1"))
        assertTrue(output.out.contains("ai_request_metric_record_failed count_since_start=2"))
        assertFalse(output.out.contains("ai_request_metric_record_failed count_since_start=3"))
        assertFalse(output.out.contains("private database detail"))
    }

    @Test
    fun shutdownWaitIsBoundedAndNewSubmissionsAreRejected() {
        val service = PausingService()
        val writer = AiRequestMetricWriter(service, queueCapacity = 1)
        try {
            assertTrue(writer.submit(day, "ASSISTANT", 200, 10))
            assertTrue(service.entered.await(2, TimeUnit.SECONDS))
            assertTrue(writer.submit(day, "ASSISTANT", 200, 20))
            assertTimeoutPreemptively(Duration.ofSeconds(5)) { writer.close() }
            assertFalse(writer.submit(day, "ASSISTANT", 200, 30))
        } finally {
            service.release.countDown()
            writer.close()
        }
    }
}
