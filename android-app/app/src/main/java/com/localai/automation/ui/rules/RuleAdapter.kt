package com.localai.automation.ui.rules

import android.view.*
import androidx.recyclerview.widget.DiffUtil
import androidx.recyclerview.widget.ListAdapter
import androidx.recyclerview.widget.RecyclerView
import com.localai.automation.data.entities.RuleEntity
import com.localai.automation.databinding.ItemRuleBinding
import java.text.SimpleDateFormat
import java.util.*

class RuleAdapter(
    private val onDelete: (RuleEntity) -> Unit,
    private val onToggle: (Long, Boolean) -> Unit
) : ListAdapter<RuleEntity, RuleAdapter.VH>(DIFF) {

    companion object {
        val DIFF = object : DiffUtil.ItemCallback<RuleEntity>() {
            override fun areItemsTheSame(a: RuleEntity, b: RuleEntity) = a.id == b.id
            override fun areContentsTheSame(a: RuleEntity, b: RuleEntity) = a == b
        }
        val fmt = SimpleDateFormat("MMM d, HH:mm", Locale.getDefault())
    }

    inner class VH(val b: ItemRuleBinding) : RecyclerView.ViewHolder(b.root)

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int) =
        VH(ItemRuleBinding.inflate(LayoutInflater.from(parent.context), parent, false))

    override fun onBindViewHolder(holder: VH, position: Int) {
        val rule = getItem(position)
        holder.b.apply {
            tvRuleName.text = rule.name
            tvPriority.text = "Priority: ${"%.1f".format(rule.priority)}"
            tvTriggerCount.text = "Triggered: ${rule.triggerCount}×"
            tvLastTriggered.text = rule.lastTriggered?.let { "Last: ${fmt.format(Date(it))}" } ?: "Never triggered"
            switchEnabled.isChecked = rule.isEnabled
            switchEnabled.setOnCheckedChangeListener { _, enabled -> onToggle(rule.id, enabled) }
            btnDelete.setOnClickListener { onDelete(rule) }
            tvCondition.text = "IF: ${rule.conditionJson.take(80)}"
            tvAction.text = "DO: ${rule.actionJson.take(80)}"
            cardRule.alpha = if (rule.isEnabled) 1.0f else 0.5f
        }
    }
}
