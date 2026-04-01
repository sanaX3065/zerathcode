package com.localai.automation.document.ui

import android.os.Bundle
import android.view.*
import android.view.inputmethod.EditorInfo
import androidx.fragment.app.Fragment
import androidx.fragment.app.viewModels
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import androidx.recyclerview.widget.DiffUtil
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.ListAdapter
import androidx.recyclerview.widget.RecyclerView
import com.localai.automation.bridge.BridgeManager
import com.localai.automation.databinding.FragmentDocumentChatBinding
import com.localai.automation.databinding.ItemDocumentChatMessageBinding
import com.localai.automation.service.AgentRuntimeService
import kotlinx.coroutines.launch

/**
 * DocumentChatFragment
 *
 * Two-panel screen:
 *  1. Risk summary banner (from Stage 1 classifier)
 *  2. Chat interface for Q&A against the document
 *
 * Q&A flow:
 *   User types question
 *     → ViewModel retrieves top-k chunks via BM25
 *     → Context + question sent to AI via bridge
 *     → AI answers grounded in document text
 *     → Answer displayed in chat
 */
class DocumentChatFragment : Fragment() {

    private var _binding: FragmentDocumentChatBinding? = null
    private val binding  get() = _binding!!
    private val viewModel: DocumentViewModel by viewModels()
    private lateinit var adapter: ChatMessageAdapter

    private var documentId: Long = -1L

    override fun onCreateView(inflater: LayoutInflater, container: ViewGroup?, state: Bundle?): View {
        _binding = FragmentDocumentChatBinding.inflate(inflater, container, false)
        return binding.root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)

        documentId = arguments?.getLong("documentId") ?: -1L
        val docName = arguments?.getString("documentName") ?: "Document"

        binding.tvDocumentTitle.text = docName
        viewModel.setActiveDocument(documentId)

