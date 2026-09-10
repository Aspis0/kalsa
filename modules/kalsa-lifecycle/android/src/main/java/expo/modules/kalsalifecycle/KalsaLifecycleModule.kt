package expo.modules.kalsalifecycle

import android.content.ComponentCallbacks2
import android.content.res.Configuration
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

private const val BACKGROUND_TIMER_DID_FIRE = "backgroundTimerDidFire"
private const val TRIM_MEMORY = "trimMemory"

/** Bridges Android lifecycle callbacks and timers that survive Activity pause. */
class KalsaLifecycleModule : Module() {
  private val mainHandler = Handler(Looper.getMainLooper())
  private val timerLock = Any()
  private val timers = mutableMapOf<Int, Runnable>()
  private var nextTimerId = 1
  private var componentCallbacks: ComponentCallbacks2? = null

  override fun definition() = ModuleDefinition {
    Name("KalsaLifecycle")

    Events(BACKGROUND_TIMER_DID_FIRE, TRIM_MEMORY)

    Function("startBackgroundTimer") { delayMs: Double ->
      scheduleTimer(delayMs)
    }

    Function("cancelBackgroundTimer") { id: Int ->
      cancelTimer(id)
    }

    OnStartObserving {
      registerComponentCallbacks()
    }

    OnStopObserving {
      unregisterComponentCallbacks()
    }

    OnDestroy {
      unregisterComponentCallbacks()
      cancelAllTimers()
    }
  }

  private fun scheduleTimer(delayMs: Double): Int {
    val delay = delayMs.coerceAtLeast(0.0).toLong()
    synchronized(timerLock) {
      val id = nextTimerId++
      val runnable = Runnable {
        val shouldFire = synchronized(timerLock) { timers.remove(id) != null }
        if (!shouldFire) return@Runnable
        try {
          sendEvent(BACKGROUND_TIMER_DID_FIRE, Bundle().apply { putInt("id", id) })
        } catch (_: Throwable) {
          // Event delivery can race React context teardown.
        }
      }
      timers[id] = runnable
      mainHandler.postDelayed(runnable, delay)
      return id
    }
  }

  private fun cancelTimer(id: Int) {
    val runnable = synchronized(timerLock) { timers.remove(id) } ?: return
    mainHandler.removeCallbacks(runnable)
  }

  private fun cancelAllTimers() {
    val pending = synchronized(timerLock) {
      val values = timers.values.toList()
      timers.clear()
      values
    }
    pending.forEach { mainHandler.removeCallbacks(it) }
  }

  private fun registerComponentCallbacks() {
    val context = appContext.reactContext?.applicationContext ?: return
    if (componentCallbacks != null) return
    val callbacks = object : ComponentCallbacks2 {
      override fun onConfigurationChanged(newConfig: Configuration) = Unit

      override fun onLowMemory() {
        sendTrimMemory(ComponentCallbacks2.TRIM_MEMORY_COMPLETE)
      }

      override fun onTrimMemory(level: Int) {
        sendTrimMemory(level)
      }
    }
    try {
      context.registerComponentCallbacks(callbacks)
      componentCallbacks = callbacks
    } catch (_: Throwable) {
      // Registration is best effort while the host is tearing down.
    }
  }

  private fun unregisterComponentCallbacks() {
    val callbacks = componentCallbacks ?: return
    componentCallbacks = null
    val context = appContext.reactContext?.applicationContext ?: return
    try {
      context.unregisterComponentCallbacks(callbacks)
    } catch (_: Throwable) {
      // Unregistration can race React context teardown.
    }
  }

  private fun sendTrimMemory(level: Int) {
    try {
      sendEvent(TRIM_MEMORY, Bundle().apply { putInt("level", level) })
    } catch (_: Throwable) {
      // Event delivery can race React context teardown.
    }
  }
}
