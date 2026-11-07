package ai.govbiz.core.govagent.domain

import ai.govbiz.core.supportprogram.domain.SupportProgramConversationContext
import ai.govbiz.core.supportprogram.domain.SupportProgramConversationLastSearch
import ai.govbiz.core.supportprogram.domain.SupportProgramPendingClarification

data class GovAgentProgram(val sourceCode: String, val sourceProgramId: String)

data class GovAgentQuestion(
    val message: String,
    val context: SupportProgramConversationContext,
    val pendingClarification: SupportProgramPendingClarification?,
    val pendingProposal: SupportProgramConversationContext?,
    val lastSearch: SupportProgramConversationLastSearch?,
    val selectedProgram: GovAgentProgram?,
)
