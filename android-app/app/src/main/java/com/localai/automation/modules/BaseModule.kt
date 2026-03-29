package com.localai.automation.modules

import android.content.Context
import com.localai.automation.models.AgentModule

enum class ModuleStatus {
    INITIALIZING, RUNNING, STOPPED, ERROR, PERMISSION_DENIED
}

data class ModuleState(
    val module: AgentModule,
    val status: ModuleStatus,
    val message: String = "",
    val lastEventTime: Long? = null
)

/**
 * Base interface for all agent monitoring modules.
 * Each module is independent and communicates only via EventPipeline.
 */
interface AgentModuleInterface {
    val moduleType: AgentModule
    val requiredPermissions: List<String>
    fun start(context: Context)
    fun stop()
    fun getState(): ModuleState
    fun hasRequiredPermissions(context: Context): Boolean
}
