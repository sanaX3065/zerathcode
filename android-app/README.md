# Android Bridge Module
**ZerathCode v1.0 — Device-to-AI Integration**

---

## Overview

The Android bridge module establishes bidirectional WebSocket communication between the Android device and the ZerathCode Node.js server running in Termux. This enables the AI orchestrator to execute device-native operations (hardware control, event forwarding, state queries) and receive real-time device state updates.

**Core Architecture:**
- **WebSocketBridge** — Maintains persistent WebSocket connection with exponential backoff reconnection
- **BridgeProtocol** — Type-safe message envelope for action requests and responses
- **BridgeActionExecutor** — Routes ACTION and QUERY message types to appropriate handlers
- **BridgeEventEmitter** — Forwards device events (battery, location, connectivity) to Node.js server
- **BridgeManager** — Singleton lifecycle manager integrated with Android app runtime
- **AgentRuntimeService** — Modified to manage bridge lifecycle during app operation

---

## Architecture

```
┌──────────────────────────────────────────────────────┐
│         AndroidManifest Permissions Layer            │
│  • camera, location, contacts, SMS, calendar, etc.   │
└────────────────────┬─────────────────────────────────┘
                     │
┌────────────────────▼─────────────────────────────────┐
│            AgentRuntimeService (Lifecycle)           │
│  • onCreate()  → Initialize BridgeManager            │
│  • startRuntime() → Start WebSocket connection       │
│  • processEvent() → Forward device events            │
│  • stopRuntime()  → Cleanup bridge                   │
└────────────────────┬─────────────────────────────────┘
                     │
┌────────────────────▼──────────────────────┐
│        BridgeManager (Singleton)          │
│  • Manages lifecycle                      │
│  • Initializes WebSocket & handlers       │
│  • Exposes execute() API                  │
└────────────────────┬──────────────────────┘
                     │
         ┌───────────┴───────────┐
         ▼                       ▼
  ┌────────────────┐    ┌──────────────────┐
  │ WebSocketBridge│    │ BridgeEventEmitter│
  │                │    │                  │
  │ Methods:       │    │ Forwards:        │
  │ • connect()    │    │ • BATTERY_LOW    │
  │ • send()       │    │ • LOCATION_CHANGE│
  │ • reconnect()  │    │ • CONNECTIVITY   │
  │ • close()      │    │ • ALARM_TRIGGERED│
  └────────┬───────┘    └──────────┬───────┘
           │                       │
           └───────────┬───────────┘
                       │
          ┌────────────▼────────────┐
          │  BridgeProtocol         │
          │  (Message Types)        │
          │  • HANDSHAKE            │
          │  • ACTION (execute)     │
          │  • QUERY (get state)    │
          │  • EVENT (device→server)│
          │  • ACK (received)       │
          └────────────┬────────────┘
                       │
          ┌────────────▼────────────┐
          │ BridgeActionExecutor    │
          │                         │
          │ Handlers:               │
          │ • Phase1ActionExecutor  │
          │   (SET_SILENT_MODE etc) │
          │ • Phase2ActionExecutor  │
          │   (Calendar, Alarms,    │
          │    WiFi, Apps, SMS)     │
          │ • More custom handlers  │
          └─────────────────────────┘
```

---

## File Structure

```
android-app/
├── app/
│   ├── src/main/
│   │   ├── java/com/example/zerathcode/
│   │   │   ├── BridgeMessage.kt              # Protocol message data class
│   │   │   ├── WebSocketBridge.kt            # WebSocket client
│   │   │   ├── BridgeActionExecutor.kt       # Routes ACTION messages
│   │   │   ├── BridgeEventEmitter.kt         # Forwards device events
│   │   │   ├── BridgeManager.kt              # Lifecycle manager
│   │   │   ├── AgentRuntimeService.kt        # Modified to use BridgeManager
│   │   │   ├── actions/
│   │   │   │   ├── ActionResult.kt           # Unified result type
│   │   │   │   ├── Phase1ActionExecutor.kt   # Phase 1 actions
│   │   │   │   ├── Phase2ActionExecutor.kt   # Phase 2 actions
│   │   │   │   ├── CalendarAction.kt         # Calendar operations
│   │   │   │   ├── AlarmAction.kt            # Alarm management
│   │   │   │   ├── ConnectivityAction.kt     # WiFi/Bluetooth/DND
│   │   │   │   └── AppAction.kt              # App launch, SMS sending
│   │   │   ├── models/
│   │   │   │   └── Models.kt                 # ActionType enum, Message types
│   │   │   └── ...
│   │   └── AndroidManifest.xml               # Permissions + components
│   └── build.gradle
└── gradle.properties
```

