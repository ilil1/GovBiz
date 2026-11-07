package ai.govbiz.core.account.service

import ai.govbiz.core.account.domain.WithdrawnIdentity
import ai.govbiz.core.account.repository.WithdrawalMarkRepository
import ai.govbiz.core.planusage.service.PlanUsageService
import java.time.Clock
import java.time.LocalDateTime
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec
import org.springframework.beans.factory.annotation.Qualifier
import org.springframework.beans.factory.annotation.Value
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Propagation
import org.springframework.transaction.annotation.Transactional

/**
 * 탈퇴 후 재가입 남용을 막습니다. 탈퇴할 때 식별자를 되돌릴 수 없는 HMAC 값으로 1년 남기고, 같은 식별자로 다시 가입하거나 기업을 등록하면
 * 새 계정이 탈퇴 계정의 체험 이력과 이번 하루·달 사용량을 이어받습니다. 막지 않고 이어받으므로 정상 회원은 그대로 다시 쓸 수 있습니다.
 * HMAC 키는 `app.account.identity-hmac-key`이고, 비어 있으면 세션 JWT 비밀값을 씁니다(그 비밀값을 바꾸면 이전 표식은 더 맞지 않음).
 */
@Service
class WithdrawalMarkService(
    private val repository: WithdrawalMarkRepository,
    private val planUsage: PlanUsageService,
    @param:Qualifier("seoulClock") private val clock: Clock,
    @param:Value("\${app.account.identity-hmac-key:}") identityHmacKey: String,
    @param:Value("\${app.account.jwt-secret:}") jwtSecret: String,
) {
    private val key = identityHmacKey.ifBlank { jwtSecret }.also { require(it.isNotBlank()) { "identity HMAC key must be configured" } }

    /** 탈퇴하는 계정의 식별자를 남깁니다. 탈퇴 transaction 안에서 부릅니다. */
    @Transactional(propagation = Propagation.MANDATORY)
    fun record(accountId: Long, identities: List<WithdrawnIdentity>, withdrawnAt: LocalDateTime) {
        val hashes = identities.groupBy({ it.kind }, ::hash)
        repository.record(accountId, hashes, withdrawnAt, withdrawnAt.plusDays(WithdrawnIdentity.RETENTION_DAYS))
    }

    /**
     * 새 계정이나 새로 등록한 기업의 식별자가 1년 안에 탈퇴한 계정과 맞으면 그 계정의 체험 이력과 이번 하루·달 사용량을 이어받고
     * 이어받은 탈퇴 계정 id를 돌려줍니다. 계정·기업을 만드는 transaction 안에서 부릅니다.
     */
    @Transactional(propagation = Propagation.MANDATORY)
    fun inherit(successorId: Long, identities: List<WithdrawnIdentity>): List<Long> {
        val now = LocalDateTime.now(clock)
        val predecessors = repository.lockInheritableAccounts(identities.map { it.kind to hash(it) }, successorId, now)
        predecessors.forEach { planUsage.inherit(it, successorId) }
        repository.markInherited(predecessors, successorId, now)
        return predecessors
    }

    /** 이 계정이 탈퇴 표식으로 이어받은 탈퇴 계정입니다. */
    fun inheritedFrom(accountId: Long): List<Long> = repository.findInheritedAccountIds(accountId)

    /** 보관 기간이 지난 표식을 지웁니다. 한 번에 [limit]줄까지 지우고 지운 수를 돌려줍니다. */
    @Transactional
    fun purgeExpired(limit: Int = 500): Int = repository.deleteExpired(LocalDateTime.now(clock), limit)

    private fun hash(identity: WithdrawnIdentity): String {
        val mac = Mac.getInstance("HmacSHA256")
        mac.init(SecretKeySpec(key.toByteArray(Charsets.UTF_8), "HmacSHA256"))
        return mac.doFinal("${identity.kind.name}:${identity.value}".toByteArray(Charsets.UTF_8)).joinToString("") { "%02x".format(it) }
    }
}
