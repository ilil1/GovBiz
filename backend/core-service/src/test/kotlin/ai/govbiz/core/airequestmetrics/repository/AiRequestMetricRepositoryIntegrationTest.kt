package ai.govbiz.core.airequestmetrics.repository

import ai.govbiz.core._common.test.MySqlTestContainerConfig
import ai.govbiz.core.airequestmetrics.service.AiRequestMetricService
import java.time.LocalDate
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.context.annotation.Import
import org.springframework.transaction.PlatformTransactionManager
import org.springframework.transaction.support.TransactionTemplate

@SpringBootTest(properties = [
    "app.account.jwt-secret=test-jwt-secret-0123456789abcdef0123456789",
    "app.ai-service.base-url=http://127.0.0.1:1",
    "app.bizinfo.sync.enabled=false",
    "app.support-program-index.enabled=false",
    "app.application-document.jobs.enabled=false",
    "app.ai-cost.sync-enabled=false",
])
@Import(MySqlTestContainerConfig::class)
class AiRequestMetricRepositoryIntegrationTest {
    @Autowired private lateinit var service: AiRequestMetricService
    @Autowired private lateinit var repository: AiRequestMetricRepository
    @Autowired private lateinit var transactionManager: PlatformTransactionManager

    @Test
    fun upsertBucketsAndRetainMetricWhenBusinessTransactionRollsBack() {
        val day = LocalDate.of(2001, 1, 15)
        TransactionTemplate(transactionManager).executeWithoutResult { transaction ->
            service.record(day, "INTEGRATION_TEST", 200, 150)
            service.record(day, "INTEGRATION_TEST", 200, 150)
            service.record(day, "INTEGRATION_TEST", 202, 121_000)
            transaction.setRollbackOnly()
        }
        val rows = repository.list(day, day).filter { it.feature == "INTEGRATION_TEST" }
        assertEquals(2L, rows.single { it.outcome == "SUCCESS" && it.bucket == 250 }.count)
        assertEquals(1L, rows.single { it.outcome == "ACCEPTED" && it.bucket == 0 }.count)
        val result = service.summary(day, day).single { it.feature == "INTEGRATION_TEST" }
        assertEquals(3L, result.total)
        assertEquals(1L, result.accepted)
        assertEquals(null, result.p95UpperMs)
    }

    @Test
    fun dailyQuerySeparatesDatesFeaturesAndOutcomeBuckets() {
        val day = LocalDate.of(2001, 2, 1)
        service.record(day, "DAILY_TEST", 202, 180)
        service.record(day, "DAILY_TEST", 502, 130_000)
        service.record(day.plusDays(2), "DAILY_TEST", 400, 90)
        val result = service.daily(day, day.plusDays(2))
        assertEquals(listOf(day, day.plusDays(2)), result.keys.toList())
        assertEquals(1L, result.getValue(day).single().accepted)
        assertEquals(1L, result.getValue(day).single().serverErrors)
        assertEquals(null, result.getValue(day).single().p95UpperMs)
        assertEquals(1L, result.getValue(day.plusDays(2)).single().clientErrors)
    }
}
