package com.localai.automation.document.ui

import android.app.Application
import android.net.Uri
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.localai.automation.data.AppDatabase
import com.localai.automation.document.DocumentRepository
import com.localai.automation.document.data.DocumentEntity
import com.localai.automation.document.data.RiskLevel
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch

class DocumentViewModel(app: Application) : AndroidViewModel(app) {

    private val db         = AppDatabase.getInstance(app)
    val repository         = DocumentRepository(app, db.documentDao())

    // ── Document list state ───────────────────────────────────────────────────

    val documents: StateFlow<List<DocumentEntity>> = repository
        .getAllDocuments()
        .stateIn(viewModelScope, SharingStarted.Lazily, emptyList())

    // ── Import state ──────────────────────────────────────────────────────────

    sealed class ImportState {
        object Idle                                      : ImportState()
        object Processing                                : ImportState()
        data class Success(val result: DocumentRepository.ImportResult) : ImportState()
        data class Error(val message: String)            : ImportState()
    }

    private val _importState = MutableStateFlow<ImportState>(ImportState.Idle)
    val importState: StateFlow<ImportState> = _importState.asStateFlow()

    fun importDocument(uri: Uri, name: String, mimeType: String, sizeBytes: Long) {
        viewModelScope.launch {
            _importState.value = ImportState.Processing
            try {
                val result = repository.importDocument(uri, name, mimeType, sizeBytes)
                if (result.errorMessage != null) {
                    _importState.value = ImportState.Error(result.errorMessage)
                } else {
                    _importState.value = ImportState.Success(result)
                }
            } catch (e: Exception) {
                _importState.value = ImportState.Error(e.message ?: "Import failed")
            }
        }
    }

    fun resetImportState() { _importState.value = ImportState.Idle }

    // ── Document Q&A state ────────────────────────────────────────────────────

    data class ChatMessage(
        val role:    String,  // "user" | "assistant"
        val content: String,
        val ts:      Long = System.currentTimeMillis(),
    )

    private val _chatMessages = MutableStateFlow<List<ChatMessage>>(emptyList())
    val chatMessages: StateFlow<List<ChatMessage>> = _chatMessages.asStateFlow()

    private val _isAnswering = MutableStateFlow(false)
    val isAnswering: StateFlow<Boolean> = _isAnswering.asStateFlow()

    private var _activeDocumentId: Long? = null
    val activeDocumentId get() = _activeDocumentId

    fun setActiveDocument(documentId: Long) {
        _activeDocumentId = documentId
        _chatMessages.value = emptyList()
    }

    /**
     * Ask a question about the active document.
     * Builds RAG context and sends to AI via the bridge.
     * The bridge handler in Node.js calls the LLM and streams back the answer.
     */
    fun askQuestion(question: String, onBridgeQuery: suspend (context: String) -> String?) {
        val docId = _activeDocumentId ?: return

        viewModelScope.launch {
            // Add user message
            _chatMessages.value += ChatMessage("user", question)
            _isAnswering.value = true

            try {
                val ragContext = repository.buildRagContext(docId, question)
                val answer    = onBridgeQuery(ragContext)

                _chatMessages.value += ChatMessage(
                    "assistant",
                    answer ?: "I couldn't find relevant information in this document."
                )
            } catch (e: Exception) {
                _chatMessages.value += ChatMessage(
                    "assistant",
                    "Error processing your question: ${e.message}"
                )
            } finally {
                _isAnswering.value = false
            }
        }
    }

    // ── Risk state ────────────────────────────────────────────────────────────

    private val _riskAnalysisState = MutableStateFlow<RiskAnalysisState>(RiskAnalysisState.Idle)
    val riskAnalysisState: StateFlow<RiskAnalysisState> = _riskAnalysisState.asStateFlow()

    sealed class RiskAnalysisState {
        object Idle                                          : RiskAnalysisState()
        object Loading                                       : RiskAnalysisState()
        data class Done(val aiJson: String, val doc: DocumentEntity) : RiskAnalysisState()
        data class Error(val message: String)                : RiskAnalysisState()
    }

    fun runDeepRiskAnalysis(documentId: Long, onBridgeQuery: suspend (prompt: String) -> String?) {
        viewModelScope.launch {
            _riskAnalysisState.value = RiskAnalysisState.Loading
            try {
                val prompt = repository.buildRiskPrompt(documentId)
                    ?: return@launch run {
                        _riskAnalysisState.value = RiskAnalysisState.Error("Document not found")
                    }

                val aiJson = onBridgeQuery(prompt)
                    ?: return@launch run {
                        _riskAnalysisState.value = RiskAnalysisState.Error("AI analysis failed — is device connected?")
                    }

                val doc = repository.getAllDocuments().first().find { it.id == documentId }
                    ?: return@launch run {
                        _riskAnalysisState.value = RiskAnalysisState.Error("Document not found")
                    }

                _riskAnalysisState.value = RiskAnalysisState.Done(aiJson, doc)
            } catch (e: Exception) {
                _riskAnalysisState.value = RiskAnalysisState.Error(e.message ?: "Unknown error")
            }
        }
    }

    // ── Delete ────────────────────────────────────────────────────────────────

    fun deleteDocument(documentId: Long) = viewModelScope.launch {
        repository.deleteDocument(documentId)
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    fun riskColor(level: RiskLevel): String = when (level) {
        RiskLevel.SAFE     -> "#4CAF50"
        RiskLevel.LOW      -> "#8BC34A"
        RiskLevel.MEDIUM   -> "#FF9800"
        RiskLevel.HIGH     -> "#F44336"
        RiskLevel.CRITICAL -> "#B71C1C"
        RiskLevel.UNKNOWN  -> "#9E9E9E"
    }

    fun riskEmoji(level: RiskLevel): String = when (level) {
        RiskLevel.SAFE     -> "✅"
        RiskLevel.LOW      -> "🟡"
        RiskLevel.MEDIUM   -> "🟠"
        RiskLevel.HIGH     -> "🔴"
        RiskLevel.CRITICAL -> "🚨"
        RiskLevel.UNKNOWN  -> "❓"
    }
}
