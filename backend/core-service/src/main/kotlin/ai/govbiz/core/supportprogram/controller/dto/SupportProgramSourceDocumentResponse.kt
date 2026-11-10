package ai.govbiz.core.supportprogram.controller.dto

/** 공식 HTML 상세 본문이며 첨부파일 내용은 포함하지 않습니다. */
data class SupportProgramSourceDocumentResponse(
    val content: String,
    val includesAttachments: Boolean = false,
)
