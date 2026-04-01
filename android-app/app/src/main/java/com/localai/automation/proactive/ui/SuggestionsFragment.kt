package com.localai.automation.proactive.ui

import android.os.Bundle
import android.view.*
import android.widget.Toast
import androidx.fragment.app.Fragment
import androidx.fragment.app.activityViewModels
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import androidx.recyclerview.widget.DiffUtil
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.ListAdapter
import androidx.recyclerview.widget.RecyclerView
import com.localai.automation.databinding.FragmentSuggestionsBinding
import com.localai.automation.databinding.ItemSuggestionBinding
import com.localai.automation.proactive.ProactiveSuggestionEntity
import com.localai.automation.proactive.SuggestionStatus
import com.localai.automation.ui.MainViewModel
import kotlinx.coroutines.launch

class SuggestionsFragment : Fragment() {

    private var _binding: FragmentSuggestionsBinding? = null
    private val binding  get() = _binding!!
    private val viewModel: MainViewModel by activityViewModels()
    private lateinit var adapter: SuggestionAdapter

    override fun onCreateView(inflater: LayoutInflater, container: ViewGroup?, state: Bundle?): View {
        _binding = FragmentSuggestionsBinding.inflate(inflater, container, false)
        return binding.root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)

        setupRecycler()
        setupRefreshButton()
        observeState()
    }

    private fun setupRecycler() {
        adapter = SuggestionAdapter(
            onAccept  = { s -> acceptSuggestion(s) },
            onDismiss = { s -> dismissSuggestion(s) },
        )
        binding.recyclerSuggestions.apply {
            this.adapter = this@SuggestionsFragment.adapter
            layoutManager = LinearLayoutManager(requireContext())
        }
    }

    private fun setupRefreshButton() {
        binding.btnAnalyzeNow.setOnClickListener {
            binding.btnAnalyzeNow.isEnabled = false
            binding.progressAnalysis.visibility = View.VISIBLE
            binding.tvAnalysisStatus.text = "Analyzing your device patterns…"

            viewLifecycleOwner.lifecycleScope.launch {
                val count = viewModel.triggerProactiveAnalysis()
                binding.progressAnalysis.visibility = View.GONE
                binding.btnAnalyzeNow.isEnabled = true
                binding.tvAnalysisStatus.text = when {
                    count > 0  -> "Found $count new suggestion(s)!"
                    else       -> "No new patterns detected yet. Keep using the device."
                }
            }
        }
    }

    private fun observeState() {
        viewLifecycleOwner.lifecycleScope.launch {
            repeatOnLifecycle(Lifecycle.State.STARTED) {
                viewModel.pendingSuggestions.collect { suggestions ->
                    adapter.submitList(suggestions)
                    binding.tvSuggestionCount.text = "${suggestions.size} pending"
                    binding.tvEmpty.visibility =
                        if (suggestions.isEmpty()) View.VISIBLE else View.GONE
                }
            }
        }
    }

    private fun acceptSuggestion(suggestion: ProactiveSuggestionEntity) {
        viewLifecycleOwner.lifecycleScope.launch {
            val ok = viewModel.acceptSuggestion(suggestion.id)
            if (ok) {
                Toast.makeText(requireContext(),
                    "Rule created: \"${suggestion.title}\"", Toast.LENGTH_SHORT).show()
            } else {
                Toast.makeText(requireContext(),
                    "Failed to create rule", Toast.LENGTH_SHORT).show()
            }
        }
    }

    private fun dismissSuggestion(suggestion: ProactiveSuggestionEntity) {
        viewLifecycleOwner.lifecycleScope.launch {
            viewModel.dismissSuggestion(suggestion.id)
        }
    }

    override fun onDestroyView() {
        super.onDestroyView()
        _binding = null
    }
}

// ── Adapter ───────────────────────────────────────────────────────────────────

class SuggestionAdapter(
    private val onAccept:  (ProactiveSuggestionEntity) -> Unit,
    private val onDismiss: (ProactiveSuggestionEntity) -> Unit,
) : ListAdapter<ProactiveSuggestionEntity, SuggestionAdapter.VH>(DIFF) {

    companion object {
        val DIFF = object : DiffUtil.ItemCallback<ProactiveSuggestionEntity>() {
            override fun areItemsTheSame(a: ProactiveSuggestionEntity, b: ProactiveSuggestionEntity) =
                a.id == b.id
            override fun areContentsTheSame(a: ProactiveSuggestionEntity, b: ProactiveSuggestionEntity) =
                a == b
        }
    }

    inner class VH(val b: ItemSuggestionBinding) : RecyclerView.ViewHolder(b.root)

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int) =
        VH(ItemSuggestionBinding.inflate(
            android.view.LayoutInflater.from(parent.context), parent, false
        ))

    override fun onBindViewHolder(holder: VH, position: Int) {
        val s = getItem(position)
        holder.b.apply {
            tvSuggestionTitle.text       = s.title
            tvSuggestionDescription.text = s.description
            tvTrigger.text               = "When: ${s.triggerDescription}"
            tvAction.text                = "Do: ${s.actionDescription}"

            // Confidence badge
            val pct = (s.confidence * 100).toInt()
            val (strengthColor, strengthLabel) = when (s.patternStrength) {
                "strong"   -> "#4CAF50" to "Strong pattern"
                "moderate" -> "#FF9800" to "Moderate pattern"
                else       -> "#9E9E9E" to "Weak pattern"
            }
            tvPatternStrength.text = "$strengthLabel · $pct% confidence"
            tvPatternStrength.setTextColor(android.graphics.Color.parseColor(strengthColor))

            btnAcceptSuggestion.setOnClickListener { onAccept(s) }
            btnDismissSuggestion.setOnClickListener { onDismiss(s) }
        }
    }
}
