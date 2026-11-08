package ai.govbiz.core.airequestmetrics.controller

import ai.govbiz.core._common.exception.ApiExceptionHandler
import ai.govbiz.core.account.domain.AccountRole
import ai.govbiz.core.account.helper.AccountTestHelper
import ai.govbiz.core.account.helper.SessionCookieHelper
import ai.govbiz.core.account.service.AccountSessionService
import ai.govbiz.core.account.service.exception.AuthenticationRequiredException
import ai.govbiz.core.admin.web.AdminPrincipalArgumentResolver
import ai.govbiz.core.airequestmetrics.service.AiRequestMetricService
import ai.govbiz.core.airequestmetrics.service.dto.AiRequestMetricResult
import jakarta.servlet.http.Cookie
import java.time.LocalDate
import org.junit.jupiter.api.Test
import org.mockito.Mockito.doReturn
import org.mockito.Mockito.mock
import org.springframework.http.HttpHeaders
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.header
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.status
import org.springframework.test.web.servlet.setup.MockMvcBuilders

class AiRequestMetricsControllerTest {
    private val sessions = mock(AccountSessionService::class.java)
    private val service = mock(AiRequestMetricService::class.java)
    private val mvc = MockMvcBuilders.standaloneSetup(AiRequestMetricsController(service))
        .setCustomArgumentResolvers(AdminPrincipalArgumentResolver { sessions })
        .setControllerAdvice(ApiExceptionHandler()).build()
    private val path = "/api/v1/admin/ai-request-metrics?from=2026-11-08&to=2026-11-08"
    private val day = LocalDate.of(2026, 11, 8)

    @Test
    fun adminCanReadNoStoreAggregate() {
        doReturn(AccountTestHelper.account(id = 1, email = "admin@govbiz.local", role = AccountRole.ADMIN))
            .`when`(sessions).requireAccount("admin-session")
        doReturn(listOf(AiRequestMetricResult("ASSISTANT", 2, 1, 1, 0, 0, 0, 2, 250, 1000)))
            .`when`(service).summary(day, day)
        mvc.perform(get(path).cookie(Cookie(SessionCookieHelper.COOKIE_NAME, "admin-session")))
            .andExpect(status().isOk()).andExpect(header().string(HttpHeaders.CACHE_CONTROL, "no-store"))
            .andExpect(jsonPath("$.scope").value("core-http-requests"))
            .andExpect(jsonPath("$.features[0].accepted").value(1))
            .andExpect(jsonPath("$.features[0].p95UpperMs").value(1000))
    }

    @Test
    fun requiresAdminAndRejectsInvalidRange() {
        org.mockito.Mockito.doThrow(AuthenticationRequiredException()).`when`(sessions).requireAccount(null)
        doReturn(AccountTestHelper.account(id = 2, email = "member@govbiz.local", role = AccountRole.USER))
            .`when`(sessions).requireAccount("member-session")
        doReturn(AccountTestHelper.account(id = 1, email = "admin@govbiz.local", role = AccountRole.ADMIN))
            .`when`(sessions).requireAccount("admin-session")
        mvc.perform(get(path)).andExpect(status().isUnauthorized())
        mvc.perform(get(path).cookie(Cookie(SessionCookieHelper.COOKIE_NAME, "member-session"))).andExpect(status().isForbidden())
        org.mockito.Mockito.doThrow(IllegalArgumentException("invalid")).`when`(service).summary(day, day)
        mvc.perform(get(path).cookie(Cookie(SessionCookieHelper.COOKIE_NAME, "admin-session"))).andExpect(status().isBadRequest())
    }

    @Test
    fun dailyRequiresAdminAndReturnsUtcDatesWithoutFillingMissingDays() {
        doReturn(AccountTestHelper.account(id = 1, email = "admin@govbiz.local", role = AccountRole.ADMIN))
            .`when`(sessions).requireAccount("admin-session")
        doReturn(mapOf(day to listOf(AiRequestMetricResult("ASSISTANT", 2, 1, 1, 0, 0, 0, 2, 250, 1000))))
            .`when`(service).daily(day, day)
        mvc.perform(get("/api/v1/admin/ai-request-metrics/daily?from=2026-11-08&to=2026-11-08")
            .cookie(Cookie(SessionCookieHelper.COOKIE_NAME, "admin-session")))
            .andExpect(status().isOk()).andExpect(header().string(HttpHeaders.CACHE_CONTROL, "no-store"))
            .andExpect(jsonPath("$.scope").value("core-http-requests"))
            .andExpect(jsonPath("$.days[0].date").value("2026-11-08"))
            .andExpect(jsonPath("$.days[0].features[0].accepted").value(1))
    }
}
