package ai.govbiz.core.airequestmetrics.controller

import ai.govbiz.core._common.exception.ApiExceptionHandler
import ai.govbiz.core.account.domain.AccountRole
import ai.govbiz.core.account.helper.AccountTestHelper
import ai.govbiz.core.account.helper.SessionCookieHelper
import ai.govbiz.core.account.service.AccountSessionService
import ai.govbiz.core.account.service.exception.AuthenticationRequiredException
import ai.govbiz.core.admin.web.AdminPrincipalArgumentResolver
import ai.govbiz.core.airequestmetrics.service.AiJobMetricsService
import ai.govbiz.core.airequestmetrics.service.dto.AiJobMetricsResult
import jakarta.servlet.http.Cookie
import java.time.LocalDate
import org.junit.jupiter.api.Test
import org.mockito.Mockito.doReturn
import org.mockito.Mockito.doThrow
import org.mockito.Mockito.mock
import org.springframework.http.HttpHeaders
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.header
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.status
import org.springframework.test.web.servlet.setup.MockMvcBuilders

class AiJobMetricsControllerTest {
    private val sessions = mock(AccountSessionService::class.java)
    private val service = mock(AiJobMetricsService::class.java)
    private val mvc = MockMvcBuilders.standaloneSetup(AiJobMetricsController(service))
        .setCustomArgumentResolvers(AdminPrincipalArgumentResolver { sessions }).setControllerAdvice(ApiExceptionHandler()).build()
    private val path = "/api/v1/admin/ai-request-metrics/jobs?from=2026-11-08&to=2026-11-08"
    private val day = LocalDate.of(2026, 11, 8)

    @Test
    fun allowsOnlyAdminsAndReturnsNoStoreResults() {
        doThrow(AuthenticationRequiredException()).`when`(sessions).requireAccount(null)
        doReturn(AccountTestHelper.account(id = 2, email = "member@govbiz.local", role = AccountRole.USER))
            .`when`(sessions).requireAccount("member")
        doReturn(AccountTestHelper.account(id = 1, email = "admin@govbiz.local", role = AccountRole.ADMIN))
            .`when`(sessions).requireAccount("admin")
        doReturn(listOf(AiJobMetricsResult("APPLICATION_DOCUMENT", 2, 1, 0, 1, 0, 0, 0, 1, 500.0)))
            .`when`(service).summary(day, day)
        mvc.perform(get(path)).andExpect(status().isUnauthorized())
        mvc.perform(get(path).cookie(Cookie(SessionCookieHelper.COOKIE_NAME, "member"))).andExpect(status().isForbidden())
        mvc.perform(get(path).cookie(Cookie(SessionCookieHelper.COOKIE_NAME, "admin")))
            .andExpect(status().isOk()).andExpect(header().string(HttpHeaders.CACHE_CONTROL, "no-store"))
            .andExpect(jsonPath("$.scope").value("stored-ai-jobs"))
            .andExpect(jsonPath("$.features[0].succeeded").value(1))
            .andExpect(jsonPath("$.features[0].averageDurationMs").value(500.0))
        doThrow(IllegalArgumentException("invalid")).`when`(service).summary(day, day)
        mvc.perform(get(path).cookie(Cookie(SessionCookieHelper.COOKIE_NAME, "admin"))).andExpect(status().isBadRequest())
    }
}
