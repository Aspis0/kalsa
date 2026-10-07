package expo.modules.kalsairoh

import android.content.Context
import android.net.wifi.WifiManager
import android.util.Base64
import android.util.Log
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import uniffi.kalsa_iroh_mobile.Lane
import uniffi.kalsa_iroh_mobile.IrohMobileException
import uniffi.kalsa_iroh_mobile.MobileBridge
import uniffi.kalsa_iroh_mobile.Tunnel
import java.io.File
import java.util.Collections
import java.util.IdentityHashMap
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicLong

/**
 * The iroh road's platform bridge: one bridge object holding the node
 * identity, tunnels handed to JS by number. Every native call blocks on
 * purpose — the crate's API is blocking and bounded by per-call deadlines —
 * so each runs on a plain pool thread: never the JS thread, and never a
 * coroutine dispatcher the crate could mistake for a runtime context.
 *
 * The key path is resolved here from context.filesDir, not passed from JS:
 * a filesystem path is what the crate wants, and filesDir is the canonical
 * app-files directory — turning a JS file:// URI into a path in two
 * languages would only add a parsing seam where the key lands.
 */
class KalsaIrohModule : Module() {
  companion object {
    private var nativeLibraryLoaded = false
  }

  // Two pools, split by whether the call parks. Reads (and writes, which
  // backpressure can park) sit on an unbounded cached pool: each parks up
  // to its own deadline — a long SSE read — and a parked read must never
  // starve another call. Control calls use a four-thread pool; open can
  // block for a bounded dial, while start, node id, shutdown, and stop are short.
  private val parking = Executors.newCachedThreadPool()
  private val control = Executors.newFixedThreadPool(4)
  private val bridges = Any()
  @Volatile private var bridge: MobileBridge? = null
  @Volatile private var destroyed = false
  private val tunnels = ConcurrentHashMap<Long, Tunnel>()
  private var pendingOpens = 0
  private val nextId = AtomicLong(0)
  @Volatile private var multicastLock: WifiManager.MulticastLock? = null

  private external fun nativeInstallAndroidContext(applicationContext: Context): Boolean

  override fun definition() = ModuleDefinition {
    Name("KalsaIroh")

    AsyncFunction("startBridge") { promise: Promise ->
      run(control, promise, "startBridge") {
        startBridgeAtFilesDir()
        null
      }
    }

    AsyncFunction("stopBridge") { promise: Promise ->
      run(control, promise, "stopBridge") { stopBridge() }
    }

    AsyncFunction("nodeId") { promise: Promise ->
      run(control, promise, "nodeId") { currentBridge().nodeId() }
    }

    AsyncFunction("openTunnel") { nodeHex: String, lane: String, promise: Promise ->
      run(control, promise, "openTunnel") {
        val target = when (lane) {
          "door" -> Lane.DOOR
          "desk" -> Lane.DESK
          else -> throw IllegalArgumentException("lane must be \"door\" or \"desk\", got: $lane")
        }
        val active = synchronized(bridges) {
          if (destroyed) throw IllegalStateException("the module is destroyed")
          val current = currentBridge()
          pendingOpens += 1
          current
        }
        val tunnel = try {
          active.connect(nodeHex, target)
        } catch (error: Throwable) {
          synchronized(bridges) { pendingOpens -= 1 }
          throw error
        }
        val id = synchronized(bridges) {
          pendingOpens -= 1
          if (destroyed || bridge !== active) null
          else nextId.incrementAndGet().also { tunnels[it] = tunnel }
        }
        if (id == null) {
          // Teardown raced this open: close the fresh tunnel before it can
          // escape with a handle backed by a dropped bridge.
          shutdownAndDestroy(tunnel)
          throw IllegalStateException("the bridge stopped during open")
        }
        id
      }
    }

    AsyncFunction("write") { id: Double, base64: String, timeoutMs: Double, promise: Promise ->
      run(parking, promise, "write") {
        tunnel(id.toLong())
          .write(Base64.decode(base64, Base64.NO_WRAP), timeoutMs.toUInt())
      }
    }

    AsyncFunction("read") { id: Double, max: Double, timeoutMs: Double, promise: Promise ->
      run(parking, promise, "read") {
        val bytes = tunnel(id.toLong()).read(max.toUInt(), timeoutMs.toUInt())
        Base64.encodeToString(bytes, Base64.NO_WRAP)
      }
    }

    AsyncFunction("shutdown") { id: Double, promise: Promise ->
      run(control, promise, "shutdown") {
        // Removed whether or not it was open: a shut-down handle is gone.
        tunnels.remove(id.toLong())?.let(::shutdownAndDestroy)
        null
      }
    }

    OnDestroy {
      // First: no new work is accepted and no racing open may keep its
      // tunnel. Then the pools drain what is in flight and stop.
      val (open, current) = synchronized(bridges) {
        destroyed = true
        val openTunnels = tunnels.values.toList()
        tunnels.clear()
        val active = bridge
        bridge = null
        openTunnels to active
      }
      control.execute {
        closeTunnels(open)
        dropBridge(current)
      }
      dropMulticastReception()
      parking.shutdown()
      control.shutdown()
    }
  }

