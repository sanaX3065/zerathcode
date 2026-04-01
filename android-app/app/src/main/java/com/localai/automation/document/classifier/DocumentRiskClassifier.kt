package com.localai.automation.document.classifier

import android.util.Log
import com.google.gson.Gson
import com.localai.automation.document.data.RiskLevel

/**
 * DocumentRiskClassifier
 *
 * Two-stage risk assessment:
 *
 * Stage 1 — Pattern-based (fast, runs on-device, no AI needed):
 *   Scans the full document text for known risky patterns.
 *   Returns a RiskAssessment with level, flags, and obligations.
 *
 * Stage 2 — AI-assisted (deep, via bridge):
 *   Sends top-risk chunks to the AI for contextual analysis.
 *   The bridge handler in Node.js calls the LLM and returns structured JSON.
 *   Stage 2 is optional — Stage 1 results always stand alone.
 */
class DocumentRiskClassifier {

    companion object {
        private const val TAG = "DocumentRiskClassifier"
    }

    // ── Risk flag definitions ─────────────────────────────────────────────────

    data class RiskPattern(
        val id:          String,
        val description: String,
        val regex:       Regex,
        val severity:    Int,         // 1 (low) → 5 (critical)
        val category:    String,
    )

    private val RISK_PATTERNS = listOf(

        // ── Identity / Personal Information ───────────────────────────────────
        RiskPattern("SSN",      "Social Security Number",
            Regex("""\b\d{3}[-\s]?\d{2}[-\s]?\d{4}\b"""), 5, "PII"),
        RiskPattern("PASSPORT", "Passport number pattern",
            Regex("""\b[A-Z]{1,2}\d{6,9}\b"""), 4, "PII"),
        RiskPattern("CREDIT_CARD", "Credit card number",
            Regex("""\b(?:\d{4}[-\s]?){3}\d{4}\b"""), 5, "Financial"),
        RiskPattern("BANK_ACCOUNT", "Bank account/routing reference",
            Regex("""(?i)(routing|account)\s*(?:number|no\.?|#)?\s*:?\s*\d{6,17}"""), 4, "Financial"),
        RiskPattern("DOB", "Date of birth reference",
            Regex("""(?i)(date of birth|d\.o\.b|born on|dob)\s*:?\s*\d"""), 3, "PII"),

        // ── Financial ─────────────────────────────────────────────────────────
        RiskPattern("PAYMENT_TERMS", "Payment obligation",
            Regex("""(?i)(due|payable|payment of|pay)\s+\$?\d+"""), 2, "Financial"),
        RiskPattern("PENALTY_CLAUSE", "Penalty or late fee clause",
            Regex("""(?i)(penalty|late fee|interest charge|overdue)\s+of\s+\d"""), 3, "Legal"),
        RiskPattern("LARGE_AMOUNT", "Large monetary amount",
            Regex("""\$[\d,]+(?:\.\d{2})?\s*(?:thousand|million|billion|k|M|B)?"""), 2, "Financial"),

        // ── Legal ─────────────────────────────────────────────────────────────
        RiskPattern("INDEMNIFICATION", "Indemnification clause",
            Regex("""(?i)(indemnif|hold harmless|defend and indemnify)"""), 4, "Legal"),
        RiskPattern("ARBITRATION", "Arbitration / waives jury trial",
            Regex("""(?i)(arbitration|waive.*jury|class action waiver)"""), 3, "Legal"),
        RiskPattern("AUTO_RENEW", "Auto-renewal clause",
            Regex("""(?i)(automatically renew|auto.renew|unless cancelled|automatic renewal)"""), 3, "Legal"),
        RiskPattern("UNUSUAL_NOTICE", "Unusual notice period",
            Regex("""(?i)(\d{2,3})\s*(?:day|days)\s*(?:notice|written notice)"""), 2, "Legal"),
        RiskPattern("LIABILITY_CAP", "Limited liability clause",
            Regex("""(?i)(limit.*liability|liability.*shall not exceed|not liable for)"""), 3, "Legal"),
        RiskPattern("GOVERNING_LAW", "Governing law / jurisdiction",
            Regex("""(?i)(governed by the laws of|jurisdiction of|venue shall be)"""), 1, "Legal"),

        // ── Medical / Health ──────────────────────────────────────────────────
        RiskPattern("MEDICAL_INFO", "Medical/health information",
            Regex("""(?i)(diagnosis|prescription|patient|medical record|HIPAA|health condition)"""), 4, "Medical"),

        // ── Credentials / Security ────────────────────────────────────────────
        RiskPattern("API_KEY", "Possible API key or secret",
            Regex("""(?i)(api[_-]?key|secret[_-]?key|access[_-]?token)\s*[:=]\s*\S{10,}"""), 5, "Security"),
        RiskPattern("PASSWORD", "Hardcoded password",
            Regex("""(?i)(password|passwd|pwd)\s*[:=]\s*\S{4,}"""), 5, "Security"),
    )

    // ── Stage 1: Pattern-based assessment ────────────────────────────────────

    data class RiskAssessment(
        val riskLevel:    RiskLevel,
        val flags:        List<RiskFlag>,
        val obligations:  List<String>,
        val summary:      String,        // short human-readable summary
    )

    data class RiskFlag(
        val id:          String,
        val description: String,
        val category:    String,
        val severity:    Int,
        val matchCount:  Int,
        val snippets:    List<String>,   // up to 3 example matches (truncated)
    )

