package com.localai.automation.document.ui

import android.graphics.Color
import android.os.Bundle
import android.view.*
import android.view.inputmethod.EditorInfo
import android.widget.LinearLayout
import androidx.core.graphics.toColorInt
import androidx.fragment.app.Fragment
import androidx.fragment.app.viewModels
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import androidx.recyclerview.widget.DiffUtil
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.ListAdapter
import androidx.recyclerview.widget.RecyclerView
import com.localai.automation.databinding.FragmentDocumentChatBinding
import com.localai.automation.databinding.ItemDocumentChatMessageBinding
import com.localai.automation.document.data.DocumentEntity
import com.localai.automation.document.data.RiskLevel
import com.localai.automation.service.AgentRuntimeService
import kotlinx.coroutines.launch

/**
 * DocumentChatFragment
 *
 * Two-panel screen:
 *  1. Risk summary banner (from Stage 1 classifier)
 *  2. Chat interface for Q&A against the document
 */
class DocumentChatFragment : Fragment() {

    private var _binding: FragmentDocumentChatBinding? = null
    private val binding get() = _binding!!
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

    private fun setupChat() {
        adapter = ChatMessageAdapter()
        binding.recyclerChat.apply {
            this.adapter = this@DocumentChatFragment.adapter
            layoutManager = LinearLayoutManager(requireContext()).also { it.stackFromEnd = true }
        }

        binding.btnSend.setOnClickListener { sendQuestion() }
        binding.etQuestion.setOnEditorActionListener { _, actionId, _ ->
            if (actionId == EditorInfo.IME_ACTION_SEND) {
                sendQuestion()
                true
            } else false
        }
    }

    private fun sendQuestion() {
        val question = binding.etQuestion.text?.toString()?.trim() ?: return
        if (question.isBlank()) return
        binding.etQuestion.text?.clear()

        viewModel.askQuestion(question) { ragContext ->
            queryAiViaBridge(ragContext, question)
        }
    }

    private suspend fun queryAiViaBridge(ragContext: String, question: String): String? {
        val bridge = AgentRuntimeService.bridgeManager ?: return "⚠ AI bridge service not available."
        if (!bridge.isConnected()) return "⚠ AI bridge not connected. Start ZerathCode in Termux."

        return try {
            bridge.bridge.send(
                com.localai.automation.bridge.BridgeMessage(
                    type = "document_query",
                    payload = mapOf(
                        "question" to question,
                        "ragContext" to ragContext,
                        "documentId" to documentId,
                    )
                )
            )
            null
        } catch (e: Exception) {
            "Error: ${e.message}"
        }
    }

    private fun setupRiskBanner() {
        viewLifecycleOwner.lifecycleScope.launch {
            viewModel.documents.collect { docs ->
                docs.find { it.id == documentId }?.let { updateRiskBanner(it) }
            }
        }

        binding.btnDeepAnalysis.setOnClickListener {
            viewModel.runDeepRiskAnalysis(documentId) { _ -> null }
        }
    }

    private fun updateRiskBanner(doc: DocumentEntity) {
        val riskColorHex = when (doc.riskLevel) {
            RiskLevel.SAFE -> "#E8F5E9"
            RiskLevel.LOW -> "#F9FBE7"
            RiskLevel.MEDIUM -> "#FFF3E0"
            RiskLevel.HIGH -> "#FFEBEE"
            RiskLevel.CRITICAL -> "#FCE4EC"
            RiskLevel.UNKNOWN -> "#F5F5F5"
        }

        binding.cardRiskBanner.setCardBackgroundColor(riskColorHex.toColorInt())
        binding.tvRiskLevel.text = "${viewModel.riskEmoji(doc.riskLevel)} ${doc.riskLevel.name}"
        binding.tvRiskSummary.text = doc.summary.ifBlank { "Risk assessment in progress…" }
    }

    private fun observeState() {
        viewLifecycleOwner.lifecycleScope.launch {
            viewLifecycleOwner.repeatOnLifecycle(Lifecycle.State.STARTED) {
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
            }
        }
    }

    override fun onDestroyView() {
        super.onDestroyView()
        _binding = null
    }
}

class ChatMessageAdapter : ListAdapter<DocumentViewModel.ChatMessage, ChatMessageAdapter.VH>(DIFF) {

    companion object {
        val DIFF = object : DiffUtil.ItemCallback<DocumentViewModel.ChatMessage>() {
            override fun areItemsTheSame(a: DocumentViewModel.ChatMessage, b: DocumentViewModel.ChatMessage) =
                a.ts == b.ts && a.role == b.role

            override fun areContentsTheSame(a: DocumentViewModel.ChatMessage, b: DocumentViewModel.ChatMessage) =
                a == b
        }
    }

    class VH(val b: ItemDocumentChatMessageBinding) : RecyclerView.ViewHolder(b.root)

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): VH {
        return VH(
            ItemDocumentChatMessageBinding.inflate(
                LayoutInflater.from(parent.context), parent, false
            )
        )
    }

    override fun onBindViewHolder(holder: VH, position: Int) {
        val msg = getItem(position)
        holder.b.tvMessage.text = msg.content
        holder.b.tvRole.text = if (msg.role == "user") "You" else "AI"

        val lp = holder.b.root.layoutParams as? LinearLayout.LayoutParams
        if (lp != null) {
            lp.gravity = if (msg.role == "user") Gravity.END else Gravity.START
            holder.b.root.layoutParams = lp
        }

        val bgColor = if (msg.role == "user") "#E3F2FD" else "#F1F8E9"
        holder.b.cardMessage.setCardBackgroundColor(bgColor.toColorInt())
    }
}