  /** Run one blocking native call on `pool`, resolving or rejecting the promise. */
  private fun run(pool: ExecutorService, promise: Promise, operation: String, body: () -> Any?) {
    try {
      pool.execute {
        try {
          promise.resolve(body())
        } catch (e: Throwable) {
          reject(promise, operation, e, e.message ?: e::class.simpleName ?: "native error")
        }
      }
    } catch (e: Throwable) {
      // The pool is shut down or saturated beyond its queue: the call never ran.
      reject(promise, operation, e, e.message ?: "could not submit the native call")
    }
  }

  private fun reject(promise: Promise, operation: String, error: Throwable, message: String) {
    val code = rejectionCode(error)
    promise.reject(
      code,
      message,
      null,
    )
    if (code == "KALSA_IROH_OTHER") {
      try {
        Log.w("KalsaIroh", unexpectedDiagnostic(operation, error))
      } catch (_: Throwable) {
      }
    }
  }

  private fun unexpectedDiagnostic(operation: String, error: Throwable): String {
    val seen = Collections.newSetFromMap(IdentityHashMap<Throwable, Boolean>())
    val classes = mutableListOf<String>()
    var current: Throwable? = error
    var root = error
    var nativeVariant: String? = null
    while (current != null && classes.size < 16 && seen.add(current)) {
      root = current
      classes.add(current.javaClass.name)
      if (current is IrohMobileException) nativeVariant = current.javaClass.simpleName
      current = current.cause
    }
    val variant = nativeVariant?.let { " native_variant=$it" } ?: ""
    return "operation=$operation root=${root.javaClass.name}$variant causes=${classes.joinToString(" -> ")}"
  }

  private fun rejectionCode(error: Throwable): String = when (error) {
    is AndroidContextInitializationException -> "KALSA_IROH_CONFIG"
    is IrohMobileException.Deadline -> "KALSA_IROH_DEADLINE"
    is IrohMobileException.InvalidNodeHex -> "KALSA_IROH_INVALID_NODE_HEX"
    is IrohMobileException.Transport -> "KALSA_IROH_TRANSPORT"
    is IrohMobileException.Io -> "KALSA_IROH_IO"
    is IrohMobileException.Entropy -> "KALSA_IROH_ENTROPY"
    is IrohMobileException.KeyCorrupt -> "KALSA_IROH_KEY_CORRUPT"
    is IrohMobileException.Config -> "KALSA_IROH_CONFIG"
    is IrohMobileException.Closed -> "KALSA_IROH_CLOSED"
    is IrohMobileException.AsyncContext -> "KALSA_IROH_ASYNC_CONTEXT"
    is LinkageError -> "KALSA_IROH_LINKAGE"
    else -> "KALSA_IROH_OTHER"
  }

