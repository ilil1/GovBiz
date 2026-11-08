package ai.govbiz.core._common.domain

/** 한 기능에서 조회한 작업 상태별 건수와 접수부터 종료까지의 합산 시간입니다. */
data class JobStatusSummary(val status: String, val count: Long, val durationSamples: Long, val durationMillis: Long)
