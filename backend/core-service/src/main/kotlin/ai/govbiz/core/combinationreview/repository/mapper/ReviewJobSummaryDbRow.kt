package ai.govbiz.core.combinationreview.repository.mapper

data class ReviewJobSummaryDbRow(
    var status: String = "", var count: Long = 0, var durationSamples: Long = 0, var durationMillis: Long = 0,
)
