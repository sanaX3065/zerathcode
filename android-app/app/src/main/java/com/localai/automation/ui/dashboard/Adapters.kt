package com.localai.automation.ui.dashboard

import android.view.*
import androidx.recyclerview.widget.DiffUtil
import androidx.recyclerview.widget.ListAdapter
import androidx.recyclerview.widget.RecyclerView
import com.localai.automation.data.entities.ActionEntity
import com.localai.automation.data.entities.EventEntity
import com.localai.automation.databinding.ItemEventBinding
import com.localai.automation.databinding.ItemActionBinding
import java.text.SimpleDateFormat
import java.util.*

// ─── Event Adapter ─────────────────────────────────────────────────────────────

class EventAdapter : ListAdapter<EventEntity, EventAdapter.VH>(DIFF) {
    companion object {
        val DIFF = object : DiffUtil.ItemCallback<EventEntity>() {
            override fun areItemsTheSame(a: EventEntity, b: EventEntity) = a.id == b.id
            override fun areContentsTheSame(a: EventEntity, b: EventEntity) = a == b
        }
        val fmt = SimpleDateFormat("MMM d, HH:mm:ss", Locale.getDefault())
    }

    inner class VH(val b: ItemEventBinding) : RecyclerView.ViewHolder(b.root)

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int) =
        VH(ItemEventBinding.inflate(LayoutInflater.from(parent.context), parent, false))

    override fun onBindViewHolder(holder: VH, position: Int) {
        val e = getItem(position)
        holder.b.apply {
            tvEventType.text = e.eventType.replace("_", " ")
            tvModule.text    = e.agentModule
            tvTime.text      = fmt.format(Date(e.timestamp))
            tvData.text      = e.dataJson.take(120)
        }
    }
}

// ─── Action Adapter ────────────────────────────────────────────────────────────
// Used for both the Actions tab and the Errors tab (filtered list).

class ActionAdapter : ListAdapter<ActionEntity, ActionAdapter.VH>(DIFF) {
    companion object {
        val DIFF = object : DiffUtil.ItemCallback<ActionEntity>() {
            override fun areItemsTheSame(a: ActionEntity, b: ActionEntity) = a.id == b.id
            override fun areContentsTheSame(a: ActionEntity, b: ActionEntity) = a == b
        }
        val fmt = SimpleDateFormat("MMM d, HH:mm:ss", Locale.getDefault())
    }

    inner class VH(val b: ItemActionBinding) : RecyclerView.ViewHolder(b.root)

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int) =
        VH(ItemActionBinding.inflate(LayoutInflater.from(parent.context), parent, false))

    override fun onBindViewHolder(holder: VH, position: Int) {
        val a = getItem(position)
        holder.b.apply {
            tvActionType.text = a.actionType.replace("_", " ")
            tvStatus.text     = a.resultStatus
            tvTime.text       = fmt.format(Date(a.timestamp))
            tvParams.text     = a.paramsJson.take(100)

            // Show trigger reason if available
            val reason = a.triggerReason
            if (!reason.isNullOrBlank()) {
                tvReason.visibility = View.VISIBLE
                tvReason.text = "↳ $reason"
            } else {
                tvReason.visibility = View.GONE
            }

            // Status colour
            val statusColor = when (a.resultStatus) {
                "SUCCESS"          -> android.graphics.Color.parseColor("#4CAF50")
                "SKIPPED"          -> android.graphics.Color.parseColor("#FF9800")
                "FAILED",
                "DENIED",
                "PERMISSION_DENIED" -> android.graphics.Color.parseColor("#F44336")
                else               -> android.graphics.Color.parseColor("#9E9E9E")
            }
            tvStatus.setTextColor(statusColor)
        }
    }
}