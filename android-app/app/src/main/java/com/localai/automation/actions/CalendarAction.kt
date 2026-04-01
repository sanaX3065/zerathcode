package com.localai.automation.actions

import android.content.ContentValues
import android.content.Context
import android.database.Cursor
import android.net.Uri
import android.provider.CalendarContract
import android.util.Log
import com.localai.automation.models.AgentAction
import java.util.TimeZone

/**
 * CalendarAction
 *
 * Handles CREATE_CALENDAR_EVENT, DELETE_CALENDAR_EVENT, QUERY_CALENDAR
 * via Android ContentResolver (no external libraries needed).
 *
 * Required permissions (declared in AndroidManifest.xml):
 *   android.permission.READ_CALENDAR
 *   android.permission.WRITE_CALENDAR
 *
 * Param schemas:
 *
 * CREATE_CALENDAR_EVENT:
 *   title       : String   — event title (required)
 *   startMs     : Long     — epoch milliseconds (required)
 *   endMs       : Long     — epoch milliseconds (required)
 *   description : String   — optional event description
 *   location    : String   — optional location
 *   allDay      : Boolean  — default false
 *   calendarId  : Long     — default: first writable calendar found
 *
 * DELETE_CALENDAR_EVENT:
 *   eventId     : Long     — calendar event ID to delete
 *
 * QUERY_CALENDAR:
 *   startMs     : Long     — search window start
 *   endMs       : Long     — search window end
 *   maxResults  : Int      — default 10
 */
class CalendarAction(private val context: Context) {

    companion object {
        private const val TAG = "CalendarAction"
    }

    // ── CREATE ────────────────────────────────────────────────────────────────

    fun createEvent(action: AgentAction): ActionResult {
        val title = action.getStringParam("title")
            ?: return ActionResult.failure("Missing required param: title")

        val startMs = action.getLongParam("startMs")
            ?: return ActionResult.failure("Missing required param: startMs")

        val endMs = action.getLongParam("endMs")
            ?: return ActionResult.failure("Missing required param: endMs")

        if (endMs <= startMs) {
            return ActionResult.failure("endMs must be after startMs")
        }

        val calendarId = action.getLongParam("calendarId") ?: findDefaultCalendarId()
            ?: return ActionResult.failure("No writable calendar found. Ensure calendar permission is granted.")

        val values = ContentValues().apply {
            put(CalendarContract.Events.CALENDAR_ID, calendarId)
            put(CalendarContract.Events.TITLE, title)
            put(CalendarContract.Events.DTSTART, startMs)
            put(CalendarContract.Events.DTEND, endMs)
            put(CalendarContract.Events.EVENT_TIMEZONE, TimeZone.getDefault().id)

            action.getStringParam("description")?.let {
                put(CalendarContract.Events.DESCRIPTION, it)
            }
            action.getStringParam("location")?.let {
                put(CalendarContract.Events.EVENT_LOCATION, it)
            }
            action.getBoolParam("allDay")?.let {
                put(CalendarContract.Events.ALL_DAY, if (it) 1 else 0)
            }
        }

        return try {
            val uri: Uri? = context.contentResolver.insert(
                CalendarContract.Events.CONTENT_URI, values
            )
            val eventId = uri?.lastPathSegment?.toLongOrNull()
                ?: return ActionResult.failure("Insert returned null URI")

            Log.i(TAG, "Created calendar event id=$eventId title=$title")
            ActionResult.success("Calendar event created: \"$title\" (id=$eventId)")
        } catch (e: SecurityException) {
            ActionResult.failure("Calendar permission denied: ${e.message}")
        } catch (e: Exception) {
            ActionResult.failure("Failed to create event: ${e.message}")
        }
    }

    // ── DELETE ────────────────────────────────────────────────────────────────

