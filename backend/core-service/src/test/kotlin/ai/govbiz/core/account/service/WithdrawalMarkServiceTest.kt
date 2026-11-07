package ai.govbiz.core.account.service

import ai.govbiz.core.account.domain.WithdrawnIdentity
import ai.govbiz.core.account.domain.WithdrawnIdentityKind
import ai.govbiz.core.account.helper.AccountTestHelper
import ai.govbiz.core.account.helper.AccountTestHelper.NOW
import ai.govbiz.core.account.repository.WithdrawalMarkRepository
import ai.govbiz.core.planusage.service.PlanUsageService
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNotEquals
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.mockito.ArgumentCaptor
import org.mockito.Mockito

class WithdrawalMarkServiceTest {
    private val repository = Mockito.mock(WithdrawalMarkRepository::class.java)
    private val planUsage = Mockito.mock(PlanUsageService::class.java)

    private fun service(hmacKey: String = "identity-key", jwtSecret: String = AccountTestHelper.JWT_SECRET) =
        WithdrawalMarkService(repository, planUsage, AccountTestHelper.FIXED_CLOCK, hmacKey, jwtSecret)

    @Test
    fun keepsOnlyKeyedHashesForAYearAndNeverTheIdentityItself() {
        service().record(7L, WithdrawnIdentity.of("manager@company.co.kr", emptyList(), "124-81-00998"), NOW)

        val hashes = recorded(7L)
        assertEquals(setOf(WithdrawnIdentityKind.EMAIL, WithdrawnIdentityKind.BUSINESS_NUMBER), hashes.keys)
        hashes.values.flatten().forEach { hash ->
            assertTrue(Regex("^[0-9a-f]{64}$").matches(hash))
            assertTrue("manager" !in hash && "1248100998" !in hash)
        }
    }

    @Test
    fun theSameIdentityHashesTheSameAndAnotherKeyOrKindHashesDifferently() {
        val email = WithdrawnIdentity.email("manager@company.co.kr")
        assertEquals(hashOf(service(), email), hashOf(service(), WithdrawnIdentity.email(" Manager@Company.co.kr")))
        assertNotEquals(hashOf(service(), email), hashOf(service(hmacKey = "another-key"), email))
        // 비어 있으면 세션 JWT 비밀값을 키로 씁니다.
        assertEquals(hashOf(service(hmacKey = "", jwtSecret = "identity-key"), email), hashOf(service(), email))
        assertNotEquals(
            hashOf(service(), WithdrawnIdentity(WithdrawnIdentityKind.EMAIL, "1248100998")),
            hashOf(service(), WithdrawnIdentity.businessNumber("1248100998")),
        )
        assertThrows(IllegalArgumentException::class.java) { service(hmacKey = "", jwtSecret = "") }
    }

    @Test
    fun inheritsEachMatchingWithdrawnAccountOnceAndMarksItUsed() {
        Mockito.doReturn(listOf(3L, 5L)).`when`(repository).lockInheritableAccounts(anyList(), Mockito.eq(9L), Mockito.eq(NOW) ?: NOW)

        assertEquals(listOf(3L, 5L), service().inherit(9L, listOf(WithdrawnIdentity.email("manager@company.co.kr"))))

        val order = Mockito.inOrder(repository, planUsage)
        order.verify(repository).lockInheritableAccounts(anyList(), Mockito.eq(9L), Mockito.eq(NOW) ?: NOW)
        order.verify(planUsage).inherit(3L, 9L)
        order.verify(planUsage).inherit(5L, 9L)
        order.verify(repository).markInherited(listOf(3L, 5L), 9L, NOW)
    }

    @Test
    fun noMatchInheritsNothing() {
        Mockito.doReturn(emptyList<Long>()).`when`(repository).lockInheritableAccounts(anyList(), Mockito.eq(9L), Mockito.eq(NOW) ?: NOW)

        assertEquals(emptyList<Long>(), service().inherit(9L, listOf(WithdrawnIdentity.email("new@company.co.kr"))))

        Mockito.verifyNoInteractions(planUsage)
    }

    private fun hashOf(service: WithdrawalMarkService, identity: WithdrawnIdentity): String {
        Mockito.clearInvocations(repository)
        service.record(1L, listOf(identity), NOW)
        return recorded(1L).values.flatten().single()
    }

    /** 1년 보관 기간으로 남긴 식별자 HMAC입니다. */
    @Suppress("UNCHECKED_CAST")
    private fun recorded(accountId: Long): Map<WithdrawnIdentityKind, List<String>> {
        val captor = ArgumentCaptor.forClass(Map::class.java) as ArgumentCaptor<Map<WithdrawnIdentityKind, List<String>>>
        Mockito.verify(repository).record(Mockito.eq(accountId), captor.capture() ?: emptyMap(), Mockito.eq(NOW) ?: NOW, Mockito.eq(NOW.plusDays(365)) ?: NOW)
        return captor.value
    }

    @Suppress("UNCHECKED_CAST")
    private fun <T> anyList(): List<T> = Mockito.anyList<T>() ?: emptyList()
}
