package com.localai.automation.ui.locations

import android.view.*
import androidx.recyclerview.widget.DiffUtil
import androidx.recyclerview.widget.ListAdapter
import androidx.recyclerview.widget.RecyclerView
import com.localai.automation.data.entities.LocationEntity
import com.localai.automation.databinding.ItemLocationBinding

class LocationAdapter(
    private val onDelete: (LocationEntity) -> Unit,
    private val onToggle: (Long, Boolean) -> Unit
) : ListAdapter<LocationEntity, LocationAdapter.VH>(DIFF) {

    companion object {
        val DIFF = object : DiffUtil.ItemCallback<LocationEntity>() {
            override fun areItemsTheSame(a: LocationEntity, b: LocationEntity) = a.id == b.id
            override fun areContentsTheSame(a: LocationEntity, b: LocationEntity) = a == b
        }
    }

    inner class VH(val b: ItemLocationBinding) : RecyclerView.ViewHolder(b.root)

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int) =
        VH(ItemLocationBinding.inflate(LayoutInflater.from(parent.context), parent, false))

    override fun onBindViewHolder(holder: VH, position: Int) {
        val loc = getItem(position)
        holder.b.apply {
            tvLocationName.text = loc.name
            tvCoords.text = "%.5f, %.5f".format(loc.latitude, loc.longitude)
            tvRadius.text = "Radius: ${loc.radius.toInt()}m"
            switchActive.isChecked = loc.isActive
            switchActive.setOnCheckedChangeListener { _, checked -> onToggle(loc.id, checked) }
            btnDelete.setOnClickListener { onDelete(loc) }
        }
    }
}
