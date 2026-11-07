package ai.govbiz.core.account.repository

import ai.govbiz.core.account.domain.WithdrawnIdentityKind
import ai.govbiz.core.account.repository.mapper.WithdrawalMarkDbRow
import ai.govbiz.core.account.repository.mapper.WithdrawalMarkKeyDbRow
import ai.govbiz.core.account.repository.mapper.WithdrawalMarkMapper
import java.time.LocalDateTime
import java.time.temporal.ChronoUnit
import org.springframework.stereotype.Repository

/** 탈퇴 표식(식별자 HMAC)을 MySQL에 남기고 읽습니다. 표식의 transaction은 부르는 Service가 정합니다. */
@Repository
class WithdrawalMarkRepository(private val mapper: WithdrawalMarkMapper) {

    fun record(accountId: Long, identities: Map<WithdrawnIdentityKind, List<String>>, withdrawnAt: LocalDateTime, expiresAt: LocalDateTime) {
        val from = withdrawnAt.truncatedTo(ChronoUnit.MICROS)
        val to = expiresAt.truncatedTo(ChronoUnit.MICROS)
        identities.forEach { (kind, hashes) ->
            hashes.distinct().forEach { hash ->
                mapper.insertMark(WithdrawalMarkDbRow(identityKind = kind.name, identityHash = hash, accountId = accountId, withdrawnAt = from, expiresAt = to))
            }
        }
    }

    /** 아직 이어받지 않은 탈퇴 계정 id입니다. 표식을 잠그므로 같은 탈퇴 계정을 두 계정이 동시에 이어받지 않습니다. */
    fun lockInheritableAccounts(keys: List<Pair<WithdrawnIdentityKind, String>>, successorId: Long, now: LocalDateTime): List<Long> {
        if (keys.isEmpty()) return emptyList()
        return mapper.findInheritable(keys.map { (kind, hash) -> WithdrawalMarkKeyDbRow(kind.name, hash) }, successorId, now)
            .map { it.accountId }.distinct()
    }

    fun markInherited(accountIds: List<Long>, successorId: Long, now: LocalDateTime) {
        if (accountIds.isNotEmpty()) mapper.markInherited(accountIds, successorId, now.truncatedTo(ChronoUnit.MICROS))
    }

    /** 이 계정이 이어받은 탈퇴 계정입니다. 관리자 계정 상세가 씁니다. */
    fun findInheritedAccountIds(successorId: Long): List<Long> = mapper.findInheritedAccountIds(successorId)

    fun deleteExpired(now: LocalDateTime, limit: Int): Int = mapper.deleteExpired(now, limit)
}
