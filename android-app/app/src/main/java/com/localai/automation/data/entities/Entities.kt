package com.localai.automation.data.entities

import androidx.room.Entity
import androidx.room.PrimaryKey

@Entity(tableName = "locations")
data class LocationEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val name: String,
    val latitude: Double,
    val longitude: Double,
    val radius: Float = 100f,
    val isActive: Boolean = true,
    val createdAt: Long = System.currentTimeMillis()
)

@Entity(tableName = "rules")
data class RuleEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val name: String,
    val description: String = "",
    val conditionJson: String,
    val actionJson: String,
    val priority: Float = 0.5f,
    val isEnabled: Boolean = true,
    val triggerCount: Int = 0,
    val lastTriggered: Long? = null,
    val createdAt: Long = System.currentTimeMillis()
)

@Entity(tableName = "events")
data class EventEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val agentModule: String,
    val eventType: String,
    val dataJson: String,
    val timestamp: Long = System.currentTimeMillis(),
    val processed: Boolean = false
)

@Entity(tableName = "actions")
data class ActionEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val actionType: String,
    val paramsJson: String,
    val sourceRuleId: Long? = null,
    val timestamp: Long = System.currentTimeMillis(),
    val resultStatus: String = "PENDING",
    val errorMessage: String? = null,
    /** Human-readable explanation of what triggered this action. */
    val triggerReason: String? = null
)

@Entity(tableName = "permission_history")
data class PermissionHistoryEntity(
    @PrimaryKey val permission: String,
    val isGranted: Boolean,
    val lastChecked: Long = System.currentTimeMillis(),
    val lastAction: String? = null
)

@Entity(tableName = "chat_messages")
data class ChatMessageEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val content: String,
    val isUser: Boolean,
    val timestamp: Long = System.currentTimeMillis(),
    val linkedRuleId: Long? = null
)