---

## Protocol Specification

### Message Types

**HANDSHAKE** (Device → Server)
```kotlin
{
  "type": "HANDSHAKE",
  "deviceId": "device-uuid",
  "version": "1.0",
  "capabilities": ["ACTIONS", "EVENTS", "QUERIES"]
}
```

**ACTION** (Server → Device)
```kotlin
{
  "type": "ACTION",
  "id": "msg-123",
  "actionType": "SET_SILENT_MODE",
  "params": { "enabled": true }
}
```

Device executes and responds:
```kotlin
{
  "type": "ACTION_RESPONSE",
  "id": "msg-123",
  "actionType": "SET_SILENT_MODE",
  "success": true,
  "result": { "previousMode": "ring" }
}
```

**QUERY** (Server → Device)
```kotlin
{
  "type": "QUERY",
  "id": "msg-124",
  "queryType": "GET_DEVICE_STATE"
}
```

Device responds with current state:
```kotlin
{
  "type": "QUERY_RESPONSE",
  "id": "msg-124",
  "state": {
    "battery": 75,
    "charging": false,
    "brightness": 120,
    "ringer_mode": "vibrate",
    "location": { "lat": 37.7749, "lng": -122.4194 },
    "wifi_enabled": true,
    "bluetooth_enabled": false
  }
}
```

**EVENT** (Device → Server)
```kotlin
{
  "type": "EVENT",
  "eventType": "BATTERY_LOW",
  "timestamp": 1672531200000,
  "data": { "level": 15, "plugged": false }
}
```

**ACK** (Bidirectional)
```kotlin
{
  "type": "ACK",
  "id": "msg-123"
}
```

---

## Supported Actions

### Phase 1: Device Control
- `SET_SILENT_MODE` — Enable/disable silent mode
- `SET_BRIGHTNESS` — Adjust screen brightness
- `GET_DEVICE_STATE` — Query current device state

### Phase 2: Calendar & Alarms
- `CREATE_CALENDAR_EVENT` — Add event to calendar
- `QUERY_CALENDAR` — Retrieve events for date range
- `DELETE_CALENDAR_EVENT` — Remove calendar event
- `SET_ALARM` — Schedule alarm (with intent + silent paths)
- `DISMISS_ALARM` — Cancel active alarm

### Phase 2: Connectivity
- `SET_WIFI` — Enable/disable WiFi radio
- `SET_BLUETOOTH` — Enable/disable Bluetooth
- `SET_DND_MODE` — Toggle Do Not Disturb

### Phase 2: Applications
- `LAUNCH_APP` — Open specific app (with intent + silent paths)
- `SEND_SMS` — Send text message

---

## Integration with Node.js Server

### Connection Flow

1. **Server Startup** (Node.js)
   ```javascript
   const DeviceBridge = require("./deviceBridge");
   const bridge = new DeviceBridge();
   await bridge.start("ws://0.0.0.0:8765");
   ```

2. **Device Connection** (Android/Kotlin)
   ```kotlin
   bridgeManager.connect("ws://192.168.1.100:8765")
   // → BridgeManager initializes WebSocketBridge
   // → Sends HANDSHAKE
   // → Starts event forwarding
   ```

3. **Execution** (Orchestrator)
   ```javascript
   const result = await bridge.execute("SET_SILENT_MODE", { enabled: true });
   // → WebSocket sends ACTION message
   // → Device executor processes
   // → Sends ACTION_RESPONSE
   // → Promise resolves with result
   ```

---

## Scaling: Adding New Actions

### Step 1: Define ActionType

Edit `android-app/app/src/main/java/com/example/zerathcode/models/Models.kt`:

```kotlin
enum class ActionType {
  // Phase 1
  SET_SILENT_MODE,
  SET_BRIGHTNESS,
  GET_DEVICE_STATE,
  
  // Phase 2
  CREATE_CALENDAR_EVENT,
  QUERY_CALENDAR,
  DELETE_CALENDAR_EVENT,
  SET_ALARM,
  DISMISS_ALARM,
  SET_WIFI,
  SET_BLUETOOTH,
  SET_DND_MODE,
  LAUNCH_APP,
  SEND_SMS,
  
  // Phase 3 (NEW)
  CUSTOM_ACTION,  // Add here
}
```

