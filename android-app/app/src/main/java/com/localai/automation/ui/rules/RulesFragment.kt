package com.localai.automation.ui.rules

import android.os.Bundle
import android.view.*
import androidx.fragment.app.Fragment
import androidx.fragment.app.activityViewModels
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import androidx.recyclerview.widget.LinearLayoutManager
import com.localai.automation.databinding.FragmentRulesBinding
import com.localai.automation.ui.MainViewModel
import kotlinx.coroutines.launch

class RulesFragment : Fragment() {

    private var _binding: FragmentRulesBinding? = null
    private val binding get() = _binding!!
    private val viewModel: MainViewModel by activityViewModels()
    private lateinit var adapter: RuleAdapter

    override fun onCreateView(inflater: LayoutInflater, container: ViewGroup?, savedInstanceState: Bundle?): View {
        _binding = FragmentRulesBinding.inflate(inflater, container, false)
        return binding.root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)

        adapter = RuleAdapter(
            onDelete = { viewModel.deleteRule(it) },
            onToggle = { id, enabled -> viewModel.toggleRule(id, enabled) }
        )

        binding.recyclerRules.apply {
            this.adapter = this@RulesFragment.adapter
            layoutManager = LinearLayoutManager(requireContext())
        }

        viewLifecycleOwner.lifecycleScope.launch {
            repeatOnLifecycle(Lifecycle.State.STARTED) {
                viewModel.rules.collect { rules ->
                    adapter.submitList(rules)
                    binding.tvEmptyRules.visibility =
                        if (rules.isEmpty()) View.VISIBLE else View.GONE
                    binding.tvRuleCount.text = "${rules.size} rule(s) total"
                }
            }
        }
    }

    override fun onDestroyView() {
        super.onDestroyView()
        _binding = null
    }
}
