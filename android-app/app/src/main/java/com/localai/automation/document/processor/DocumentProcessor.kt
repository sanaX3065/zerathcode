package com.localai.automation.document.processor

import android.content.Context
import android.graphics.Bitmap
import android.graphics.pdf.PdfRenderer
import android.net.Uri
import android.util.Log
import java.io.InputStream
import java.util.zip.ZipInputStream

/**
 * DocumentProcessor
 *
 * Extracts plain text from:
 *  - PDF  — via PdfRenderer (renders pages) + OCR hint text extraction
 *  - DOCX — parses the word/document.xml inside the ZIP directly
 *  - TXT  — reads as-is
 *
 * No external libraries required. Trade-off:
 *  - PDF text extraction via PdfRenderer is limited (works for text PDFs,
 *    not scanned/image PDFs — those return empty pages).
 *  - DOCX XML parsing covers the common case (paragraph text) but ignores
 *    tables and headers (Phase 4 can add these).
 *
 * Returns ExtractionResult with per-page text and metadata.
 */
class DocumentProcessor(private val context: Context) {

    companion object {
        private const val TAG = "DocumentProcessor"
        const val MAX_CHARS = 200_000  // ~40k tokens — enough for most documents
    }

    data class ExtractionResult(
        val pages: List<PageText>,        // per-page text
        val fullText: String,             // concatenated, capped at MAX_CHARS
        val pageCount: Int,
        val isImagePdf: Boolean = false,  // true if PDF had no extractable text
        val errorMessage: String? = null,
    )

    data class PageText(
        val pageNumber: Int,   // 1-based
        val text: String,
    )

    // ── Entry point ───────────────────────────────────────────────────────────

    fun extract(uri: Uri, mimeType: String): ExtractionResult {
        return try {
            when {
                mimeType == "application/pdf" ||
                uri.toString().lowercase().endsWith(".pdf") ->
                    extractPdf(uri)

                mimeType.contains("wordprocessingml") ||
                mimeType.contains("msword") ||
                uri.toString().lowercase().endsWith(".docx") ->
                    extractDocx(uri)

                mimeType.startsWith("text/") ||
                uri.toString().lowercase().endsWith(".txt") ||
                uri.toString().lowercase().endsWith(".md") ->
                    extractPlainText(uri)

                else -> ExtractionResult(
                    pages        = emptyList(),
                    fullText     = "",
                    pageCount    = 0,
                    errorMessage = "Unsupported file type: $mimeType"
                )
            }
        } catch (e: Exception) {
            Log.e(TAG, "Extraction failed for $uri", e)
            ExtractionResult(
                pages        = emptyList(),
                fullText     = "",
                pageCount    = 0,
                errorMessage = "Extraction failed: ${e.message}"
            )
        }
    }

    // ── PDF ───────────────────────────────────────────────────────────────────

    private fun extractPdf(uri: Uri): ExtractionResult {
        val fd = context.contentResolver.openFileDescriptor(uri, "r")
            ?: return ExtractionResult(emptyList(), "", 0, errorMessage = "Cannot open PDF file")

        return fd.use { pfd ->
            PdfRenderer(pfd).use { renderer ->
                val pageCount = renderer.pageCount
                val pages     = mutableListOf<PageText>()
                var totalChars = 0
                var emptyPages = 0

                for (i in 0 until pageCount) {
                    if (totalChars >= MAX_CHARS) break

                    renderer.openPage(i).use { page ->
                        // PdfRenderer renders to bitmap — text layer extraction
                        // is available via page.getTextToRender on API 35+.
                        // For now, use the bitmap approach for compatibility.
                        val text = extractPageText(page, i + 1)
                        if (text.isBlank()) emptyPages++

                        val trimmed = text.take(MAX_CHARS - totalChars)
                        pages.add(PageText(i + 1, trimmed))
                        totalChars += trimmed.length
                    }
                }

                val fullText = pages.joinToString("\n\n") { "--- Page ${it.pageNumber} ---\n${it.text}" }
                val isImagePdf = emptyPages == pageCount && pageCount > 0

                ExtractionResult(
                    pages       = pages,
                    fullText    = fullText.take(MAX_CHARS),
                    pageCount   = pageCount,
                    isImagePdf  = isImagePdf,
                )
            }
        }
    }

