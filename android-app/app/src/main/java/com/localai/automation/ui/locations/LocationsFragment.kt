package com.localai.automation.ui.locations

import android.Manifest
import android.app.AlertDialog
import android.content.pm.PackageManager
import android.os.Bundle
import android.view.*
import android.widget.*
import androidx.core.content.ContextCompat
import androidx.fragment.app.Fragment
import androidx.fragment.app.activityViewModels
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import androidx.recyclerview.widget.LinearLayoutManager
import com.google.android.gms.location.LocationServices
import com.localai.automation.R
import com.localai.automation.databinding.FragmentLocationsBinding
import com.localai.automation.ui.MainViewModel
import kotlinx.coroutines.launch

class LocationsFragment : Fragment() {

    private var _binding: FragmentLocationsBinding? = null
    private val binding get() = _binding!!
    private val viewModel: MainViewModel by activityViewModels()
    private lateinit var adapter: LocationAdapter

    override fun onCreateView(
        inflater: LayoutInflater, container: ViewGroup?, savedInstanceState: Bundle?
    ): View {
        _binding = FragmentLocationsBinding.inflate(inflater, container, false)
        return binding.root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)

        adapter = LocationAdapter(
            onDelete = { viewModel.deleteLocation(it) },
            onToggle = { id, active -> viewModel.toggleLocation(id, active) }
        )

        binding.recyclerLocations.apply {
            this.adapter = this@LocationsFragment.adapter
            layoutManager = LinearLayoutManager(requireContext())
        }

        binding.fabAddLocation.setOnClickListener { showAddLocationDialog() }

        viewLifecycleOwner.lifecycleScope.launch {
            repeatOnLifecycle(Lifecycle.State.STARTED) {
                viewModel.locations.collect { locations ->
                    adapter.submitList(locations)
                    binding.tvEmptyLocations.visibility =
                        if (locations.isEmpty()) View.VISIBLE else View.GONE
                }
            }
        }
    }

    // ─── Add Location Dialog ──────────────────────────────────────────────────

    private fun showAddLocationDialog() {
        val dialogView = LayoutInflater.from(requireContext())
            .inflate(R.layout.dialog_add_location, null)

        val etName    = dialogView.findViewById<EditText>(R.id.etLocationName)
        val etLat     = dialogView.findViewById<EditText>(R.id.etLatitude)
        val etLng     = dialogView.findViewById<EditText>(R.id.etLongitude)
        val seekRadius = dialogView.findViewById<SeekBar>(R.id.seekRadius)
        val tvRadius  = dialogView.findViewById<TextView>(R.id.tvRadiusValue)
        val btnCurrent = dialogView.findViewById<android.widget.Button>(R.id.btnCurrentLocation)

        // SeekBar: progress 0–950 → radius 50–1000m
        seekRadius.max = 950
        seekRadius.progress = 50   // default 100m
        tvRadius.text = "100m"

        seekRadius.setOnSeekBarChangeListener(object : SeekBar.OnSeekBarChangeListener {
            override fun onProgressChanged(sb: SeekBar, progress: Int, fromUser: Boolean) {
                tvRadius.text = "${progress + 50}m"
            }
            override fun onStartTrackingTouch(sb: SeekBar) {}
            override fun onStopTrackingTouch(sb: SeekBar) {}
        })

        btnCurrent.setOnClickListener {
            fetchCurrentLocation { lat, lng ->
                etLat.setText("%.6f".format(lat))
                etLng.setText("%.6f".format(lng))
                btnCurrent.text = "✓ Location filled"
                btnCurrent.isEnabled = false
            }
        }

        AlertDialog.Builder(requireContext())
            .setTitle("Add Location Zone")
            .setView(dialogView)
            .setPositiveButton("Add") { _, _ ->
                val name   = etName.text.toString().trim()
                val latStr = etLat.text.toString().trim()
                val lngStr = etLng.text.toString().trim()
                val radius = (seekRadius.progress + 50).toFloat()

                val lat = latStr.toDoubleOrNull()
                val lng = lngStr.toDoubleOrNull()

                if (name.isBlank() || lat == null || lng == null) {
                    Toast.makeText(requireContext(), "Please fill in name, latitude, and longitude",
                        Toast.LENGTH_SHORT).show()
                    return@setPositiveButton
                }
                viewModel.addLocation(name, lat, lng, radius)
            }
            .setNegativeButton("Cancel", null)
            .show()
    }

    // ─── Fetch current location ───────────────────────────────────────────────

    private fun fetchCurrentLocation(onResult: (Double, Double) -> Unit) {
        val ctx = requireContext()
        val hasFine = ContextCompat.checkSelfPermission(ctx, Manifest.permission.ACCESS_FINE_LOCATION) ==
            PackageManager.PERMISSION_GRANTED
        val hasCoarse = ContextCompat.checkSelfPermission(ctx, Manifest.permission.ACCESS_COARSE_LOCATION) ==
            PackageManager.PERMISSION_GRANTED

        if (!hasFine && !hasCoarse) {
            Toast.makeText(ctx, "Location permission required. Grant it in the Permissions tab.",
                Toast.LENGTH_LONG).show()
            return
        }

        Toast.makeText(ctx, "Fetching current location…", Toast.LENGTH_SHORT).show()

        val client = LocationServices.getFusedLocationProviderClient(ctx)
        client.lastLocation
            .addOnSuccessListener { location ->
                if (location != null) {
                    requireActivity().runOnUiThread {
                        onResult(location.latitude, location.longitude)
                    }
                } else {
                    requireActivity().runOnUiThread {
                        Toast.makeText(ctx,
                            "Could not get location. Make sure GPS is on and try again.",
                            Toast.LENGTH_LONG).show()
                    }
                }
            }
            .addOnFailureListener {
                requireActivity().runOnUiThread {
                    Toast.makeText(ctx, "Location fetch failed: ${it.message}",
                        Toast.LENGTH_SHORT).show()
                }
            }
    }

    override fun onDestroyView() {
        super.onDestroyView()
        _binding = null
    }
}