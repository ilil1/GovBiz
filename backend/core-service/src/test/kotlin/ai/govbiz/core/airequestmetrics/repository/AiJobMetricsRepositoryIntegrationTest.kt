package ai.govbiz.core.airequestmetrics.repository

import ai.govbiz.core._common.domain.JobStatusSummary
import ai.govbiz.core._common.test.MySqlTestContainerConfig
import ai.govbiz.core.applicationpreparation.repository.ApplicationDocumentGenerationJobRepository
import ai.govbiz.core.applicationpreparation.repository.ApplicationFormDiscoveryJobRepository
import ai.govbiz.core.combinationreview.repository.CombinationReviewRunRepository
import java.time.LocalDateTime
import java.util.UUID
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.context.annotation.Import
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.transaction.annotation.Transactional

/** 실제 MySQL에서 세 기능의 상태별 범위와 수집 시각·종료 시간 집계를 검증한다. */
@SpringBootTest(properties = [
    "app.account.jwt-secret=test-jwt-secret-0123456789abcdef0123456789",
    "app.ai-service.base-url=http://127.0.0.1:1",
    "app.bizinfo.sync.enabled=false",
    "app.support-program-index.enabled=false",
    "app.application-document.jobs.enabled=false",
    "app.ai-cost.sync-enabled=false",
])
@Import(MySqlTestContainerConfig::class)
@Transactional
class AiJobMetricsRepositoryIntegrationTest {
    @Autowired private lateinit var discovery: ApplicationFormDiscoveryJobRepository
    @Autowired private lateinit var document: ApplicationDocumentGenerationJobRepository
    @Autowired private lateinit var review: CombinationReviewRunRepository
    @Autowired private lateinit var jdbc: JdbcTemplate

    @Test
    fun aggregatesEachStoredJobOnceAndExcludesEndBoundary() {
        val from = LocalDateTime.of(2001, 1, 15, 9, 0)
        val until = from.plusDays(1)
        // 이 테스트는 읽기 집계 대상만 만들며 관계 무결성은 기존 기능 테스트에서 검증한다.
        jdbc.execute("SET FOREIGN_KEY_CHECKS = 0")
        try {
            jdbc.update("""INSERT INTO application_form_discovery_job
                (owner_account_id, request_key, source_code, source_program_id, status, created_at, finished_at, next_publish_at)
                VALUES (999999, ?, 'BIZINFO', ?, 'FAILED', ?, ?, ?)""",
                UUID.randomUUID().toString(), UUID.randomUUID().toString(), from, from.plusSeconds(2), from)
            jdbc.update("""INSERT INTO application_form_discovery_job
                (owner_account_id, request_key, source_code, source_program_id, status, created_at, next_publish_at)
                VALUES (999999, ?, 'BIZINFO', ?, 'QUEUED', ?, ?)""",
                UUID.randomUUID().toString(), UUID.randomUUID().toString(), until, until)
            jdbc.update("""INSERT INTO application_document_generation_job
                (owner_account_id, preparation_id, request_key, expected_revision, status, result_json, created_at, finished_at)
                VALUES (999999, 999999, ?, 1, 'SUCCEEDED', '[1]', ?, ?)""",
                UUID.randomUUID().toString(), from, from.plusSeconds(3))
            jdbc.update("""INSERT INTO combination_review_run
                (review_id, input_revision, request_key, request_hash, status, input_json, failure_code, runner_instance_id, started_at, finished_at)
                VALUES (999999, 1, ?, ?, 'INTERRUPTED', '{}', 'INTERRUPTED', ?, ?, ?)""",
                UUID.randomUUID().toString(), "a".repeat(64), UUID.randomUUID().toString(), from, from.plusSeconds(4))
        } finally {
            jdbc.execute("SET FOREIGN_KEY_CHECKS = 1")
        }
        assertEquals(listOf(JobStatusSummary("FAILED", 1, 1, 2000)), discovery.summarize(from, until))
        assertEquals(listOf(JobStatusSummary("SUCCEEDED", 1, 1, 3000)), document.summarize(from, until))
        assertEquals(listOf(JobStatusSummary("INTERRUPTED", 1, 1, 4000)), review.summarize(from, until))
    }
}
