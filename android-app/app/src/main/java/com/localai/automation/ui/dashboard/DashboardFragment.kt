package com.localai.automation.ui.dashboard

import android.media.AudioManager
import android.os.Bundle
import android.provider.Settings
import android.view.*
import androidx.fragment.app.Fragment
import androidx.fragment.app.activityViewModels
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import androidx.recyclerview.widget.LinearLayoutManager
import com.localai.automation.databinding.FragmentDashboardBinding
import com.localai.automation.service.AgentRuntimeService
import com.localai.automation.ui.MainViewModel
import kotlinx.coroutines.launch

class DashboardFragment : Fragment() {

    private var _binding: FragmentDashboardBinding? = null
    private val binding get() = _binding!!
    private val viewModel: MainViewModel by activityViewModels()

    private lateinit var eventAdapter: EventAdapter
    private lateinit var actionAdapter: ActionAdapter
    private lateinit var errorAdapter: ActionAdapter  // reuses same adapter, filtered data

    private enum class Tab { EVENTS, ACTIONS, ERRORS }
    private var currentTab = Tab.EVENTS

    override fun onCreateView(
        inflater: LayoutInflater, container: ViewGroup?, savedInstanceState: Bundle?
    ): View {
        _binding = FragmentDashboardBinding.inflate(inflater, container, false)
        return binding.root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)

        setupAdapters()
        setupTabs()
        observeData()
        refreshSystemState()
    }

    override fun onResume() {
        super.onResume()
        refreshSystemState()
    }

    // ─── Adapters ─────────────────────────────────────────────────────────────

    private fun setupAdapters() {
        eventAdapter  = EventAdapter()
        actionAdapter = ActionAdapter()
        errorAdapter  = ActionAdapter()

        binding.recyclerEvents.apply {
            adapter = eventAdapter
            layoutManager = LinearLayoutManager(requireContext())
        }
        binding.recyclerActions.apply {
            adapter = actionAdapter
            layoutManager = LinearLayoutManager(requireContext())
        }
        binding.recyclerErrors.apply {
            adapter = errorAdapter
            layoutManager = LinearLayoutManager(requireContext())
        }
    }

    // ─── Tab switching ────────────────────────────────────────────────────────

    private fun setupTabs() {
        binding.btnTabEvents.setOnClickListener  { switchTab(Tab.EVENTS)  }
        binding.btnTabActions.setOnClickListener { switchTab(Tab.ACTIONS) }
        binding.btnTabErrors.setOnClickListener  { switchTab(Tab.ERRORS)  }
        switchTab(Tab.EVENTS)
    }

    private fun switchTab(tab: Tab) {
        currentTab = tab
        binding.layoutEvents.visibility  = if (tab == Tab.EVENTS)  View.VISIBLE else View.GONE
        binding.layoutActions.visibility = if (tab == Tab.ACTIONS) View.VISIBLE else View.GONE
        binding.layoutErrors.visibility  = if (tab == Tab.ERRORS)  View.VISIBLE else View.GONE

        // Update button styles: filled = active, outlined = inactive
        binding.btnTabEvents.isSelected  = (tab == Tab.EVENTS)
        binding.btnTabActions.isSelected = (tab == Tab.ACTIONS)
        binding.btnTabErrors.isSelected  = (tab == Tab.ERRORS)
    }

    // ─── System state panel ───────────────────────────────────────────────────

    private fun refreshSystemState() {
        val ctx = requireContext()

        // Ringer mode
        val audio = ctx.getSystemService(AudioManager::class.java)
        binding.tvStateMode.text = when (audio.ringerMode) {
            AudioManager.RINGER_MODE_SILENT  -> "🔇 Silent"
            AudioManager.RINGER_MODE_VIBRATE -> "📳 Vibrate"
            else                              -> "🔔 Normal"
        }

        // Brightness
        try {
            val autoMode = Settings.System.getInt(
                ctx.contentResolver,
                Settings.System.SCREEN_BRIGHTNESS_MODE,
                Settings.System.SCREEN_BRIGHTNESS_MODE_MANUAL
            )
            if (autoMode == Settings.System.SCREEN_BRIGHTNESS_MODE_AUTOMATIC) {
                binding.tvStateBrightness.text = "☀️ Auto"
            } else {
                val level = Settings.System.getInt(ctx.contentResolver,
                    Settings.System.SCREEN_BRIGHTNESS, 128)
                val pct = (level * 100 / 255)
                binding.tvStateBrightness.text = "☀️ $pct%"
            }
        } catch (e: Exception) {
            binding.tvStateBrightness.text = "☀️ —"
        }

        // Runtime
        val running = AgentRuntimeService.isRunning
        binding.tvStateRuntime.text = if (running) "🟢 Running" else "🔴 Stopped"
        binding.tvStateRuntime.setTextColor(
            android.graphics.Color.parseColor(if (running) "#4CAF50" else "#F44336")
        )

        // Active rules count
        val activeCount = viewModel.rules.value.count { it.isEnabled }
        binding.tvStateRules.text = "$activeCount active"
    }

    // ─── Observe data flows ───────────────────────────────────────────────────

    private fun observeData() {
        viewLifecycleOwner.lifecycleScope.launch {
            repeatOnLifecycle(Lifecycle.State.STARTED) {

                launch {
                    viewModel.events.collect { events ->
                        eventAdapter.submitList(events.take(100))
                        val count = events.size
                        binding.tvEventCount.text = "$count event${if (count != 1) "s" else ""}"
                        binding.btnTabEvents.text = "Events ($count)"
                        binding.tvEmptyEvents.visibility =
                            if (events.isEmpty()) View.VISIBLE else View.GONE
                        // Refresh state when new events arrive
                        refreshSystemState()
                    }
                }

                launch {
                    viewModel.actions.collect { actions ->
                        actionAdapter.submitList(actions.take(100))
                        val count = actions.size
                        binding.tvActionCount.text = "$count action${if (count != 1) "s" else ""}"
                        binding.btnTabActions.text = "Actions ($count)"
                        binding.tvEmptyActions.visibility =
                            if (actions.isEmpty()) View.VISIBLE else View.GONE
                    }
                }

                launch {
                    viewModel.failedActions.collect { errors ->
                        errorAdapter.submitList(errors.take(100))
                        val count = errors.size
                        binding.tvErrorCount.text = "$count error${if (count != 1) "s" else ""}"
                        binding.btnTabErrors.text = "Errors ($count)"
                        binding.tvEmptyErrors.visibility =
                            if (errors.isEmpty()) View.VISIBLE else View.GONE
                        // Highlight errors tab if there are errors
                        if (count > 0 && currentTab != Tab.ERRORS) {
                            binding.tvErrorCount.setTextColor(
                                android.graphics.Color.parseColor("#EA4335")
                            )
                        }
                    }
                }

                launch {
                    // Refresh state panel when rules change
                    viewModel.rules.collect { refreshSystemState() }
                }
            }
        }
    }

    override fun onDestroyView() {
        super.onDestroyView()
        _binding = null
    }
}