package com.localai.automation.document.ui

import android.os.Bundle
import android.view.*
import androidx.fragment.app.Fragment
import androidx.fragment.app.viewModels
import androidx.lifecycle.lifecycleScope
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import com.google.gson.Gson
import com.google.gson.reflect.TypeToken
import com.localai.automation.databinding.FragmentRiskDetailBinding
import com.localai.automation.databinding.ItemRiskFlagBinding
import com.localai.automation.document.classifier.DocumentRiskClassifier
import com.localai.automation.document.data.RiskLevel
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch

/**
 * RiskDetailFragment
 *
 * Shows the full risk breakdown for a single document:
 *  - Overall risk level + summary
 *  - Each risk flag as a card (pattern name, category, severity bar, example snippets)
 *  - Obligations list
 *  - Deep AI analysis section (Stage 2)
 *
 * Navigation args:
 *   documentId   : Long
 *   documentName : String
 */
class RiskDetailFragment : Fragment() {

    private var _binding: FragmentRiskDetailBinding? = null
    private val binding  get() = _binding!!
    private val viewModel: DocumentViewModel by viewModels()
    private val gson = Gson()

    override fun onCreateView(inflater: LayoutInflater, container: ViewGroup?, state: Bundle?): View {
        _binding = FragmentRiskDetailBinding.inflate(inflater, container, false)
        return binding.root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)

