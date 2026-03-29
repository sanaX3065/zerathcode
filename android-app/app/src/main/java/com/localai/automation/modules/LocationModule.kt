package com.localai.automation.modules

import android.Manifest
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.util.Log
import androidx.core.app.ActivityCompat
import com.google.android.gms.location.*
import com.localai.automation.data.AppDatabase
import com.localai.automation.data.entities.LocationEntity
import com.localai.automation.models.AgentEvent
import com.localai.automation.models.AgentModule
import com.localai.automation.models.EventType
import com.localai.automation.pipeline.EventPipeline
import kotlinx.coroutines.*

class LocationModule : AgentModuleInterface {

    override val moduleType = AgentModule.LOCATION
    override val requiredPermissions = listOf(
        Manifest.permission.ACCESS_FINE_LOCATION,
        Manifest.permission.ACCESS_BACKGROUND_LOCATION
    )

    private var state = ModuleState(AgentModule.LOCATION, ModuleStatus.STOPPED)
    private var geofencingClient: GeofencingClient? = null
    private var geofencePendingIntent: PendingIntent? = null
    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())

    companion object {
        const val TAG = "LocationModule"
        const val ACTION_GEOFENCE = "com.localai.automation.GEOFENCE_EVENT"
    }

    override fun start(context: Context) {
        if (!hasRequiredPermissions(context)) {
            state = ModuleState(AgentModule.LOCATION, ModuleStatus.PERMISSION_DENIED,
                "Location permissions not granted")
            return
        }

        state = ModuleState(AgentModule.LOCATION, ModuleStatus.INITIALIZING)
        geofencingClient = LocationServices.getGeofencingClient(context)

        scope.launch {
            try {
                val locations = AppDatabase.getInstance(context).locationDao().getActiveLocations()
                if (locations.isEmpty()) {
                    state = ModuleState(AgentModule.LOCATION, ModuleStatus.RUNNING,
                        "Running – no zones configured")
                    return@launch
                }
                registerGeofences(context, locations)
                state = ModuleState(AgentModule.LOCATION, ModuleStatus.RUNNING,
                    "Monitoring ${locations.size} zone(s)")
            } catch (e: Exception) {
                Log.e(TAG, "Failed to start location module", e)
                state = ModuleState(AgentModule.LOCATION, ModuleStatus.ERROR, e.message ?: "Unknown error")
            }
        }
    }

    private fun registerGeofences(context: Context, locations: List<LocationEntity>) {
        if (ActivityCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION)
            != PackageManager.PERMISSION_GRANTED) return

        val geofences = locations.map { loc ->
            Geofence.Builder()
                .setRequestId(loc.id.toString())
                .setCircularRegion(loc.latitude, loc.longitude, loc.radius)
                .setExpirationDuration(Geofence.NEVER_EXPIRE)
                .setTransitionTypes(
                    Geofence.GEOFENCE_TRANSITION_ENTER or Geofence.GEOFENCE_TRANSITION_EXIT
                )
                .build()
        }

        val request = GeofencingRequest.Builder()
            .setInitialTrigger(GeofencingRequest.INITIAL_TRIGGER_ENTER)
            .addGeofences(geofences)
            .build()

        val intent = Intent(context, GeofenceBroadcastReceiver::class.java).apply {
            action = ACTION_GEOFENCE
        }
        val pendingIntent = PendingIntent.getBroadcast(
            context, 0, intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE
        )
        geofencePendingIntent = pendingIntent

        geofencingClient?.addGeofences(request, pendingIntent)
            ?.addOnSuccessListener {
                Log.d(TAG, "Geofences registered: ${geofences.size}")
            }
            ?.addOnFailureListener { e ->
                Log.e(TAG, "Failed to register geofences", e)
                state = ModuleState(AgentModule.LOCATION, ModuleStatus.ERROR, e.message ?: "Geofence error")
            }
    }

    override fun stop() {
        geofencePendingIntent?.let {
            geofencingClient?.removeGeofences(it)
        }
        scope.cancel()
        state = ModuleState(AgentModule.LOCATION, ModuleStatus.STOPPED)
    }

    override fun getState() = state

    override fun hasRequiredPermissions(context: Context): Boolean {
        return requiredPermissions.all {
            ActivityCompat.checkSelfPermission(context, it) == PackageManager.PERMISSION_GRANTED
        }
    }

    fun refreshGeofences(context: Context) {
        stop()
        start(context)
    }
}

// ─── Geofence Broadcast Receiver ─────────────────────────────────────────────

class GeofenceBroadcastReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        val geofencingEvent = GeofencingEvent.fromIntent(intent) ?: return

        if (geofencingEvent.hasError()) {
            Log.e("GeofenceReceiver", "Geofencing error: ${geofencingEvent.errorCode}")
            return
        }

        val transition = geofencingEvent.geofenceTransition
        val triggeringGeofences = geofencingEvent.triggeringGeofences ?: return

        val eventType = when (transition) {
            Geofence.GEOFENCE_TRANSITION_ENTER -> EventType.ENTERED_ZONE
            Geofence.GEOFENCE_TRANSITION_EXIT -> EventType.EXITED_ZONE
            else -> return
        }

        val scope = CoroutineScope(Dispatchers.IO)
        scope.launch {
            triggeringGeofences.forEach { geofence ->
                val locationId = geofence.requestId.toLongOrNull()
                val locationName = locationId?.let {
                    AppDatabase.getInstance(context).locationDao().getLocationById(it)?.name
                } ?: "Unknown Zone"

                val event = AgentEvent(
                    module = AgentModule.LOCATION,
                    eventType = eventType,
                    data = mapOf(
                        "locationId" to (locationId ?: -1L),
                        "locationName" to locationName,
                        "transition" to transition
                    )
                )
                EventPipeline.get().emit(event)
            }
        }
    }
}
