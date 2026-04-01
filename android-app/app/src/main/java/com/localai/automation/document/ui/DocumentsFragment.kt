package com.localai.automation.document.ui

import android.app.AlertDialog
import android.net.Uri
import android.os.Bundle
import android.provider.OpenableColumns
import android.view.*
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.fragment.app.Fragment
import androidx.fragment.app.viewModels
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import androidx.navigation.fragment.findNavController
import androidx.recyclerview.widget.DiffUtil
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.ListAdapter
import androidx.recyclerview.widget.RecyclerView
import com.localai.automation.R
import com.localai.automation.databinding.FragmentDocumentsBinding
import com.localai.automation.databinding.ItemDocumentBinding
import com.localai.automation.document.data.DocumentEntity
import com.localai.automation.document.data.RiskLevel
import kotlinx.coroutines.launch
import java.text.DecimalFormat

class DocumentsFragment : Fragment() {

    private var _binding: FragmentDocumentsBinding? = null
    private val binding  get() = _binding!!
    private val viewModel: DocumentViewModel by viewModels()
    private lateinit var adapter: DocumentAdapter

    // ── Document picker ───────────────────────────────────────────────────────

    private val pickDocument = registerForActivityResult(
        ActivityResultContracts.GetContent()
    ) { uri: Uri? ->
        if (uri != null) handlePickedDocument(uri)
    }

    // ── Lifecycle ─────────────────────────────────────────────────────────────

    override fun onCreateView(inflater: LayoutInflater, container: ViewGroup?, state: Bundle?): View {
        _binding = FragmentDocumentsBinding.inflate(inflater, container, false)
        return binding.root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)

        setupRecycler()
        setupFab()
        observeState()
    }

    // ── Setup ─────────────────────────────────────────────────────────────────

    private fun setupRecycler() {
        adapter = DocumentAdapter(
            onOpen   = { doc -> openDocumentChat(doc) },
            onDelete = { doc -> confirmDelete(doc) },
        )
        binding.recyclerDocuments.apply {
            this.adapter = this@DocumentsFragment.adapter
            layoutManager = LinearLayoutManager(requireContext())
        }
    }

    private fun setupFab() {
        binding.fabImportDocument.setOnClickListener {
            // Accept PDF, DOCX, and plain text
            pickDocument.launch("*/*")
        }
    }

    // ── Observe ───────────────────────────────────────────────────────────────

    private fun observeState() {
        viewLifecycleOwner.lifecycleScope.launch {
            repeatOnLifecycle(Lifecycle.State.STARTED) {

                launch {
                    viewModel.documents.collect { docs ->
                        adapter.submitList(docs)
                        binding.tvEmptyDocuments.visibility =
                            if (docs.isEmpty()) View.VISIBLE else View.GONE
                        binding.tvDocumentCount.text = "${docs.size} document(s)"
                    }
                }

                launch {
                    viewModel.importState.collect { state ->
                        when (state) {
                            is DocumentViewModel.ImportState.Processing -> {
                                binding.progressImport.visibility = View.VISIBLE
                                binding.fabImportDocument.isEnabled = false
                            }
                            is DocumentViewModel.ImportState.Success -> {
                                binding.progressImport.visibility = View.GONE
                                binding.fabImportDocument.isEnabled = true
                                val r = state.result
                                val msg = buildString {
                                    append("Imported: ${r.chunkCount} chunks, ${formatBytes(r.charCount.toLong())}")
                                    if (r.isImagePdf) append("\n⚠ Image PDF — text extraction limited")
                                }
                                Toast.makeText(requireContext(), msg, Toast.LENGTH_LONG).show()
                                viewModel.resetImportState()
                            }
                            is DocumentViewModel.ImportState.Error -> {
                                binding.progressImport.visibility = View.GONE
                                binding.fabImportDocument.isEnabled = true
                                Toast.makeText(requireContext(), "Import failed: ${state.message}", Toast.LENGTH_LONG).show()
                                viewModel.resetImportState()
                            }
                            else -> {
                                binding.progressImport.visibility = View.GONE
                                binding.fabImportDocument.isEnabled = true
                            }
                        }
                    }
                }
            }
        }
    }

    // ── Document pick handling ────────────────────────────────────────────────

    private fun handlePickedDocument(uri: Uri) {
        val ctx      = requireContext()
        val resolver = ctx.contentResolver

        // Get file metadata from ContentResolver
        var name      = "Document"
        var sizeBytes = 0L
        val cursor    = resolver.query(uri, null, null, null, null)
        cursor?.use { c ->
            val nameIdx = c.getColumnIndex(OpenableColumns.DISPLAY_NAME)
            val sizeIdx = c.getColumnIndex(OpenableColumns.SIZE)
            if (c.moveToFirst()) {
                if (nameIdx >= 0) name      = c.getString(nameIdx) ?: "Document"
                if (sizeIdx >= 0) sizeBytes = c.getLong(sizeIdx)
            }
        }

        val mimeType = resolver.getType(uri) ?: "application/octet-stream"

        // Validate supported types
        val supported = mimeType == "application/pdf" ||
                        mimeType.contains("wordprocessingml") ||
                        mimeType.contains("msword") ||
                        mimeType.startsWith("text/")

        if (!supported) {
            Toast.makeText(ctx, "Unsupported file type: $mimeType\nSupported: PDF, DOCX, TXT", Toast.LENGTH_LONG).show()
            return
        }

        // Take persistent permission so we can re-read after app restart
        try {
            resolver.takePersistableUriPermission(
                uri, Intent.FLAG_GRANT_READ_URI_PERMISSION
            )
        } catch (e: Exception) {
            // Not all URIs support persistable permissions — that's fine
        }

        viewModel.importDocument(uri, name, mimeType, sizeBytes)
    }

    // ── Navigation ────────────────────────────────────────────────────────────

    private fun openDocumentChat(doc: DocumentEntity) {
        viewModel.setActiveDocument(doc.id)
        // Navigate to chat fragment — pass documentId as argument
        // findNavController().navigate(R.id.documentChatFragment, Bundle().apply {
        //     putLong("documentId", doc.id)
        //     putString("documentName", doc.name)
        // })
        // For now, show a simple dialog until nav graph is wired
        Toast.makeText(requireContext(), "Opening: ${doc.name}", Toast.LENGTH_SHORT).show()
    }

    private fun confirmDelete(doc: DocumentEntity) {
        AlertDialog.Builder(requireContext())
            .setTitle("Delete Document")
            .setMessage("Remove \"${doc.name}\" and all its data?")
            .setPositiveButton("Delete") { _, _ ->
                viewModel.deleteDocument(doc.id)
            }
            .setNegativeButton("Cancel", null)
            .show()
    }

    override fun onDestroyView() {
        super.onDestroyView()
        _binding = null
    }

    private fun formatBytes(bytes: Long): String {
        if (bytes < 1024) return "$bytes B"
        if (bytes < 1024 * 1024) return "${bytes / 1024} KB"
        return "${DecimalFormat("#.#").format(bytes / (1024.0 * 1024))} MB"
    }
}

