package com.localai.automation.bridge

import android.content.Context
import android.util.Log
import com.localai.automation.data.repository.LocalRepository
import com.localai.automation.models.AgentEvent
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch

/**
 * Top-level manager for the AI ↔ Android bridge.
 * Owned by AgentRuntimeService. One instance per app lifecycle.
 *
 * Wires together:
 *   WebSocketBridge       — connection management
 *   BridgeActionExecutor  — handles incoming ACTION/QUERY messages
 *   BridgeEventEmitter    — forwards device events to AI
 */
class BridgeManager(
    private val context: Context,
    private val repository: LocalRepository
) {
    companion object {
        private const val TAG = "BridgeManager"

        // Termux runs on localhost — same device
        private const val BRIDGE_URL = "ws://localhost:8765"
    }

    val bridge   = WebSocketBridge(serverUrl = BRIDGE_URL)
    val emitter  = BridgeEventEmitter(bridge)
    private val executor = BridgeActionExecutor(context, repository, bridge)
    private val scope    = CoroutineScope(Dispatchers.IO)

    // Expose connection state for UI
    val connectionState: StateFlow<WebSocketBridge.State> = bridge.state

    // ── Lifecycle ─────────────────────────────────────────────────────────────

    fun start() {
        Log.i(TAG, "Starting bridge manager")

        bridge.onMessageReceived = { message ->
            Log.d(TAG, "Dispatching message type: ${message.type}")
            executor.handle(message)
        }

        bridge.onConnected = {
            Log.i(TAG, "Bridge connected to AI server")
        }

        bridge.onDisconnected = {
            Log.w(TAG, "Bridge disconnected from AI server")
        }

        bridge.connect()
    }

    fun stop() {
        Log.i(TAG, "Stopping bridge manager")
        bridge.disconnect()
    }

    fun cleanup() {
        bridge.cleanup()
    }

    // ── Event forwarding ──────────────────────────────────────────────────────

    /** Called by AgentRuntimeService whenever a device event fires */
    fun forwardEvent(event: AgentEvent) {
        emitter.emit(event)
    }

    // ── State push ────────────────────────────────────────────────────────────

    /** Push a fresh state snapshot without being asked */
    fun pushStateSnapshot() {
        if (!bridge.isConnected()) return
        scope.launch {
            val state = executor.buildStateSnapshot()
            bridge.send(BridgeMessage.stateSnapshot(state = state))
        }
    }

    fun isConnected() = bridge.isConnected()
}
