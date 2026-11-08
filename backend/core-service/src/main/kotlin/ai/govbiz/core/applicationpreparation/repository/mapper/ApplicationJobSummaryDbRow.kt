package ai.govbiz.core.applicationpreparation.repository.mapper

data class ApplicationJobSummaryDbRow(
    var status: String = "", var count: Long = 0, var durationSamples: Long = 0, var durationMillis: Long = 0,
)