### Step 2: Implement Handler

Create `android-app/app/src/main/java/com/example/zerathcode/actions/CustomActionHandler.kt`:

```kotlin
package com.example.zerathcode.actions

import android.content.Context
import com.example.zerathcode.models.ActionType

class CustomActionHandler(private val context: Context) {
  
  suspend fun handleCustomAction(params: Map<String, Any>): ActionResult {
    return try {
      // Validate params
      val param1 = (params["param1"] as? String) 
        ?: return ActionResult.failure("param1 required")
      
      // Execute action
      val result = performCustomLogic(param1)
      
      // Return success
      ActionResult.success(
        actionType = ActionType.CUSTOM_ACTION,
        data = mapOf("result" to result)
      )
    } catch (e: Exception) {
      ActionResult.failure("Custom action failed: ${e.message}")
    }
  }
  
  private suspend fun performCustomLogic(param: String): String {
    // Implement your logic
    return "completed"
  }
}
```

### Step 3: Register in Phase Executor

Edit `android-app/app/src/main/java/com/example/zerathcode/actions/Phase3ActionExecutor.kt`:

```kotlin
package com.example.zerathcode.actions

import android.content.Context
import com.example.zerathcode.models.ActionType

class Phase3ActionExecutor(private val context: Context) {
  
  private val customHandler = CustomActionHandler(context)
  
  suspend fun execute(
    actionType: ActionType,
    params: Map<String, Any>
  ): ActionResult {
    return when (actionType) {
      ActionType.CUSTOM_ACTION -> customHandler.handleCustomAction(params)
      // Other Phase 3 actions...
      else -> ActionResult.failure("Unknown action: $actionType")
    }
  }
}
```

### Step 4: Update BridgeActionExecutor

Edit `android-app/app/src/main/java/com/example/zerathcode/BridgeActionExecutor.kt`:

```kotlin
class BridgeActionExecutor(private val context: Context) {
  
  private val phase1 = Phase1ActionExecutor(context)
  private val phase2 = Phase2ActionExecutor(context)
  private val phase3 = Phase3ActionExecutor(context)  // Add instance
  
  suspend fun execute(actionType: ActionType, params: Map<String, Any>): ActionResult {
    return when (actionType) {
      ActionType.SET_SILENT_MODE, ActionType.SET_BRIGHTNESS, ActionType.GET_DEVICE_STATE 
        -> phase1.execute(actionType, params)
      
      ActionType.CREATE_CALENDAR_EVENT, ActionType.QUERY_CALENDAR, ... 
        -> phase2.execute(actionType, params)
      
      ActionType.CUSTOM_ACTION  // Route to Phase 3
        -> phase3.execute(actionType, params)
      
      else -> ActionResult.failure("Unknown action: $actionType")
    }
  }
}
```

### Step 5: Add Permissions

Edit `android-app/app/src/main/AndroidManifest.xml`:

```xml
<!-- For custom action -->
<uses-permission android:name="android.permission.REQUIRED_PERMISSION" />

<!-- Add BroadcastReceiver if needed -->
<receiver
  android:name=".actions.CustomReceiver"
  android:exported="true">
  <intent-filter>
    <action android:name="YOUR_ACTION_NAME" />
  </intent-filter>
</receiver>
```

### Step 6: Test

```bash
# Server logs action execution
zerath bridge

# In another terminal, trigger action via orchestrator
zerath repl
> "execute custom action with param1"
```

---

## Reconnection Strategy

WebSocketBridge implements exponential backoff:

```
Attempt 1: immediately
Attempt 2: 1s delay
Attempt 3: 2s delay
Attempt 4: 4s delay
Attempt 5: 8s delay
...up to max 60s delay
```

This ensures robust recovery from network interruptions without overwhelming the server.

---

## Error Handling

All action handlers return `ActionResult`:

```kotlin
sealed class ActionResult {
  data class Success(val actionType: ActionType, val data: Map<String, Any>) : ActionResult()
  data class Failure(val message: String) : ActionResult()
}
```

Failures are logged and returned to server without crashing the app. The orchestrator receives error details and can trigger self-healing or retry logic.

---

## Dependencies

- **OkHttp 4.12.0** — WebSocket client
- **Kotlin Coroutines** — Async action execution
- **Android Framework** — Content providers, intents, permissions

All available in `app/build.gradle`.
