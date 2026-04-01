package com.localai.automation.actions

import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.provider.Telephony
import android.telephony.SmsManager
import android.util.Log
import com.localai.automation.models.AgentAction

/**
 * AppAction
 *
 * Handles:
 *   - LAUNCH_APP:   Launch app by package name
 *   - SEND_SMS:     Send SMS message (two paths: intent UI or silent)
 *
 * LAUNCH_APP Params:
 *   packageName : String — target app package (e.g., "com.android.messaging")
 *
 * SEND_SMS Params:
 *   toNumber  : String  — recipient phone number (required)
 *   message   : String  — SMS body text (required)
 *   skipUi    : Boolean — if true use SmsManager directly (silent).
 *                        if false use SMS intent (shows compose).
 *                        Default: false (show UI)
 *
 * Notes:
 * • SMS > 160 chars auto-split into segments
 * • Silent SMS requires SEND_SMS permission and works best on default SMS app
 * • Intent SMS works without permission (delegates to system SMS app)
 */
class AppAction(private val context: Context) {

    companion object {
        private const val TAG = "AppAction"
        private const val MAX_SMS_LENGTH = 160
    }

    /**
     * LAUNCH_APP — start application by package name
     */
    fun launchApp(action: AgentAction): ActionResult {
        val packageName = action.getStringParam("packageName")
            ?: return ActionResult.failure("Missing required param: packageName (String)")

        return try {
            val intent = context.packageManager.getLaunchIntentForPackage(packageName)
                ?: return ActionResult.failure("App not found: $packageName")

            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            context.startActivity(intent)

            Log.i(TAG, "App launched: $packageName")
            ActionResult.success("Launched: $packageName")
        } catch (e: Exception) {
            ActionResult.failure("Failed to launch app: ${e.message}")
        }
    }

    /**
     * SEND_SMS — send text message
     */
    fun sendSms(action: AgentAction): ActionResult {
        val toNumber = action.getStringParam("toNumber")
            ?: return ActionResult.failure("Missing required param: toNumber (String)")
        val message = action.getStringParam("message")
            ?: return ActionResult.failure("Missing required param: message (String)")
        val skipUi = action.getBoolParam("skipUi") ?: false

        if (toNumber.isBlank() || message.isBlank()) {
            return ActionResult.failure("toNumber and message cannot be empty")
        }

        return if (skipUi) {
            sendSmsSilent(toNumber, message)
        } else {
            sendSmsViaIntent(toNumber, message)
        }
    }

    /**
     * Send SMS via Intent (shows compose screen)
     *
     * This delegates to system SMS app, requires no permission on most devices.
     */
    private fun sendSmsViaIntent(toNumber: String, message: String): ActionResult {
        return try {
            val uri = Uri.parse("smsto:$toNumber")
            val intent = Intent(Intent.ACTION_SENDTO, uri).apply {
                putExtra("sms_body", message)
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }

            if (intent.resolveActivity(context.packageManager) == null) {
                return ActionResult.failure("No SMS app found")
            }

            context.startActivity(intent)
            val segmentCount = (message.length + MAX_SMS_LENGTH - 1) / MAX_SMS_LENGTH
            Log.i(TAG, "SMS intent sent to $toNumber — $segmentCount segment(s)")
            ActionResult.success("SMS sent to $toNumber ($segmentCount segments)")
        } catch (e: Exception) {
            ActionResult.failure("Failed to send SMS via intent: ${e.message}")
        }
    }

    /**
     * Send SMS silently via SmsManager
     *
     * Requires SEND_SMS permission.
     * Auto-splits messages > 160 chars.
     * Works best when app is the default SMS handler.
     */
    private fun sendSmsSilent(toNumber: String, message: String): ActionResult {
        return try {
            val smsManager = context.getSystemService(SmsManager::class.java)
            val parts = splitSms(message)

            if (parts.isEmpty()) {
                return ActionResult.failure("Message is empty")
            }

            smsManager.sendMultipartTextMessage(
                toNumber,
                null,
                ArrayList(parts),
                null,
                null
            )

            Log.i(TAG, "Silent SMS sent to $toNumber — ${parts.size} part(s)")
            ActionResult.success(
                "SMS sent silently to $toNumber (${parts.size} parts)"
            )
        } catch (e: SecurityException) {
            ActionResult.failure("SMS permission not granted: ${e.message}")
        } catch (e: Exception) {
            ActionResult.failure("Failed to send SMS silently: ${e.message}")
        }
    }

    /**
     * Split SMS into segments (max 160 chars per segment)
     */
    private fun splitSms(message: String): List<String> {
        val parts = mutableListOf<String>()
        var offset = 0
        while (offset < message.length) {
            val end = minOf(offset + MAX_SMS_LENGTH, message.length)
            parts.add(message.substring(offset, end))
            offset = end
        }
        return parts
    }
}