  private fun startBridgeAtFilesDir(): MobileBridge {
    if (destroyed) throw IllegalStateException("the module is destroyed")
    val applicationContext = appContext.reactContext?.applicationContext
      ?: throw IllegalStateException("the Android context is not ready")
    synchronized(KalsaIrohModule::class.java) {
      if (!nativeLibraryLoaded) {
        System.loadLibrary("kalsa_iroh_mobile")
        nativeLibraryLoaded = true
      }
    }
    if (!nativeInstallAndroidContext(applicationContext)) throw AndroidContextInitializationException()
    val started = MobileBridge(File(applicationContext.filesDir, "iroh-node.key").path)
    holdMulticastReception(applicationContext)
    // OnDestroy can land while the constructor above blocks: install only
    // if the module is still alive, else close what was just built.
    val (previous, previousTunnels, installed) = synchronized(bridges) {
      if (destroyed) {
        Triple(null, emptyList<Tunnel>(), false)
      } else {
        val old = bridge
        bridge = started
        val oldTunnels = if (old != null) tunnels.values.toList() else emptyList()
        if (old != null) tunnels.clear()
        Triple(old, oldTunnels, true)
      }
    }
    if (!installed) {
      dropMulticastReception()
      started.destroy()
      throw IllegalStateException("the module is destroyed")
    }
    if (previous != null) {
      // Close handles from the replaced bridge outside the lock, then destroy
      // the bridge after its tunnels have released its runtime references.
      control.execute {
        closeTunnels(previousTunnels)
        dropBridge(previous)
      }
    }
    return started
  }

  private fun currentBridge(): MobileBridge {
    return bridge ?: throw IllegalStateException("the bridge is not started")
  }

  /** Android withholds multicast from apps that hold no MulticastLock —
   *  without it LAN discovery never hears the desktop's announcements. */
  private fun holdMulticastReception(context: Context) {
    if (multicastLock?.isHeld == true) return
    try {
      val wifi = context.getSystemService(Context.WIFI_SERVICE) as WifiManager
      multicastLock = wifi.createMulticastLock("kalsa-iroh-mdns").apply {
        setReferenceCounted(false)
        acquire()
      }
    } catch (e: Throwable) {
      Log.w("KalsaIroh", "multicast reception unavailable; LAN discovery cannot listen", e)
      multicastLock = null
    }
  }

  private fun dropMulticastReception() {
    val lock = multicastLock ?: return
    multicastLock = null
    try {
      if (lock.isHeld) lock.release()
    } catch (_: Throwable) {
    }
  }

  /** Keep stop and open/register atomic: an accepted tunnel always keeps its bridge alive. */
  private fun stopBridge(): Boolean {
    val current = synchronized(bridges) {
      if (destroyed) return false
      if (pendingOpens > 0 || tunnels.isNotEmpty()) return false
      val active = bridge
      bridge = null
      active
    }
    dropBridge(current)
    dropMulticastReception()
    return true
  }

  private fun tunnel(id: Long): Tunnel {
    return tunnels[id] ?: throw IllegalStateException("no tunnel $id")
  }

  private fun dropBridge(toDrop: MobileBridge?) {
    synchronized(bridges) {
      if (toDrop == null || bridge === toDrop) bridge = null
    }
    // UniFFI requires explicit destruction; this runs on a control-pool
    // thread and releases the bridge's runtime reference.
    toDrop?.destroy()
  }

  private fun closeTunnels(open: List<Tunnel>) {
    open.forEach { tunnel ->
      try {
        shutdownAndDestroy(tunnel)
      } catch (_: Throwable) {
        // Continue releasing the rest of the handles during module teardown.
      }
    }
  }

  private fun shutdownAndDestroy(tunnel: Tunnel) {
    try {
      tunnel.shutdown()
    } finally {
      tunnel.destroy()
    }
  }

  private class AndroidContextInitializationException :
    IllegalStateException("Could not initialize the iroh Android DNS context")
}