// ── Adapter ───────────────────────────────────────────────────────────────────

class DocumentAdapter(
    private val onOpen:   (DocumentEntity) -> Unit,
    private val onDelete: (DocumentEntity) -> Unit,
) : ListAdapter<DocumentEntity, DocumentAdapter.VH>(DIFF) {

    companion object {
        val DIFF = object : DiffUtil.ItemCallback<DocumentEntity>() {
            override fun areItemsTheSame(a: DocumentEntity, b: DocumentEntity) = a.id == b.id
            override fun areContentsTheSame(a: DocumentEntity, b: DocumentEntity) = a == b
        }
    }

    inner class VH(val b: ItemDocumentBinding) : RecyclerView.ViewHolder(b.root)

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int) =
        VH(ItemDocumentBinding.inflate(LayoutInflater.from(parent.context), parent, false))

    override fun onBindViewHolder(holder: VH, position: Int) {
        val doc = getItem(position)
        holder.b.apply {
            tvDocName.text  = doc.name
            tvDocMeta.text  = "${doc.chunkCount} chunks · ${doc.charCount / 1000}k chars"
            tvDocSummary.text = doc.summary.ifBlank { if (doc.isProcessed) "No summary yet" else "Processing…" }

            // Risk badge
            val riskColor = when (doc.riskLevel) {
                RiskLevel.SAFE     -> "#4CAF50"
                RiskLevel.LOW      -> "#8BC34A"
                RiskLevel.MEDIUM   -> "#FF9800"
                RiskLevel.HIGH     -> "#F44336"
                RiskLevel.CRITICAL -> "#B71C1C"
                RiskLevel.UNKNOWN  -> "#9E9E9E"
            }
            val riskEmoji = when (doc.riskLevel) {
                RiskLevel.SAFE     -> "✅ Safe"
                RiskLevel.LOW      -> "🟡 Low risk"
                RiskLevel.MEDIUM   -> "🟠 Medium risk"
                RiskLevel.HIGH     -> "🔴 High risk"
                RiskLevel.CRITICAL -> "🚨 Critical"
                RiskLevel.UNKNOWN  -> "❓ Not assessed"
            }
            tvRiskBadge.text = riskEmoji
            tvRiskBadge.setTextColor(android.graphics.Color.parseColor(riskColor))

            root.setOnClickListener { onOpen(doc) }
            btnDeleteDoc.setOnClickListener { onDelete(doc) }
        }
    }
}