    fun deleteEvent(action: AgentAction): ActionResult {
        val eventId = action.getLongParam("eventId")
            ?: return ActionResult.failure("Missing required param: eventId")

        val deleteUri = Uri.withAppendedPath(
            CalendarContract.Events.CONTENT_URI, eventId.toString()
        )

        return try {
            val rowsDeleted = context.contentResolver.delete(deleteUri, null, null)
            if (rowsDeleted > 0) {
                Log.i(TAG, "Deleted calendar event id=$eventId")
                ActionResult.success("Calendar event $eventId deleted")
            } else {
                ActionResult.failure("No event found with id=$eventId")
            }
        } catch (e: SecurityException) {
            ActionResult.failure("Calendar permission denied: ${e.message}")
        } catch (e: Exception) {
            ActionResult.failure("Failed to delete event: ${e.message}")
        }
    }

    // ── QUERY ─────────────────────────────────────────────────────────────────

    fun queryEvents(action: AgentAction): ActionResult {
        val startMs = action.getLongParam("startMs") ?: System.currentTimeMillis()
        val endMs   = action.getLongParam("endMs")   ?: (startMs + 7 * 24 * 60 * 60 * 1000L) // 1 week
        val max     = action.getIntParam("maxResults") ?: 10

        val projection = arrayOf(
            CalendarContract.Events._ID,
            CalendarContract.Events.TITLE,
            CalendarContract.Events.DTSTART,
            CalendarContract.Events.DTEND,
            CalendarContract.Events.DESCRIPTION,
            CalendarContract.Events.EVENT_LOCATION,
            CalendarContract.Events.ALL_DAY,
        )

        val selection = "(${CalendarContract.Events.DTSTART} >= ?) AND " +
                        "(${CalendarContract.Events.DTSTART} <= ?) AND " +
                        "(${CalendarContract.Events.DELETED} = 0)"
        val selArgs = arrayOf(startMs.toString(), endMs.toString())

        return try {
            val cursor: Cursor? = context.contentResolver.query(
                CalendarContract.Events.CONTENT_URI,
                projection,
                selection,
                selArgs,
                "${CalendarContract.Events.DTSTART} ASC"
            )

            val events = mutableListOf<Map<String, Any>>()
            cursor?.use { c ->
                while (c.moveToNext() && events.size < max) {
                    events.add(mapOf(
                        "id"          to c.getLong(0),
                        "title"       to (c.getString(1) ?: ""),
                        "startMs"     to c.getLong(2),
                        "endMs"       to c.getLong(3),
                        "description" to (c.getString(4) ?: ""),
                        "location"    to (c.getString(5) ?: ""),
                        "allDay"      to (c.getInt(6) == 1),
                    ))
                }
            }

            Log.i(TAG, "Queried calendar: ${events.size} events found")
            ActionResult.success(
                "Found ${events.size} event(s)",
                data = mapOf("events" to events)
            )
        } catch (e: SecurityException) {
            ActionResult.failure("Calendar permission denied: ${e.message}")
        } catch (e: Exception) {
            ActionResult.failure("Calendar query failed: ${e.message}")
        }
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private fun findDefaultCalendarId(): Long? {
        val projection = arrayOf(
            CalendarContract.Calendars._ID,
            CalendarContract.Calendars.ACCOUNT_TYPE,
            CalendarContract.Calendars.CALENDAR_ACCESS_LEVEL,
        )
        val selection = "(${CalendarContract.Calendars.CALENDAR_ACCESS_LEVEL} >= ${CalendarContract.Calendars.CAL_ACCESS_CONTRIBUTOR})"

        return try {
            val cursor = context.contentResolver.query(
                CalendarContract.Calendars.CONTENT_URI,
                projection,
                selection,
                null,
                null
            )
            cursor?.use { c ->
                if (c.moveToFirst()) c.getLong(0) else null
            }
        } catch (e: Exception) {
            Log.w(TAG, "Could not find default calendar: ${e.message}")
            null
        }
    }
}
