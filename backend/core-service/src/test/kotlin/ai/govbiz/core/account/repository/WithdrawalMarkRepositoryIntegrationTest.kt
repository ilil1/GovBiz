package ai.govbiz.core.account.repository

import ai.govbiz.core._common.test.MySqlTestContainerConfig
import ai.govbiz.core.account.domain.NewAccount
import ai.govbiz.core.account.domain.OAuthProvider
import ai.govbiz.core.account.domain.WithdrawnIdentity
import ai.govbiz.core.account.service.WithdrawalMarkService
import ai.govbiz.core.planusage.domain.PlanCode
import ai.govbiz.core.planusage.domain.PlanUsageFeature
import ai.govbiz.core.planusage.domain.PlanUsagePeriod
import ai.govbiz.core.planusage.domain.PlanUsageWindow
import ai.govbiz.core.planusage.repository.PlanUsageRepository
import java.time.LocalDateTime
import java.time.ZoneId
import java.time.ZonedDateTime
import java.util.UUID
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.context.annotation.Import
import org.springframework.dao.DataAccessException
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.transaction.PlatformTransactionManager
import org.springframework.transaction.support.TransactionTemplate

/** 실제 MySQL 8.4에서 탈퇴 표식의 이어받기(체험·이번 기간 사용량), 한 번만 쓰기, 만료·정리, 실패 시 보존과 제약을 확인합니다. */
@SpringBootTest(properties = [
    "app.account.jwt-secret=test-jwt-secret-0123456789abcdef0123456789",
    "app.ai-service.base-url=http://127.0.0.1:1",
    "app.bizinfo.sync.enabled=false",
    "app.support-program-index.enabled=false",
    "app.application-document.jobs.enabled=false",
    "app.account.withdrawal-mark.purge-enabled=false",
])
@Import(MySqlTestContainerConfig::class)
class WithdrawalMarkRepositoryIntegrationTest {
    @Autowired private lateinit var marks: WithdrawalMarkService
    @Autowired private lateinit var accounts: AccountRepository
    @Autowired private lateinit var planUsage: PlanUsageRepository
    @Autowired private lateinit var jdbc: JdbcTemplate
    @Autowired private lateinit var transactionManager: PlatformTransactionManager
    private val seoul = ZoneId.of("Asia/Seoul")

    @Test
    fun aReturningMemberInheritsUsedTrialsAndThisPeriodsUsageOnlyOnce() {
        val email = "Returning-${UUID.randomUUID()}@Example.test"
        val withdrawn = account(email.lowercase())
        val now = ZonedDateTime.now(seoul)
        val today = PlanUsageWindow.current(PlanUsagePeriod.DAY, now)
        val month = PlanUsageWindow.current(PlanUsagePeriod.MONTH, now)
        planUsage.startTrial(withdrawn, PlanCode.PLUS, now.minusDays(20), now.minusDays(6))
        planUsage.addCount(withdrawn, PlanUsageFeature.AI_SEARCH, today.key, 3)
        planUsage.addCount(withdrawn, PlanUsageFeature.APPLICATION_DRAFT, month.key, 1)
        planUsage.addDraftProgram(withdrawn, "BIZINFO", "PBLN_RETURNING")
        withdraw(withdrawn, listOf(WithdrawnIdentity.email(email), WithdrawnIdentity.oauth(OAuthProvider.KAKAO, "k-$withdrawn")))

        // 탈퇴하면 이메일이 바뀌므로 같은 이메일로 다시 가입할 수 있고, 새 계정이 탈퇴 계정의 기록을 이어받습니다.
        val returning = account(email.lowercase())
        assertEquals(listOf(withdrawn), inTransaction { marks.inherit(returning, listOf(WithdrawnIdentity.email(email.uppercase()))) })

        assertEquals(setOf(PlanCode.PLUS), planUsage.findTrialPlans(returning))
        val counted = planUsage.findCounts(returning, listOf(today.key, month.key))
        assertEquals(3, counted[PlanUsageFeature.AI_SEARCH to today.key])
        // 남긴 사용량 1과 아직 남아 있는 작업 1을 더해 옮깁니다.
        assertEquals(2, counted[PlanUsageFeature.APPLICATION_DRAFT to month.key])
        assertEquals(listOf(withdrawn), accountsInheritedBy(returning))

        // 같은 탈퇴 계정의 다른 식별자(소셜 연결)로 또 가입해도 다시 이어받지 않습니다.
        val another = account("another-${UUID.randomUUID()}@example.test")
        assertEquals(emptyList<Long>(), inTransaction { marks.inherit(another, listOf(WithdrawnIdentity.oauth(OAuthProvider.KAKAO, "k-$withdrawn"))) })
        assertEquals(emptySet<PlanCode>(), planUsage.findTrialPlans(another))
    }

