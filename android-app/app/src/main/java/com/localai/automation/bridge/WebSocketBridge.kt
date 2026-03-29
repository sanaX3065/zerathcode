package com.localai.automation.bridge

import android.util.Log
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import okhttp3.*
import okio.ByteString
import java.util.concurrent.TimeUnit

/**
 * WebSocket client that connects the Android app to the Termux AI bridge server.
 *
 * Responsibilities:
 *  - Maintain persistent connection to ws://localhost:8765
 *  - Auto-reconnect with exponential backoff
 *  - Route incoming messages to registered handlers
 *  - Respond to ping with pong automatically
 */
class WebSocketBridge(
    private val serverUrl: String = "ws://localhost:8765"
) {
    companion object {
        private const val TAG = "WebSocketBridge"
        private const val BASE_RECONNECT_DELAY_MS = 2000L
        private const val MAX_RECONNECT_DELAY_MS  = 30_000L
        private const val MAX_RECONNECT_ATTEMPTS  = 20
    }

    // ── Connection state ──────────────────────────────────────────────────────

    enum class State { DISCONNECTED, CONNECTING, CONNECTED, RECONNECTING }

    private val _state = MutableStateFlow(State.DISCONNECTED)
    val state: StateFlow<State> = _state.asStateFlow()

    fun isConnected() = _state.value == State.CONNECTED

    // ── Internals ─────────────────────────────────────────────────────────────

    private var webSocket: WebSocket? = null
    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    private var reconnectAttempts = 0
    private var shouldConnect = false

    private val client = OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(0, TimeUnit.MILLISECONDS)   // No timeout — WebSocket is persistent
        .writeTimeout(5, TimeUnit.SECONDS)
        .retryOnConnectionFailure(false)          // We handle retries ourselves
        .build()

    // ── Callbacks — set these before calling connect() ────────────────────────

    var onMessageReceived: ((BridgeMessage) -> Unit)? = null
    var onConnected:       (() -> Unit)? = null
    var onDisconnected:    (() -> Unit)? = null

    // ── Lifecycle ─────────────────────────────────────────────────────────────

    fun connect() {
        if (shouldConnect) return
        shouldConnect = true
        reconnectAttempts = 0
        _attemptConnect()
    }

    fun disconnect() {
        shouldConnect = false
        reconnectAttempts = 0
        webSocket?.close(1000, "App disconnecting")
        webSocket = null
        _state.value = State.DISCONNECTED
        Log.i(TAG, "Disconnected from bridge")
    }

    fun cleanup() {
        disconnect()
        scope.cancel()
        client.dispatcher.executorService.shutdown()
    }

    // ── Send ──────────────────────────────────────────────────────────────────

    fun send(message: BridgeMessage): Boolean {
        val ws = webSocket
        if (ws == null || !isConnected()) {
            Log.w(TAG, "Cannot send — not connected")
            return false
        }
        val json = message.toJson()
        Log.d(TAG, "→ Sending: ${message.type} (${json.length} bytes)")
        return ws.send(json)
    }

    // ── Connection attempt ────────────────────────────────────────────────────

    private fun _attemptConnect() {
        if (!shouldConnect) return

        _state.value = if (reconnectAttempts == 0) State.CONNECTING else State.RECONNECTING

        Log.i(TAG, "Connecting to $serverUrl (attempt ${reconnectAttempts + 1})")

        val request = Request.Builder().url(serverUrl).build()

        webSocket = client.newWebSocket(request, object : WebSocketListener() {

            override fun onOpen(webSocket: WebSocket, response: Response) {
                Log.i(TAG, "Connected to bridge server")
                reconnectAttempts = 0
                _state.value = State.CONNECTED
                onConnected?.invoke()
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                _handleIncoming(text)
            }

            override fun onMessage(webSocket: WebSocket, bytes: ByteString) {
                _handleIncoming(bytes.utf8())
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                Log.w(TAG, "Connection failed: ${t.message}")
                _state.value = State.DISCONNECTED
                onDisconnected?.invoke()
                _scheduleReconnect()
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                Log.i(TAG, "Connection closed: $code / $reason")
                _state.value = State.DISCONNECTED
                onDisconnected?.invoke()
                if (shouldConnect) _scheduleReconnect()
            }
        })
    }

    private fun _handleIncoming(text: String) {
        try {
            val msg = BridgeMessage.fromJson(text)
            Log.d(TAG, "← Received: ${msg.type}")

            // Handle ping internally — do not forward
            if (msg.type == MessageType.PING) {
                send(BridgeMessage.pong(msg.id))
                return
            }

            onMessageReceived?.invoke(msg)
        } catch (e: Exception) {
            Log.e(TAG, "Failed to parse incoming message: ${e.message}")
        }
    }

    private fun _scheduleReconnect() {
        if (!shouldConnect) return
        if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
            Log.e(TAG, "Max reconnect attempts reached — giving up")
            _state.value = State.DISCONNECTED
            return
        }

        val delay = minOf(
            BASE_RECONNECT_DELAY_MS * (1L shl reconnectAttempts.coerceAtMost(5)),
            MAX_RECONNECT_DELAY_MS
        )
        reconnectAttempts++

        Log.i(TAG, "Will reconnect in ${delay}ms (attempt $reconnectAttempts)")

        scope.launch {
            delay(delay)
            _attemptConnect()
        }
    }
}
