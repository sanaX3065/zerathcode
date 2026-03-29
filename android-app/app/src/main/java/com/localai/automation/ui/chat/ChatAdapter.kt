package com.localai.automation.ui.chat

import android.text.method.LinkMovementMethod
import android.view.*
import androidx.core.text.HtmlCompat
import androidx.recyclerview.widget.DiffUtil
import androidx.recyclerview.widget.ListAdapter
import androidx.recyclerview.widget.RecyclerView
import com.localai.automation.data.entities.ChatMessageEntity
import com.localai.automation.databinding.ItemChatAgentBinding
import com.localai.automation.databinding.ItemChatUserBinding
import java.text.SimpleDateFormat
import java.util.*

class ChatAdapter : ListAdapter<ChatMessageEntity, RecyclerView.ViewHolder>(DIFF) {

    companion object {
        private const val VIEW_USER = 0
        private const val VIEW_AGENT = 1
        private val DIFF = object : DiffUtil.ItemCallback<ChatMessageEntity>() {
            override fun areItemsTheSame(a: ChatMessageEntity, b: ChatMessageEntity) = a.id == b.id
            override fun areContentsTheSame(a: ChatMessageEntity, b: ChatMessageEntity) = a == b
        }
        private val timeFormat = SimpleDateFormat("HH:mm", Locale.getDefault())
    }

    override fun getItemViewType(position: Int) = if (getItem(position).isUser) VIEW_USER else VIEW_AGENT

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): RecyclerView.ViewHolder {
        val inflater = LayoutInflater.from(parent.context)
        return if (viewType == VIEW_USER)
            UserVH(ItemChatUserBinding.inflate(inflater, parent, false))
        else
            AgentVH(ItemChatAgentBinding.inflate(inflater, parent, false))
    }

    override fun onBindViewHolder(holder: RecyclerView.ViewHolder, position: Int) {
        val msg = getItem(position)
        val time = timeFormat.format(Date(msg.timestamp))
        if (holder is UserVH) holder.bind(msg, time)
        else if (holder is AgentVH) holder.bind(msg, time)
    }

    inner class UserVH(private val b: ItemChatUserBinding) : RecyclerView.ViewHolder(b.root) {
        fun bind(msg: ChatMessageEntity, time: String) {
            b.tvMessage.text = msg.content
            b.tvTime.text = time
        }
    }

    inner class AgentVH(private val b: ItemChatAgentBinding) : RecyclerView.ViewHolder(b.root) {
        fun bind(msg: ChatMessageEntity, time: String) {
            // Render simple markdown-like bold (**text**)
            val html = msg.content
                .replace("**", "<b>").replace("</b><b>", "")
                .let { fixBoldTags(it) }
            b.tvMessage.text = HtmlCompat.fromHtml(html, HtmlCompat.FROM_HTML_MODE_COMPACT)
            b.tvMessage.movementMethod = LinkMovementMethod.getInstance()
            b.tvTime.text = time
        }

        private fun fixBoldTags(s: String): String {
            // Simple **word** → <b>word</b>
            return s.replace(Regex("\\*\\*(.+?)\\*\\*"), "<b>$1</b>")
        }
    }
}