        val documentId = arguments?.getLong("documentId") ?: return
        loadRiskDetail(documentId)
    }

    private fun loadRiskDetail(documentId: Long) {
        viewLifecycleOwner.lifecycleScope.launch {
            val doc = viewModel.documents.first().find { it.id == documentId } ?: return@launch

            // ── Header ────────────────────────────────────────────────────────
            binding.tvDocumentName.text = doc.name
            binding.tvRiskSummary.text  = doc.summary.ifBlank { "No summary available" }

            val riskColor = riskHexColor(doc.riskLevel)
            binding.tvOverallRisk.text = "${riskEmoji(doc.riskLevel)} ${doc.riskLevel.name} RISK"
            binding.tvOverallRisk.setTextColor(android.graphics.Color.parseColor(riskColor))
            binding.cardRiskHeader.setCardBackgroundColor(
                android.graphics.Color.parseColor(riskBgColor(doc.riskLevel))
            )

            // ── Flags ─────────────────────────────────────────────────────────
            val flags = parseFlags(doc.riskFlagsJson)
            if (flags.isNotEmpty()) {
                binding.tvFlagsHeader.text = "Risk Flags (${flags.size})"
                setupFlagsRecycler(flags)
            } else {
                binding.tvFlagsHeader.text = "No risk flags detected"
            }

            // ── Obligations ───────────────────────────────────────────────────
            val obligations = parseObligations(doc.obligationsJson)
            if (obligations.isNotEmpty()) {
                binding.tvObligationsHeader.text = "Obligations Found (${obligations.size})"
                binding.tvObligations.text = obligations.joinToString("\n\n") { "• $it" }
            } else {
                binding.tvObligationsHeader.text = "No obligations identified"
                binding.tvObligations.text = ""
            }

            // ── Deep analysis button ───────────────────────────────────────────
            binding.btnDeepAnalysis.setOnClickListener {
                binding.btnDeepAnalysis.isEnabled = false
                binding.progressDeep.visibility = View.VISIBLE

                viewModel.runDeepRiskAnalysis(documentId) { _ ->
                    null // wired via bridge in DocumentChatFragment pattern
                }
            }

            // Observe deep analysis state
            viewLifecycleOwner.lifecycleScope.launch {
                viewModel.riskAnalysisState.collect { state ->
                    when (state) {
                        is DocumentViewModel.RiskAnalysisState.Done -> {
                            binding.progressDeep.visibility = View.GONE
                            binding.btnDeepAnalysis.isEnabled = true
                            showDeepAnalysis(state.aiJson)
                        }
                        is DocumentViewModel.RiskAnalysisState.Error -> {
                            binding.progressDeep.visibility = View.GONE
                            binding.btnDeepAnalysis.isEnabled = true
                            binding.tvDeepResult.text = "Analysis failed: ${state.message}"
                            binding.tvDeepResult.visibility = View.VISIBLE
                        }
                        else -> {}
                    }
                }
            }
        }
    }

    private fun setupFlagsRecycler(flags: List<DocumentRiskClassifier.RiskFlag>) {
        val adapter = RiskFlagAdapter(flags)
        binding.recyclerFlags.apply {
            this.adapter = adapter
            layoutManager = LinearLayoutManager(requireContext())
            isNestedScrollingEnabled = false
        }
    }

    private fun showDeepAnalysis(aiJson: String) {
        binding.tvDeepResult.visibility = View.VISIBLE
        try {
            val type = object : TypeToken<Map<String, Any>>() {}.type
            val map: Map<String, Any> = gson.fromJson(aiJson, type)

            val sb = StringBuilder()
            sb.appendLine("🔍 Deep AI Analysis")
            sb.appendLine()

            (map["oneLineSummary"] as? String)?.let {
                sb.appendLine("Summary: $it")
                sb.appendLine()
            }

            @Suppress("UNCHECKED_CAST")
            (map["contextualFlags"] as? List<Map<String, Any>>)?.let { flags ->
                if (flags.isNotEmpty()) {
                    sb.appendLine("Contextual Issues:")
                    flags.forEach { f ->
                        sb.appendLine("  • ${f["issue"]} (severity ${f["severity"]}/5)")
                        (f["recommendation"] as? String)?.let { r ->
                            sb.appendLine("    → $r")
                        }
                    }
                    sb.appendLine()
                }
            }

            @Suppress("UNCHECKED_CAST")
            (map["missingClauses"] as? List<String>)?.let { missing ->
                if (missing.isNotEmpty()) {
                    sb.appendLine("Missing Clauses:")
                    missing.forEach { sb.appendLine("  ✗ $it") }
                    sb.appendLine()
                }
            }

            @Suppress("UNCHECKED_CAST")
            (map["unusualTerms"] as? List<String>)?.let { unusual ->
                if (unusual.isNotEmpty()) {
                    sb.appendLine("Unusual Terms:")
                    unusual.forEach { sb.appendLine("  ⚠ $it") }
                    sb.appendLine()
                }
            }

            @Suppress("UNCHECKED_CAST")
            (map["keyDates"] as? List<String>)?.let { dates ->
                if (dates.isNotEmpty()) {
                    sb.appendLine("Key Dates:")
                    dates.forEach { sb.appendLine("  📅 $it") }
                }
            }

            binding.tvDeepResult.text = sb.toString().trimEnd()
        } catch (e: Exception) {
            binding.tvDeepResult.text = aiJson
        }
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private fun parseFlags(json: String): List<DocumentRiskClassifier.RiskFlag> {
        return try {
            val type = object : TypeToken<List<Map<String, Any>>>() {}.type
            val maps: List<Map<String, Any>> = gson.fromJson(json, type) ?: emptyList()
            maps.map { m ->
                DocumentRiskClassifier.RiskFlag(
                    id          = m["id"]?.toString() ?: "",
                    description = m["description"]?.toString() ?: "",
                    category    = m["category"]?.toString() ?: "",
                    severity    = (m["severity"] as? Double)?.toInt() ?: 0,
                    matchCount  = (m["matchCount"] as? Double)?.toInt() ?: 0,
                    snippets    = emptyList(),
                )
            }
        } catch (e: Exception) { emptyList() }
    }

    private fun parseObligations(json: String): List<String> {
        return try {
            val type = object : TypeToken<List<String>>() {}.type
            gson.fromJson(json, type) ?: emptyList()
        } catch (e: Exception) { emptyList() }
    }

    private fun riskHexColor(level: RiskLevel) = when (level) {
        RiskLevel.SAFE     -> "#4CAF50"
        RiskLevel.LOW      -> "#8BC34A"
        RiskLevel.MEDIUM   -> "#FF9800"
        RiskLevel.HIGH     -> "#F44336"
        RiskLevel.CRITICAL -> "#B71C1C"
        RiskLevel.UNKNOWN  -> "#9E9E9E"
    }

    private fun riskBgColor(level: RiskLevel) = when (level) {
        RiskLevel.SAFE     -> "#E8F5E9"
        RiskLevel.LOW      -> "#F9FBE7"
        RiskLevel.MEDIUM   -> "#FFF3E0"
        RiskLevel.HIGH     -> "#FFEBEE"
        RiskLevel.CRITICAL -> "#FCE4EC"
        RiskLevel.UNKNOWN  -> "#F5F5F5"
    }

    private fun riskEmoji(level: RiskLevel) = when (level) {
        RiskLevel.SAFE     -> "✅"
        RiskLevel.LOW      -> "🟡"
        RiskLevel.MEDIUM   -> "🟠"
        RiskLevel.HIGH     -> "🔴"
        RiskLevel.CRITICAL -> "🚨"
        RiskLevel.UNKNOWN  -> "❓"
    }

    override fun onDestroyView() {
        super.onDestroyView()
        _binding = null
    }
}

// ── Risk flag card adapter ────────────────────────────────────────────────────

class RiskFlagAdapter(
    private val flags: List<DocumentRiskClassifier.RiskFlag>
) : RecyclerView.Adapter<RiskFlagAdapter.VH>() {

    class VH(val b: ItemRiskFlagBinding) : RecyclerView.ViewHolder(b.root)

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): VH {
        return VH(ItemRiskFlagBinding.inflate(
            android.view.LayoutInflater.from(parent.context), parent, false
        ))
    }

    override fun getItemCount() = flags.size

    override fun onBindViewHolder(holder: VH, position: Int) {
        val f = flags[position]
        holder.b.apply {
            tvFlagName.text     = f.description
            tvFlagCategory.text = f.category
            tvFlagCount.text    = "${f.matchCount} occurrence(s)"

            // Severity color bar
            val severityColor = when (f.severity) {
                5    -> "#B71C1C"
                4    -> "#F44336"
                3    -> "#FF9800"
                2    -> "#FFC107"
                else -> "#8BC34A"
            }
            viewSeverityBar.setBackgroundColor(android.graphics.Color.parseColor(severityColor))
            tvSeverity.text = "Severity ${"⬛".repeat(f.severity)}${"⬜".repeat(5 - f.severity)}"
        }
    }
}