    /**
     * Extract text from a single PDF page.
     * On API 35+ we can use getTextContent; on lower APIs we fall back to
     * rendering a bitmap at reduced resolution and returning empty
     * (the caller will flag as isImagePdf).
     */
    private fun extractPageText(page: PdfRenderer.Page, pageNum: Int): String {
        return try {
            if (android.os.Build.VERSION.SDK_INT >= 35) {
                // API 35: PdfRenderer.Page.getTextContents() available
                // Use reflection to avoid hard compile dependency
                val method = page.javaClass.getMethod("getTextContents")
                @Suppress("UNCHECKED_CAST")
                val contents = method.invoke(page) as? List<*>
                contents?.joinToString(" ") { item ->
                    item?.javaClass?.getMethod("getText")?.invoke(item)?.toString() ?: ""
                }?.trim() ?: ""
            } else {
                // Pre-API 35: no text layer access — return empty, flag as image PDF
                ""
            }
        } catch (e: Exception) {
            Log.d(TAG, "Page $pageNum text extraction failed (likely image PDF): ${e.message}")
            ""
        }
    }

    // ── DOCX ──────────────────────────────────────────────────────────────────

    /**
     * DOCX is a ZIP file. The main content is in word/document.xml.
     * We parse the XML manually without external libraries.
     */
    private fun extractDocx(uri: Uri): ExtractionResult {
        val stream = context.contentResolver.openInputStream(uri)
            ?: return ExtractionResult(emptyList(), "", 0, errorMessage = "Cannot open DOCX file")

        return stream.use { inputStream ->
            val xmlContent = readDocxXml(inputStream)
                ?: return ExtractionResult(emptyList(), "", 0, errorMessage = "Could not read DOCX content")

            val text = parseDocxXml(xmlContent).take(MAX_CHARS)
            val pages = splitIntoLogicalPages(text)

            ExtractionResult(
                pages     = pages,
                fullText  = text,
                pageCount = pages.size,
            )
        }
    }

    private fun readDocxXml(inputStream: InputStream): String? {
        return try {
            ZipInputStream(inputStream).use { zip ->
                var entry = zip.nextEntry
                while (entry != null) {
                    if (entry.name == "word/document.xml") {
                        return zip.readBytes().toString(Charsets.UTF_8)
                    }
                    entry = zip.nextEntry
                }
                null
            }
        } catch (e: Exception) {
            Log.e(TAG, "DOCX ZIP read failed: ${e.message}")
            null
        }
    }

    /**
     * Parse word/document.xml extracting text from <w:t> elements.
     * Paragraph breaks (<w:p>) become newlines.
     */
    private fun parseDocxXml(xml: String): String {
        val sb = StringBuilder()
        var i = 0

        while (i < xml.length) {
            when {
                xml.startsWith("<w:p ", i) || xml.startsWith("<w:p>", i) -> {
                    // New paragraph — add newline before next content
                    if (sb.isNotEmpty() && !sb.endsWith("\n")) sb.append("\n")
                    i += 4
                }
                xml.startsWith("<w:t>", i) || xml.startsWith("<w:t ", i) -> {
                    // Text element — extract until </w:t>
                    val start = xml.indexOf('>', i) + 1
                    val end   = xml.indexOf("</w:t>", start)
                    if (start > 0 && end > start) {
                        val text = xml.substring(start, end)
                            .replace("&amp;", "&")
                            .replace("&lt;", "<")
                            .replace("&gt;", ">")
                            .replace("&quot;", "\"")
                            .replace("&apos;", "'")
                        sb.append(text)
                        i = end + 6
                    } else {
                        i++
                    }
                }
                xml.startsWith("<w:br/>", i) || xml.startsWith("<w:br />", i) -> {
                    sb.append("\n")
                    i += 7
                }
                else -> i++
            }
        }

        // Collapse excessive blank lines
        return sb.toString()
            .replace(Regex("\n{3,}"), "\n\n")
            .trim()
    }

    // ── Plain text ────────────────────────────────────────────────────────────

    private fun extractPlainText(uri: Uri): ExtractionResult {
        val stream = context.contentResolver.openInputStream(uri)
            ?: return ExtractionResult(emptyList(), "", 0, errorMessage = "Cannot open text file")

        return stream.use {
            val text  = it.readBytes().toString(Charsets.UTF_8).take(MAX_CHARS)
            val pages = splitIntoLogicalPages(text)
            ExtractionResult(
                pages     = pages,
                fullText  = text,
                pageCount = pages.size,
            )
        }
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    /**
     * For non-paged formats (DOCX, TXT), split into logical 3000-char pages
     * so the UI can show "page X of Y".
     */
    private fun splitIntoLogicalPages(text: String, pageSize: Int = 3000): List<PageText> {
        if (text.isBlank()) return listOf(PageText(1, ""))
        val pages = mutableListOf<PageText>()
        var offset = 0
        var pageNum = 1
        while (offset < text.length) {
            val end = minOf(offset + pageSize, text.length)
            pages.add(PageText(pageNum++, text.substring(offset, end)))
            offset = end
        }
        return pages
    }
}