    fun assess(fullText: String): RiskAssessment {
        val text  = fullText.take(200_000)
        val flags = mutableListOf<RiskFlag>()

        for (pattern in RISK_PATTERNS) {
            val matches = pattern.regex.findAll(text).toList()
            if (matches.isEmpty()) continue

            val snippets = matches.take(3).map { match ->
                val start  = maxOf(0, match.range.first - 40)
                val end    = minOf(text.length, match.range.last + 40)
                "…${text.substring(start, end).replace('\n', ' ').trim()}…"
            }

            flags.add(RiskFlag(
                id          = pattern.id,
                description = pattern.description,
                category    = pattern.category,
                severity    = pattern.severity,
                matchCount  = matches.size,
                snippets    = snippets,
            ))
        }

        val obligations = extractObligations(text)
        val riskLevel   = computeRiskLevel(flags)
        val summary     = buildSummary(riskLevel, flags, obligations)

        Log.i(TAG, "Risk assessment: level=$riskLevel flags=${flags.size} obligations=${obligations.size}")

        return RiskAssessment(
            riskLevel   = riskLevel,
            flags       = flags,
            obligations = obligations,
            summary     = summary,
        )
    }

    // ── Obligation extraction ─────────────────────────────────────────────────

    private val OBLIGATION_PATTERNS = listOf(
        Regex("""(?i)(shall|must|agrees to|is required to|obligated to)\s+([^.]{10,80})"""),
        Regex("""(?i)(payment|rent|fee)\s+(?:of|is)\s+\$?[\d,]+[^.]{0,40}"""),
        Regex("""(?i)(due|payable|paid)\s+(?:on|by|before)\s+[^.]{5,60}"""),
        Regex("""(?i)(responsible for|liable for)\s+([^.]{10,80})"""),
    )

    private fun extractObligations(text: String): List<String> {
        val found = mutableListOf<String>()
        for (pattern in OBLIGATION_PATTERNS) {
            pattern.findAll(text).take(5).forEach { match ->
                val obligation = match.value.replace(Regex("\\s+"), " ").trim()
                if (obligation.length in 15..200) found.add(obligation)
            }
        }
        return found.distinct().take(10)
    }

    // ── Risk level computation ────────────────────────────────────────────────

    private fun computeRiskLevel(flags: List<RiskFlag>): RiskLevel {
        if (flags.isEmpty()) return RiskLevel.SAFE

        val maxSeverity = flags.maxOf { it.severity }
        val totalScore  = flags.sumOf { it.severity * it.matchCount }

        return when {
            maxSeverity >= 5             -> RiskLevel.CRITICAL
            maxSeverity >= 4             -> RiskLevel.HIGH
            maxSeverity >= 3 && totalScore >= 8 -> RiskLevel.HIGH
            maxSeverity >= 3             -> RiskLevel.MEDIUM
            totalScore >= 6              -> RiskLevel.MEDIUM
            totalScore >= 2              -> RiskLevel.LOW
            else                         -> RiskLevel.LOW
        }
    }

    // ── Summary generation ────────────────────────────────────────────────────

    private fun buildSummary(
        level: RiskLevel,
        flags: List<RiskFlag>,
        obligations: List<String>
    ): String {
        if (flags.isEmpty()) return "No risk patterns detected. Document appears safe."

        val categories = flags.groupBy { it.category }.keys.joinToString(", ")
        val highFlags  = flags.filter { it.severity >= 4 }.joinToString(", ") { it.description }

        val sb = StringBuilder()
        sb.append("Risk level: $level. ")
        sb.append("Found ${flags.size} flag(s) in categories: $categories. ")
        if (highFlags.isNotEmpty()) sb.append("High-severity: $highFlags. ")
        if (obligations.isNotEmpty()) sb.append("${obligations.size} obligation(s) identified.")
        return sb.toString()
    }

    // ── Serialization helpers ─────────────────────────────────────────────────

    private val gson = Gson()

    fun flagsToJson(flags: List<RiskFlag>): String =
        gson.toJson(flags.map { mapOf(
            "id"          to it.id,
            "description" to it.description,
            "category"    to it.category,
            "severity"    to it.severity,
            "matchCount"  to it.matchCount,
        )})

    fun obligationsToJson(obligations: List<String>): String =
        gson.toJson(obligations)

    // ── AI prompt builder (used by bridge handler) ────────────────────────────

    fun buildAiPrompt(documentName: String, topChunks: List<String>, flags: List<RiskFlag>): String {
        val flagSummary = flags.joinToString("\n") {
            "  - ${it.description} (${it.category}, severity ${it.severity}/5, ${it.matchCount} occurrence(s))"
        }
        val chunkText = topChunks.take(5).mapIndexed { i, c ->
            "(${i+1}) ${c.take(600)}"
        }.joinToString("\n\n")

        return """Analyze this document for risk and provide a structured assessment.

Document: $documentName

Pattern-based flags already detected:
$flagSummary

Most relevant text excerpts:
$chunkText

Respond ONLY with a valid JSON object (no markdown, no explanation outside JSON):
{
  "overallRisk": "SAFE|LOW|MEDIUM|HIGH|CRITICAL",
  "contextualFlags": [
    { "issue": "description", "severity": 1-5, "recommendation": "what user should do" }
  ],
  "missingClauses": ["list of expected clauses that are absent"],
  "unusualTerms": ["any terms significantly outside standard practice"],
  "keyDates": ["any important dates or deadlines found"],
  "oneLineSummary": "single sentence summarizing the document and its main risk"
}"""
    }
}