    @Test
    fun aFailedSignupLeavesTheMarkForTheNextTry() {
        val email = "retry-${UUID.randomUUID()}@example.test"
        val withdrawn = account(email)
        val today = PlanUsageWindow.current(PlanUsagePeriod.DAY, ZonedDateTime.now(seoul))
        planUsage.addCount(withdrawn, PlanUsageFeature.EVIDENCE_QUESTION, today.key, 1)
        withdraw(withdrawn, listOf(WithdrawnIdentity.email(email)))
        val returning = account(email)

        assertThrows(IllegalStateException::class.java) {
            inTransaction {
                marks.inherit(returning, listOf(WithdrawnIdentity.email(email)))
                error("가입 마무리 실패")
            }
        }

        assertEquals(emptyMap<Pair<PlanUsageFeature, String>, Int>(), planUsage.findCounts(returning, listOf(today.key)))
        assertEquals(listOf(withdrawn), inTransaction { marks.inherit(returning, listOf(WithdrawnIdentity.email(email))) })
        assertEquals(1, planUsage.findCounts(returning, listOf(today.key))[PlanUsageFeature.EVIDENCE_QUESTION to today.key])
    }

    @Test
    fun marksOlderThanAYearAreNeitherInheritedNorKeptAfterThePurge() {
        val email = "expired-${UUID.randomUUID()}@example.test"
        val withdrawn = account(email)
        withdraw(withdrawn, listOf(WithdrawnIdentity.email(email)), LocalDateTime.now(seoul).minusDays(366))

        assertEquals(emptyList<Long>(), inTransaction { marks.inherit(account(email), listOf(WithdrawnIdentity.email(email))) })
        assertTrue(marks.purgeExpired() >= 1)
        assertEquals(0, markCount(withdrawn))
    }

    @Test
    fun theDatabaseKeepsOneWellFormedMarkPerAccountAndIdentity() {
        val email = "constraint-${UUID.randomUUID()}@example.test"
        val withdrawn = account(email)
        withdraw(withdrawn, listOf(WithdrawnIdentity.email(email), WithdrawnIdentity.email(email.uppercase()), WithdrawnIdentity.businessNumber("124-81-00998")))
        assertEquals(2, markCount(withdrawn))
        // 같은 탈퇴를 다시 남겨도 늘지 않습니다.
        inTransaction { marks.record(withdrawn, listOf(WithdrawnIdentity.email(email)), LocalDateTime.now(seoul)) }
        assertEquals(2, markCount(withdrawn))
        assertEquals(listOf("BUSINESS_NUMBER", "EMAIL"), jdbc.queryForList(
            "SELECT identity_kind FROM account_withdrawal_mark WHERE account_id = ? ORDER BY identity_kind", String::class.java, withdrawn))

        val hash = "a".repeat(64)
        listOf(
            "INSERT INTO account_withdrawal_mark (identity_kind, identity_hash, account_id, withdrawn_at, expires_at) VALUES ('PHONE', '$hash', ?, NOW(6), NOW(6) + INTERVAL 1 DAY)",
            "INSERT INTO account_withdrawal_mark (identity_kind, identity_hash, account_id, withdrawn_at, expires_at) VALUES ('EMAIL', 'manager@example.test', ?, NOW(6), NOW(6) + INTERVAL 1 DAY)",
            "INSERT INTO account_withdrawal_mark (identity_kind, identity_hash, account_id, withdrawn_at, expires_at) VALUES ('EMAIL', '${"A".repeat(64)}', ?, NOW(6), NOW(6) + INTERVAL 1 DAY)",
            "INSERT INTO account_withdrawal_mark (identity_kind, identity_hash, account_id, withdrawn_at, expires_at) VALUES ('EMAIL', '$hash', ?, NOW(6), NOW(6))",
            "INSERT INTO account_withdrawal_mark (identity_kind, identity_hash, account_id, withdrawn_at, expires_at, inherited_by_account_id, inherited_at) VALUES ('EMAIL', '$hash', ?, NOW(6), NOW(6) + INTERVAL 1 DAY, 999999999999, NOW(6))",
        ).forEach { sql -> assertThrows(DataAccessException::class.java) { jdbc.update(sql, withdrawn) } }
    }

    private fun account(email: String): Long =
        accounts.createAccount(NewAccount(email, "test-password-hash", LocalDateTime.of(2026, 10, 1, 0, 0))).id

    /** 탈퇴처럼 표식을 남기고 계정을 탈퇴 처리합니다. */
    private fun withdraw(accountId: Long, identities: List<WithdrawnIdentity>, at: LocalDateTime = LocalDateTime.now(seoul)) {
        inTransaction { marks.record(accountId, identities, at) }
        accounts.markDeleted(accountId, at)
    }

    private fun accountsInheritedBy(accountId: Long): List<Long> = jdbc.queryForList(
        "SELECT DISTINCT account_id FROM account_withdrawal_mark WHERE inherited_by_account_id = ? AND inherited_at IS NOT NULL", Long::class.java, accountId,
    ).filterNotNull()

    private fun markCount(accountId: Long): Int =
        requireNotNull(jdbc.queryForObject("SELECT COUNT(*) FROM account_withdrawal_mark WHERE account_id = ?", Int::class.java, accountId))

    private fun <T> inTransaction(action: () -> T): T = requireNotNull(TransactionTemplate(transactionManager).execute { action() })
}
