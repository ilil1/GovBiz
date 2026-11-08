package ai.govbiz.core.airequestmetrics.repository.mapper

import java.time.LocalDate
import org.apache.ibatis.annotations.Mapper
import org.apache.ibatis.annotations.Param

data class AiRequestMetricDbRow(
    var metricDate: LocalDate? = null,
    var feature: String = "",
    var outcome: String = "",
    var latencyBucketMs: Int = 0,
    var requestCount: Long = 0,
)

@Mapper
interface AiRequestMetricMapper {
    fun increment(@Param("date") date: LocalDate, @Param("feature") feature: String,
                  @Param("outcome") outcome: String, @Param("bucket") bucket: Int): Int
    fun list(@Param("from") from: LocalDate, @Param("to") to: LocalDate): List<AiRequestMetricDbRow>
    fun listDaily(@Param("from") from: LocalDate, @Param("to") to: LocalDate): List<AiRequestMetricDbRow>
}
