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
  // Bounded on purpose: calls park up to their own deadlines (a 30 s
  // read), so an unbounded pool would let a runaway caller spawn threads
  // without limit. The ninth concurrent call waits for a thread — the JS
  // side sees latency, never a silently dropped call.
  private val native = Executors.newFixedThreadPool(8)
  private val bridges = Any()
  @Volatile private var bridge: MobileBridge? = null
  private val tunnels = ConcurrentHashMap<Long, Tunnel>()
  private val nextId = AtomicLong(0)

  override fun definition() = ModuleDefinition {
    Name("KalsaIroh")

    AsyncFunction("startBridge") { promise: Promise ->
      run(promise) { startBridgeAtFilesDir() }
    }

    AsyncFunction("nodeId") { promise: Promise ->
      run(promise) { currentBridge().nodeId() }
    }

    AsyncFunction("openTunnel") { nodeHex: String, lane: String, promise: Promise ->
      run(promise) {
        val target = when (lane) {
          "door" -> Lane.Door
          "desk" -> Lane.Desk
          else -> throw IllegalArgumentException("lane must be \"door\" or \"desk\", got: $lane")
        }
        val tunnel = currentBridge().connect(nodeHex, target)
        val id = nextId.incrementAndGet()
        tunnels[id] = tunnel
        id
      }
    }

    AsyncFunction("write") { id: Double, base64: String, timeoutMs: Double, promise: Promise ->
      run(promise) {
        tunnel(id.toLong())
          .write(Base64.decode(base64, Base64.NO_WRAP), timeoutMs.toUInt())
      }
    }

    AsyncFunction("read") { id: Double, max: Double, timeoutMs: Double, promise: Promise ->
      run(promise) {
        val bytes = tunnel(id.toLong()).read(max.toUInt(), timeoutMs.toUInt())
        Base64.encodeToString(bytes, Base64.NO_WRAP)
      }
    }

    AsyncFunction("shutdown") { id: Double, promise: Promise ->
      run(promise) {
        // Removed whether or not it was open: a shut-down handle is gone.
        tunnels.remove(id.toLong())?.shutdown()
      }
    }

    OnDestroy {
      val open = tunnels.values.toList()
      tunnels.clear()
      native.execute {
        open.forEach { it.shutdown() }
        dropBridge(currentBridge())
      }
      // After the queued teardown runs, the pool takes no more work.
      native.shutdown()
    }
  }

  /** Run one blocking native call on the pool, resolving or rejecting the promise. */
  private fun run(promise: Promise, body: () -> Any?) {
    try {
      native.execute {
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
      native.execute { dropBridge(previous) }
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
      if (bridge === toDrop) bridge = null
    }
    // Dropping the reference runs the crate's bounded runtime shutdown;
    // it happens on this pool thread, never the JS thread.
  }
}
