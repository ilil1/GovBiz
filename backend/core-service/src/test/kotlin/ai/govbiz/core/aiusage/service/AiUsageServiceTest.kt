package ai.govbiz.core.aiusage.service

import ai.govbiz.core.admin.service.AdminAccessLogService
import ai.govbiz.core.admin.domain.AdminActor
import ai.govbiz.core.admin.domain.AdminAccessAction
import ai.govbiz.core.aiusage.config.AiCostProperties
import ai.govbiz.core.aiusage.domain.AiModelPrice
import ai.govbiz.core.aiusage.domain.AiModelUsage
import ai.govbiz.core.aiusage.domain.AiUsageTotals
import ai.govbiz.core.aiusage.repository.AiUsageRepository
import java.math.BigDecimal
import java.time.Clock
import java.time.Instant
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.ZoneId
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.Assertions.assertThrows
import org.mockito.Mockito

class AiUsageServiceTest {
    private val repository = Mockito.mock(AiUsageRepository::class.java)
    private val clock = Clock.fixed(Instant.parse("2026-10-01T20:00:00Z"), ZoneId.of("Asia/Seoul"))
    private val accessLog = Mockito.mock(AdminAccessLogService::class.java)
    private val service = AiUsageService(repository, accessLog, AiCostProperties(), clock)

    @Test
    fun traceLookupDoesNotReturnWithoutAuditRecord() {
        val actor = AdminActor.of(1, "198.51.100.7", null)
        val traceId = "1234567890abcdef1234567890abcdef"
        Mockito.doReturn(AiUsageTotals.EMPTY).`when`(repository).sumByTraceId(traceId)
        Mockito.doThrow(IllegalStateException("audit unavailable")).`when`(accessLog)
            .record(actor, AdminAccessAction.AI_COST_VIEW, null, "traceIdLength=32")
        assertThrows(IllegalStateException::class.java) { service.traceTotals(actor, traceId) }
    }

    @Test
    fun traceLookupRejectsMalformedIdentifiersBeforeQuerying() {
        val actor = AdminActor.of(1, "198.51.100.7", null)
        for (traceId in listOf("bad", "0".repeat(32), "A".repeat(32))) {
            assertThrows(IllegalArgumentException::class.java) { service.traceTotals(actor, traceId) }
        }
        Mockito.verifyNoInteractions(repository)
    }

    @Test
    fun priceDateIsUtcEvenWhenTheStoredApplicationTimestampIsAlreadyTheNextSeoulDay() {
        val old = AiModelPrice(1, "gpt-6-luna", "default", BigDecimal("0.1"), BigDecimal("0.01"), BigDecimal("0.5"), LocalDate.of(2026, 10, 1), null)
        val next = old.copy(id = 2, inputUsdPerMillion = BigDecimal.ONE, effectiveFrom = LocalDate.of(2026, 10, 2))
        Mockito.doReturn(listOf(old, next)).`when`(repository).findPrices()
        val usage = AiModelUsage("gpt-6-luna", "default", 1, 103, 0, 10, 100, 0)

        service.record("op", listOf(usage), null)

        Mockito.verify(repository).insertUsage(LocalDateTime.of(2026, 10, 2, 5, 0), null, "op", usage, old)
    }

    @Test
    fun memberMonthTotalsStillUseSeoulCalendarDates() {
        Mockito.doReturn(AiUsageTotals.EMPTY).`when`(repository).sumTotals(LocalDate.of(2026, 10, 1), LocalDate.of(2026, 10, 2), 7, false)

        service.monthTotals(7)

        Mockito.verify(repository).sumTotals(LocalDate.of(2026, 10, 1), LocalDate.of(2026, 10, 2), 7, false)
    }
}
