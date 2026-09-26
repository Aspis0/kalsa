package expo.modules.kalsairoh

import android.util.Base64
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import uniffi.kalsa_iroh_mobile.Lane
import uniffi.kalsa_iroh_mobile.MobileBridge
import uniffi.kalsa_iroh_mobile.Tunnel
import java.io.File
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
  // Two pools, split by whether the call parks. Reads (and writes, which
  // backpressure can park) sit on an unbounded cached pool: each parks up
  // to its own deadline — a long SSE read — and a parked read must never
  // starve another call; the crate bounds every park, so unbounded threads
  // are bounded in time. Control calls (start, node id, open, shutdown)
  // are short and must stay responsive during teardown: a small fixed pool.
  private val parking = Executors.newCachedThreadPool()
  private val control = Executors.newFixedThreadPool(4)
  private val bridges = Any()
  @Volatile private var bridge: MobileBridge? = null
  @Volatile private var destroyed = false
  private val tunnels = ConcurrentHashMap<Long, Tunnel>()
  private val nextId = AtomicLong(0)

  override fun definition() = ModuleDefinition {
    Name("KalsaIroh")

    AsyncFunction("startBridge") { promise: Promise ->
      run(control, promise) { startBridgeAtFilesDir() }
    }

    AsyncFunction("nodeId") { promise: Promise ->
      run(control, promise) { currentBridge().nodeId() }
    }

    AsyncFunction("openTunnel") { nodeHex: String, lane: String, promise: Promise ->
      run(control, promise) {
        val target = when (lane) {
          "door" -> Lane.Door
          "desk" -> Lane.Desk
          else -> throw IllegalArgumentException("lane must be \"door\" or \"desk\", got: $lane")
        }
        val tunnel = currentBridge().connect(nodeHex, target)
        if (destroyed) {
          // OnDestroy raced this open: the module is gone, so the fresh
          // tunnel closes right away and is never handed out.
          tunnel.shutdown()
          throw IllegalStateException("the module is destroyed")
        }
        val id = nextId.incrementAndGet()
        tunnels[id] = tunnel
        id
      }
    }

    AsyncFunction("write") { id: Double, base64: String, timeoutMs: Double, promise: Promise ->
      run(parking, promise) {
        tunnel(id.toLong())
          .write(Base64.decode(base64, Base64.NO_WRAP), timeoutMs.toUInt())
      }
    }

    AsyncFunction("read") { id: Double, max: Double, timeoutMs: Double, promise: Promise ->
      run(parking, promise) {
        val bytes = tunnel(id.toLong()).read(max.toUInt(), timeoutMs.toUInt())
        Base64.encodeToString(bytes, Base64.NO_WRAP)
      }
    }

    AsyncFunction("shutdown") { id: Double, promise: Promise ->
      run(control, promise) {
        // Removed whether or not it was open: a shut-down handle is gone.
        tunnels.remove(id.toLong())?.shutdown()
      }
    }

    OnDestroy {
      // First: no new work is accepted and no racing open may keep its
      // tunnel. Then the pools drain what is in flight and stop.
      destroyed = true
      val open = tunnels.values.toList()
      tunnels.clear()
      val current = synchronized(bridges) { val b = bridge; bridge = null; b }
      control.execute {
        open.forEach { it.shutdown() }
        dropBridge(current)
      }
      parking.shutdown()
      control.shutdown()
    }
  }

  /** Run one blocking native call on `pool`, resolving or rejecting the promise. */
  private fun run(pool: ExecutorService, promise: Promise, body: () -> Any?) {
    try {
      pool.execute {
        try {
          promise.resolve(body())
        } catch (e: Throwable) {
          promise.reject("KALSA_IROH", e.message ?: e::class.simpleName ?: "native error")
        }
      }
    } catch (e: Throwable) {
      // The pool is shut down or saturated beyond its queue: the call never ran.
      promise.reject("KALSA_IROH", e.message ?: "could not submit the native call")
    }
  }

  private fun startBridgeAtFilesDir(): MobileBridge {
    if (destroyed) throw IllegalStateException("the module is destroyed")
    val filesDir = appContext.reactContext?.applicationContext?.filesDir
      ?: throw IllegalStateException("the Android context is not ready")
    val started = MobileBridge(File(filesDir, "iroh-node.key").path)
    val previous = synchronized(bridges) {
      val old = bridge
      bridge = started
      old
    }
    if (previous != null) {
      // Drop the replaced bridge outside the lock: its runtime shutdown
      // is bounded but not instant, and no caller is waiting on it.
      control.execute { dropBridge(previous) }
    }
    return started
  }

  private fun currentBridge(): MobileBridge {
    return bridge ?: throw IllegalStateException("the bridge is not started")
  }

  private fun tunnel(id: Long): Tunnel {
    return tunnels[id] ?: throw IllegalStateException("no tunnel $id")
  }

  private fun dropBridge(toDrop: MobileBridge?) {
    synchronized(bridges) {
      if (toDrop == null || bridge === toDrop) bridge = null
    }
    // Dropping the reference runs the crate's bounded runtime shutdown;
    // it happens on a pool thread, never the JS thread.
  }
}
