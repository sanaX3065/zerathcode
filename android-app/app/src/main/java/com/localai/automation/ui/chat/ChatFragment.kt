package com.localai.automation.ui.chat

import android.app.AlertDialog
import android.os.Bundle
import android.view.*
import android.view.inputmethod.EditorInfo
import android.widget.TextView
import androidx.fragment.app.Fragment
import androidx.fragment.app.activityViewModels
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import androidx.recyclerview.widget.LinearLayoutManager
import com.localai.automation.R
import com.localai.automation.databinding.FragmentChatBinding
import com.localai.automation.engine.CommandParser
import com.localai.automation.ui.MainViewModel
import kotlinx.coroutines.launch

class ChatFragment : Fragment() {

    private var _binding: FragmentChatBinding? = null
    private val binding get() = _binding!!
    private val viewModel: MainViewModel by activityViewModels()
    private lateinit var adapter: ChatAdapter

    override fun onCreateView(
        inflater: LayoutInflater, container: ViewGroup?, savedInstanceState: Bundle?
    ): View {
        _binding = FragmentChatBinding.inflate(inflater, container, false)
        return binding.root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)

        adapter = ChatAdapter()
        binding.recyclerChat.apply {
            this.adapter = this@ChatFragment.adapter
            layoutManager = LinearLayoutManager(requireContext()).also { it.stackFromEnd = true }
        }

        setupChips()
        setupInput()
        observeMessages()
    }

    // ─── Suggestion chips ─────────────────────────────────────────────────────

    private fun setupChips() {
        val chipMap = mapOf(
            binding.chipBatteryLow    to "When battery is low, set silent mode",
            binding.chipChargingStart to "When charging starts, set normal mode",
            binding.chipChargingStop  to "When charging stops, set vibrate mode",
            binding.chipEnterZone     to "When I enter a zone, set silent mode",
            binding.chipLeaveZone     to "When I leave a zone, set normal mode",
            binding.chipNotify        to "Notify me when battery is low",
            binding.chipLog           to "Log when charging starts",
            binding.chipBrightness    to "Set brightness to high when charging starts"
        )
        chipMap.forEach { (chip, text) ->
            chip.setOnClickListener {
                binding.etInput.setText(text)
                binding.etInput.setSelection(text.length)
                binding.etInput.requestFocus()
            }
        }
    }

    // ─── Input & send ─────────────────────────────────────────────────────────

    private fun setupInput() {
        binding.btnSend.setOnClickListener { handleSend() }
        binding.etInput.setOnEditorActionListener { _, actionId, _ ->
            if (actionId == EditorInfo.IME_ACTION_SEND) { handleSend(); true } else false
        }
    }

    private fun handleSend() {
        val text = binding.etInput.text?.toString()?.trim() ?: return
        if (text.isBlank()) return
        binding.etInput.text?.clear()

        val result = viewModel.parseCommand(text)

        if (result.success) {
            showRulePreviewDialog(text, result)
        } else {
            // Parse failed — show error feedback immediately in chat
            viewModel.sendErrorFeedback(text, result.feedback)
        }
    }

    // ─── Rule preview dialog ──────────────────────────────────────────────────

    private fun showRulePreviewDialog(userInput: String, result: CommandParser.ParseResult) {
        val dialogView = LayoutInflater.from(requireContext())
            .inflate(R.layout.dialog_rule_preview, null)

        dialogView.findViewById<TextView>(R.id.tvPreviewTrigger).text   = result.triggerDisplay
        dialogView.findViewById<TextView>(R.id.tvPreviewCondition).text = result.conditionDisplay
        dialogView.findViewById<TextView>(R.id.tvPreviewAction).text    = result.actionDisplay
        dialogView.findViewById<TextView>(R.id.tvPreviewPriority).text  = result.priorityDisplay

        AlertDialog.Builder(requireContext())
            .setTitle("Confirm Rule")
            .setView(dialogView)
            .setPositiveButton("✓ Create Rule") { _, _ ->
                viewModel.confirmRule(userInput, result)
            }
            .setNegativeButton("Cancel", null)
            .show()
    }

    // ─── Observe messages ─────────────────────────────────────────────────────

    private fun observeMessages() {
        viewLifecycleOwner.lifecycleScope.launch {
            repeatOnLifecycle(Lifecycle.State.STARTED) {
                viewModel.chatMessages.collect { messages ->
                    adapter.submitList(messages)
                    if (messages.isNotEmpty()) {
                        binding.recyclerChat.smoothScrollToPosition(messages.size - 1)
                    }
                    binding.tvEmptyChat.visibility =
                        if (messages.isEmpty()) View.VISIBLE else View.GONE
                }
            }
        }
    }

    override fun onDestroyView() {
        super.onDestroyView()
        _binding = null
    }
}