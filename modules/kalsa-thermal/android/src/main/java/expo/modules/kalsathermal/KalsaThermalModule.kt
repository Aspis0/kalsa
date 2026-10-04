package expo.modules.kalsathermal

import android.os.Build
import android.os.Bundle
import android.os.HardwarePropertiesManager
import android.os.PowerManager
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File

private const val THERMAL_STATE_DID_CHANGE = "thermalStateDidChange"

private const val THERMAL_ZONE_DIR = "/sys/class/thermal"

/** Cap on the per-component zone entries a bench probe reports. */
private const val MAX_COMPONENT_ZONES = 40

/**
 * Bridges Android's OS thermal severity (PowerManager) for the hard gate and
 * the governor feed. Also hosts `probeThermalZonesAsync`, a bench-only
 * diagnostic that reads /sys/class/thermal zones and HardwarePropertiesManager
 * temperatures from inside the app process; its output feeds no gate and no
 * governor decision.
 */
class KalsaThermalModule : Module() {
  private var thermalListener: PowerManager.OnThermalStatusChangedListener? = null

  override fun definition() = ModuleDefinition {
    Name("KalsaThermal")

    Events(THERMAL_STATE_DID_CHANGE)

    AsyncFunction("getCurrentThermalStateAsync") {
      currentSnapshot()
    }

    AsyncFunction("probeThermalZonesAsync") {
      probeThermalZones()
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

  // Bench-only probe: answers whether an untrusted_app process can read
  // per-component temperatures. Every read is try/caught and the entry point
  // itself never throws.
  private fun probeThermalZones(): Bundle {
    return try {
      Bundle().apply {
        putBundle("sysfs", probeSysfsZones())
        putBundle("hardwareProperties", probeHardwareProperties())
      }
    } catch (t: Throwable) {
      Bundle().apply { putString("error", describe(t)) }
    }
  }

  private fun describe(t: Throwable): String = "${t.javaClass.name}: ${t.message ?: ""}"

  /**
   * Reads every thermal_zone*: how many type/temp files are readable, the first
   * failure per file kind, and the cpu, gpu and nsp zones (type + raw temp),
   * capped at MAX_COMPONENT_ZONES. The count loop covers all zones; the cap
   * applies only to the reported entries.
   */
  private fun probeSysfsZones(): Bundle {
    val result = Bundle()
    val zones = try {
      File(THERMAL_ZONE_DIR).list { _, name -> name.startsWith("thermal_zone") }?.sorted()
    } catch (t: Throwable) {
      result.putString("listError", describe(t))
      null
    }
    if (zones == null) {
      result.putInt("zones", 0)
      return result
    }
    var typeReadable = 0
    var tempReadable = 0
    var typeError: String? = null
    var tempError: String? = null
    val components = ArrayList<Bundle>()
    for (zone in zones) {
      val type = try {
        File("$THERMAL_ZONE_DIR/$zone/type").readText().trim()
      } catch (t: Throwable) {
        if (typeError == null) typeError = describe(t)
        null
      }
      val temp = try {
        File("$THERMAL_ZONE_DIR/$zone/temp").readText().trim()
      } catch (t: Throwable) {
        if (tempError == null) tempError = describe(t)
        null
      }
      if (type != null) typeReadable++
      if (temp != null) tempReadable++
      if (type != null && temp != null && isComponentType(type) &&
        components.size < MAX_COMPONENT_ZONES
      ) {
        components.add(
          Bundle().apply {
            putString("zone", zone)
            putString("type", type)
            putString("temp", temp)
          },
        )
      }
    }
    result.apply {
      putInt("zones", zones.size)
      putInt("typeReadable", typeReadable)
      putInt("tempReadable", tempReadable)
      if (typeError != null) putString("typeError", typeError)
      if (tempError != null) putString("tempError", tempError)
      putParcelableArrayList("components", components)
    }
    return result
  }

  /** Vendor zone types name components with a cpu/gpu/nsp prefix (cpuss-0, gpuss-1, nspss-0). */
  private fun isComponentType(type: String): Boolean {
    val lower = type.lowercase()
    return lower.startsWith("cpu") || lower.startsWith("gpu") || lower.startsWith("nsp")
  }

  /** DEVICE_TEMPERATURE_CPU/GPU/SKIN at TEMPERATURE_CURRENT; blank below API 24. */
  private fun probeHardwareProperties(): Bundle {
    val result = Bundle()
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.N) {
      result.putBoolean("supported", false)
      return result
    }
    val manager = try {
      appContext.reactContext?.applicationContext
        ?.getSystemService(HardwarePropertiesManager::class.java)
    } catch (t: Throwable) {
      result.putString("serviceError", describe(t))
      null
    }
    if (manager == null) {
      result.putBoolean("supported", false)
      return result
    }
    result.apply {
      putBoolean("supported", true)
      putBundle(
        "cpu",
        currentTemperatures(manager, HardwarePropertiesManager.DEVICE_TEMPERATURE_CPU),
      )
      putBundle(
        "gpu",
        currentTemperatures(manager, HardwarePropertiesManager.DEVICE_TEMPERATURE_GPU),
      )
      putBundle(
        "skin",
        currentTemperatures(manager, HardwarePropertiesManager.DEVICE_TEMPERATURE_SKIN),
      )
    }
    return result
  }

  /** The float array when the service answers (empty means no data), else the exception. */
  private fun currentTemperatures(manager: HardwarePropertiesManager, device: Int): Bundle {
    return try {
      val temps = manager.getDeviceTemperatures(
        device,
        HardwarePropertiesManager.TEMPERATURE_CURRENT,
      )
      Bundle().apply { putFloatArray("values", temps) }
    } catch (t: Throwable) {
      Bundle().apply { putString("error", describe(t)) }
    }
  }
}