        setupChat()
        setupRiskBanner()
        observeState()
    }

    // ── Chat setup ────────────────────────────────────────────────────────────

    private fun setupChat() {
        adapter = ChatMessageAdapter()
        binding.recyclerChat.apply {
            this.adapter = this@DocumentChatFragment.adapter
            layoutManager = LinearLayoutManager(requireContext()).also { it.stackFromEnd = true }
        }

        binding.btnSend.setOnClickListener { sendQuestion() }
        binding.etQuestion.setOnEditorActionListener { _, actionId, _ ->
            if (actionId == EditorInfo.IME_ACTION_SEND) { sendQuestion(); true } else false
        }
    }

    private fun sendQuestion() {
        val question = binding.etQuestion.text?.toString()?.trim() ?: return
        if (question.isBlank()) return
        binding.etQuestion.text?.clear()

        viewModel.askQuestion(question) { ragContext ->
            // Send RAG context to AI via bridge
            queryAiViabridge(ragContext, question)
        }
    }

    /**
     * Sends the document context and question to the AI via the WebSocket bridge.
     * The Node.js fullAiOrchestrator handles the LLM call and returns the answer.
     */
    private suspend fun queryAiViabridge(ragContext: String, question: String): String? {
        val bridge = AgentRuntimeService.bridgeManager ?: return null
        if (!bridge.isConnected()) return "⚠ AI bridge not connected. Start ZerathCode in Termux."

        return try {
            // Send document query over bridge
            val result = bridge.bridge.send(
                com.localai.automation.bridge.BridgeMessage(
                    type = "document_query",
                    payload = mapOf(
                        "question"   to question,
                        "ragContext" to ragContext,
                        "documentId" to documentId,
                    )
                )
            )
            // Response comes back async via message handler
            // For now return placeholder; proper async handled via ViewModel
            null
        } catch (e: Exception) {
            "Error: ${e.message}"
        }
    }

    // ── Risk banner ───────────────────────────────────────────────────────────

    private fun setupRiskBanner() {
        viewLifecycleOwner.lifecycleScope.launch {
            val doc = viewModel.documents.value.find { it.id == documentId } ?: return@launch
            updateRiskBanner(doc)
        }

        // Deep analysis button
        binding.btnDeepAnalysis.setOnClickListener {
            viewModel.runDeepRiskAnalysis(documentId) { prompt ->
                // Send to AI via bridge for Stage 2 analysis
                null // placeholder — bridge handler returns AI JSON
            }
        }
    }

    private fun updateRiskBanner(doc: com.localai.automation.document.data.DocumentEntity) {
        val riskColor = when (doc.riskLevel) {
            com.localai.automation.document.data.RiskLevel.SAFE     -> "#E8F5E9"
            com.localai.automation.document.data.RiskLevel.LOW      -> "#F9FBE7"
            com.localai.automation.document.data.RiskLevel.MEDIUM   -> "#FFF3E0"
            com.localai.automation.document.data.RiskLevel.HIGH     -> "#FFEBEE"
            com.localai.automation.document.data.RiskLevel.CRITICAL -> "#FCE4EC"
            com.localai.automation.document.data.RiskLevel.UNKNOWN  -> "#F5F5F5"
        }

        binding.cardRiskBanner.setCardBackgroundColor(
            android.graphics.Color.parseColor(riskColor)
        )
        binding.tvRiskLevel.text  = "${viewModel.riskEmoji(doc.riskLevel)} ${doc.riskLevel.name}"
        binding.tvRiskSummary.text = doc.summary.ifBlank { "Risk assessment in progress…" }
    }

    // ── Observe ───────────────────────────────────────────────────────────────

    private fun observeState() {
        viewLifecycleOwner.lifecycleScope.launch {
            repeatOnLifecycle(Lifecycle.State.STARTED) {

                launch {
                    viewModel.chatMessages.collect { messages ->
                        adapter.submitList(messages)
                        if (messages.isNotEmpty()) {
                            binding.recyclerChat.smoothScrollToPosition(messages.size - 1)
                        }
                    }
                }

                launch {
                    viewModel.isAnswering.collect { answering ->
                        binding.progressAnswering.visibility = if (answering) View.VISIBLE else View.GONE
                        binding.btnSend.isEnabled = !answering
                    }
                }

                launch {
                    viewModel.documents.collect { docs ->
                        docs.find { it.id == documentId }?.let { updateRiskBanner(it) }
                    }
                }
            }
        }
    }

    override fun onDestroyView() {
        super.onDestroyView()
        _binding = null
    }
}

// ── Chat message adapter ──────────────────────────────────────────────────────

class ChatMessageAdapter : ListAdapter<DocumentViewModel.ChatMessage, ChatMessageAdapter.VH>(DIFF) {

    companion object {
        val DIFF = object : DiffUtil.ItemCallback<DocumentViewModel.ChatMessage>() {
            override fun areItemsTheSame(a: DocumentViewModel.ChatMessage, b: DocumentViewModel.ChatMessage) =
                a.ts == b.ts && a.role == b.role
            override fun areContentsTheSame(a: DocumentViewModel.ChatMessage, b: DocumentViewModel.ChatMessage) =
                a == b
        }
    }

    inner class VH(val b: ItemDocumentChatMessageBinding) : RecyclerView.ViewHolder(b.root)

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int) =
        VH(ItemDocumentChatMessageBinding.inflate(
            android.view.LayoutInflater.from(parent.context), parent, false
        ))

    override fun onBindViewHolder(holder: VH, position: Int) {
        val msg = getItem(position)
        holder.b.tvMessage.text = msg.content
        holder.b.tvRole.text    = if (msg.role == "user") "You" else "AI"

        // Align user right, AI left
        holder.b.root.gravity = if (msg.role == "user") {
            android.view.Gravity.END
        } else {
            android.view.Gravity.START
        }

        val bgColor = if (msg.role == "user") "#E3F2FD" else "#F1F8E9"
        holder.b.cardMessage.setCardBackgroundColor(android.graphics.Color.parseColor(bgColor))
    }
}
