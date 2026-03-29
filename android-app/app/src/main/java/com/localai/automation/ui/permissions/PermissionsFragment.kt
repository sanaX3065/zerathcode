package com.localai.automation.ui.permissions

import android.Manifest
import android.content.pm.PackageManager
import android.os.Bundle
import android.view.*
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import androidx.fragment.app.Fragment
import androidx.fragment.app.activityViewModels
import androidx.lifecycle.lifecycleScope
import com.localai.automation.databinding.FragmentPermissionsBinding
import com.localai.automation.modules.NotificationModule
import com.localai.automation.service.AgentRuntimeService
import com.localai.automation.service.StabilityLayer
import com.localai.automation.ui.MainViewModel
import kotlinx.coroutines.launch
import android.app.AlertDialog
import android.net.Uri
import android.provider.Settings as AndroidSettings

class PermissionsFragment : Fragment() {

    private var _binding: FragmentPermissionsBinding? = null
    private val binding get() = _binding!!
    private val viewModel: MainViewModel by activityViewModels()

    private val requestPermissions = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { results ->
        results.forEach { (perm, granted) ->
            lifecycleScope.launch { viewModel.repository.upsertPermission(perm, granted,
                if (granted) "GRANTED" else "DENIED") }
        }
        refreshPermissionStates()
    }

    override fun onCreateView(inflater: LayoutInflater, container: ViewGroup?, savedInstanceState: Bundle?): View {
        _binding = FragmentPermissionsBinding.inflate(inflater, container, false)
        return binding.root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)
        setupButtons()
        refreshPermissionStates()
        showOemGuidanceIfNeeded()
    }

    override fun onResume() {
        super.onResume()
        refreshPermissionStates()
    }

    private fun setupButtons() {
        binding.btnGrantLocation.setOnClickListener {
            requestPermissions.launch(arrayOf(
                Manifest.permission.ACCESS_FINE_LOCATION,
                Manifest.permission.ACCESS_COARSE_LOCATION))
        }
        binding.btnGrantBackgroundLocation.setOnClickListener {
            requestPermissions.launch(arrayOf(Manifest.permission.ACCESS_BACKGROUND_LOCATION))
        }
        binding.btnGrantNotificationListener.setOnClickListener {
            startActivity(android.content.Intent(AndroidSettings.ACTION_NOTIFICATION_LISTENER_SETTINGS))
        }
        binding.btnGrantWriteSettings.setOnClickListener {
            startActivity(android.content.Intent(AndroidSettings.ACTION_MANAGE_WRITE_SETTINGS).apply {
                data = Uri.parse("package:${requireContext().packageName}")
            })
        }
        binding.btnGrantUsageAccess.setOnClickListener {
            startActivity(android.content.Intent(AndroidSettings.ACTION_USAGE_ACCESS_SETTINGS))
        }
        binding.btnBatteryOptimization.setOnClickListener {
            val ctx = requireContext()
            if (!StabilityLayer.isIgnoringBatteryOptimizations(ctx)) {
                try {
                    startActivity(StabilityLayer.buildBatteryOptimizationIntent(ctx))
                } catch (e: Exception) {
                    Toast.makeText(ctx, "Open Battery settings manually and exempt this app", Toast.LENGTH_LONG).show()
                }
            } else {
                Toast.makeText(ctx, "Battery optimization already disabled ✓", Toast.LENGTH_SHORT).show()
            }
        }
        binding.btnStartRuntime.setOnClickListener {
            AgentRuntimeService.startService(requireContext())
            Toast.makeText(requireContext(), "Runtime starting…", Toast.LENGTH_SHORT).show()
            refreshPermissionStates()
        }
        binding.btnStopRuntime.setOnClickListener {
            AgentRuntimeService.stopService(requireContext())
            Toast.makeText(requireContext(), "Runtime stopped.", Toast.LENGTH_SHORT).show()
            refreshPermissionStates()
        }
    }

    private fun refreshPermissionStates() {
        val ctx = requireContext()
        fun hasPerm(p: String) = ContextCompat.checkSelfPermission(ctx, p) == PackageManager.PERMISSION_GRANTED

        setRow(binding.tvLocationStatus, binding.btnGrantLocation, hasPerm(Manifest.permission.ACCESS_FINE_LOCATION))
        setRow(binding.tvBgLocationStatus, binding.btnGrantBackgroundLocation, hasPerm(Manifest.permission.ACCESS_BACKGROUND_LOCATION))
        setRow(binding.tvNotifListenerStatus, binding.btnGrantNotificationListener, NotificationModule.isNotificationListenerEnabled(ctx))
        setRow(binding.tvWriteSettingsStatus, binding.btnGrantWriteSettings, AndroidSettings.System.canWrite(ctx))

        // Battery optimization
        val batteryExempt = StabilityLayer.isIgnoringBatteryOptimizations(ctx)
        binding.tvBatteryOptStatus.text = if (batteryExempt) "✓ Exempted" else "✗ Not exempted (service may be killed)"
        binding.tvBatteryOptStatus.setTextColor(color(if (batteryExempt) "#4CAF50" else "#FF9800"))
        binding.btnBatteryOptimization.isEnabled = !batteryExempt
        binding.btnBatteryOptimization.alpha = if (batteryExempt) 0.4f else 1.0f

        // Runtime
        val running = AgentRuntimeService.isRunning
        binding.tvRuntimeStatus.text = if (running) "● Running" else "● Stopped"
        binding.tvRuntimeStatus.setTextColor(color(if (running) "#4CAF50" else "#F44336"))
    }

    private fun setRow(tv: android.widget.TextView, btn: android.widget.Button, granted: Boolean) {
        tv.text = if (granted) "✓ Granted" else "✗ Not granted"
        tv.setTextColor(color(if (granted) "#4CAF50" else "#F44336"))
        btn.isEnabled = !granted
        btn.alpha = if (granted) 0.4f else 1.0f
    }

    private fun color(hex: String) = android.graphics.Color.parseColor(hex)

    private fun showOemGuidanceIfNeeded() {
        val guidance = StabilityLayer.getOemGuidance() ?: return
        if (AgentRuntimeService.isRunning) return  // Only show if service might be at risk
        AlertDialog.Builder(requireContext())
            .setTitle("${guidance.manufacturer} Detected")
            .setMessage("Your device manufacturer may aggressively kill background apps.\n\nFor reliable automation:\n\n" +
                guidance.steps.joinToString("\n") { "• $it" })
            .setPositiveButton("Got it", null)
            .show()
    }

    override fun onDestroyView() {
        super.onDestroyView()
        _binding = null
    }
}
