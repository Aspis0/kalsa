package expo.modules.kalsathermal

import android.os.Build
import android.os.Bundle
import android.os.PowerManager
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

private const val THERMAL_STATE_DID_CHANGE = "thermalStateDidChange"

/** Bridges Android's OS thermal severity, never a raw thermal-zone temperature. */
class KalsaThermalModule : Module() {
  private var thermalListener: PowerManager.OnThermalStatusChangedListener? = null

  override fun definition() = ModuleDefinition {
    Name("KalsaThermal")

    Events(THERMAL_STATE_DID_CHANGE)

    AsyncFunction("getCurrentThermalStateAsync") {
      currentSnapshot()
    }

    OnStartObserving {
      registerThermalListener()
    }

    OnStopObserving {
      unregisterThermalListener()
    }

    OnDestroy {
      unregisterThermalListener()
    }
  }

  private fun powerManager(): PowerManager? {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return null
    val context = appContext.reactContext?.applicationContext ?: return null
    return context.getSystemService(PowerManager::class.java)
  }

  private fun currentStatus(): Int? {
    val manager = powerManager() ?: return null
    return try {
      manager.getCurrentThermalStatus()
    } catch (_: Throwable) {
      null
    }
  }

  private fun currentSnapshot(status: Int? = currentStatus()): Bundle {
    return Bundle().apply {
      putString("platform", "android")
      putBoolean("supported", status != null)
      if (status != null) putInt("status", status)
    }
  }

  private fun sendCurrentThermalState() {
    try {
      sendEvent(THERMAL_STATE_DID_CHANGE, currentSnapshot())
    } catch (_: Throwable) {
      // Event delivery can race React context teardown; JS also samples on foreground.
    }
  }

  private fun registerThermalListener() {
    if (thermalListener != null) return
    val powerManager = powerManager() ?: return
    val listener = PowerManager.OnThermalStatusChangedListener { status ->
      try {
        sendEvent(THERMAL_STATE_DID_CHANGE, currentSnapshot(status))
      } catch (_: Throwable) {
        // Event delivery is best effort; foreground sampling remains available.
      }
    }
    thermalListener = listener
    powerManager.addThermalStatusListener(listener)
    // Emit the status after registration so JS receives an initial snapshot
    // even when the platform does not produce a subsequent change event.
    sendCurrentThermalState()
  }

  private fun unregisterThermalListener() {
    val listener = thermalListener ?: return
    thermalListener = null
    try {
      powerManager()?.removeThermalStatusListener(listener)
    } catch (_: Throwable) {
      // The process may be tearing down; no further event delivery is needed.
    }
  }
}
