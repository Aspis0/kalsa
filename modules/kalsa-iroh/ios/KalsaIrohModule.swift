// KalsaIrohModule — the iroh road's Apple bridge: one bridge object holding
// the node identity, tunnels handed to JS by number. Mirror of the Android
// module (expo.modules.kalsairoh.KalsaIrohModule): same method names, the
// same KALSA_IROH_* rejection codes, the same deadlines, and the same
// shutdown semantics — a shut-down or timed-out tunnel is closed for real.
//
// Every native call blocks on purpose — the crate's API is blocking and
// bounded by per-call deadlines — so each runs on its own queue: reads and
// writes (which park up to their deadline) on a concurrent queue, short
// control calls on the serial one; never the JS thread, and never a
// Swift-concurrency thread the crate could mistake for a runtime context.
//
// The key path is resolved here from the app's Application Support
// directory (`<Application Support>/iroh-node.key`, the iOS analog of
// Android's filesDir), not passed from JS: a filesystem path is what the
// crate wants, and no JS file URI ever becomes a parsing seam.

import ExpoModulesCore

/// One JS-visible failure that is not a crate error. Rejected with
/// KALSA_IROH_OTHER, like the Android module's non-uniffi exceptions.
private struct IrohCallError: Error, LocalizedError {
  let message: String
  var errorDescription: String? { message }
}

public class KalsaIrohModule: Module {
  // Control calls (start, node id, open, shutdown) are short and must stay
  // responsive during teardown; reads and writes park up to their own
  // deadline — a long SSE read — and a parked read must never starve
  // another call.
  private let control = DispatchQueue(label: "app.kalsa.iroh.control")
  private let parking = DispatchQueue(
    label: "app.kalsa.iroh.parking", attributes: .concurrent)

  // Guarded by `lock`: tunnels and the flags/bridge they race against.
  // Blocking native calls never run under the lock.
  private let lock = NSLock()
  private var tunnels: [Int64: Tunnel] = [:]
  private var nextId: Int64 = 0
  private var destroyed = false
  private var bridge: MobileBridge?

  public func definition() -> ModuleDefinition {
    Name("KalsaIroh")

    AsyncFunction("startBridge") { (promise: Promise) in
      control.async {
        do {
          try self.startBridge()
          promise.resolve(nil)
        } catch {
          self.reject(promise, error)
        }
      }
    }

    AsyncFunction("nodeId") { (promise: Promise) in
      control.async {
        do {
          promise.resolve(try self.currentBridge().nodeId())
        } catch {
          self.reject(promise, error)
        }
      }
    }

    AsyncFunction("openTunnel") { (nodeHex: String, lane: String, promise: Promise) in
      control.async {
        do {
          try self.openTunnel(nodeHex: nodeHex, lane: lane, promise: promise)
        } catch {
          self.reject(promise, error)
        }
      }
    }

    AsyncFunction("write") { (id: Double, base64: String, timeoutMs: Double, promise: Promise) in
      parking.async {
        do {
          guard let bytes = Data(base64Encoded: base64) else {
            throw IrohCallError(message: "payload is not valid base64")
          }
          try self.tunnel(id).write(bytes: bytes, timeoutMs: Self.deadlineMs(timeoutMs))
          promise.resolve(nil)
        } catch {
          self.reject(promise, error)
        }
      }
    }

    AsyncFunction("read") { (id: Double, max: Double, timeoutMs: Double, promise: Promise) in
      parking.async {
        do {
          let bytes = try self.tunnel(id).read(
            max: Self.deadlineMs(max), timeoutMs: Self.deadlineMs(timeoutMs))
          promise.resolve(bytes.base64EncodedString())
        } catch {
          self.reject(promise, error)
        }
      }
    }

    AsyncFunction("shutdown") { (id: Double, promise: Promise) in
      control.async {
        // Removed whether or not it was open: a shut-down handle is gone.
        self.lock.lock()
        let tunnel = self.tunnels.removeValue(forKey: Self.handle(id))
        self.lock.unlock()
        tunnel?.shutdown()
        promise.resolve(nil)
      }
    }

    OnDestroy {
      // First: no new work is accepted and no racing open may keep its
      // tunnel. The queues drain what is in flight; every parked call
      // still ends at its own deadline.
      lock.lock()
      destroyed = true
      let open = Array(tunnels.values)
      tunnels.removeAll()
      let current = bridge
      bridge = nil
      lock.unlock()
      parking.async {
        for tunnel in open {
          tunnel.shutdown()
        }
        // Released here: the crate's bounded runtime shutdown runs on a
        // queue thread, never the JS thread.
        _ = current
      }
    }
  }

  // MARK: - Blocking calls, run on the queues

  private func startBridge() throws {
    lock.lock()
    let isDestroyed = destroyed
    lock.unlock()
    if isDestroyed {
      throw IrohCallError(message: "the module is destroyed")
    }
    let started = try MobileBridge(keyPath: Self.keyFilePath())
    lock.lock()
    let previous = bridge
    bridge = started
    lock.unlock()
    if let previous {
      // Drop the replaced bridge outside the queues: its runtime shutdown
      // is bounded but not instant, and no caller is waiting on it.
      parking.async { _ = previous }
    }
  }

  // Split out so the dial itself runs while the promise is still open: a
  // destroyed race closes the fresh tunnel and rejects, like the Android
  // module's OnDestroy race.
  private func openTunnel(nodeHex: String, lane: String, promise: Promise) throws {
    lock.lock()
    let isDestroyed = destroyed
    lock.unlock()
    if isDestroyed {
      throw IrohCallError(message: "the module is destroyed")
    }
    let target: Lane
    switch lane {
    case "door": target = .door
    case "desk": target = .desk
    default:
      throw IrohCallError(message: "lane must be \"door\" or \"desk\", got: \(lane)")
    }
    let tunnel = try currentBridge().connect(nodeHex: nodeHex, lane: target)
    lock.lock()
    if destroyed {
      lock.unlock()
      tunnel.shutdown()
      throw IrohCallError(message: "the module is destroyed")
    }
    nextId += 1
    let id = nextId
    tunnels[id] = tunnel
    lock.unlock()
    promise.resolve(Double(id))
  }

  private func currentBridge() throws -> MobileBridge {
    lock.lock()
    let current = bridge
    lock.unlock()
    guard let current else {
      throw IrohCallError(message: "the bridge is not started")
    }
    return current
  }

  private func tunnel(_ id: Double) throws -> Tunnel {
    lock.lock()
    let tunnel = tunnels[Self.handle(id)]
    lock.unlock()
    guard let tunnel else {
      throw IrohCallError(message: "no tunnel \(Self.handle(id))")
    }
    return tunnel
  }

  // MARK: - Helpers

  private func reject(_ promise: Promise, _ error: Error) {
    let message = (error as? LocalizedError)?.errorDescription
      ?? String(describing: error)
    promise.reject(Self.rejectionCode(error), message)
  }

  /// The same codes the Android module rejects with; JS keys road decisions
  /// and diagnostics on them.
  private static func rejectionCode(_ error: Error) -> String {
    switch error as? IrohMobileError {
    case .Io: return "KALSA_IROH_IO"
    case .Entropy: return "KALSA_IROH_ENTROPY"
    case .KeyCorrupt: return "KALSA_IROH_KEY_CORRUPT"
    case .InvalidNodeHex: return "KALSA_IROH_INVALID_NODE_HEX"
    case .Config: return "KALSA_IROH_CONFIG"
    case .Deadline: return "KALSA_IROH_DEADLINE"
    case .Closed: return "KALSA_IROH_CLOSED"
    case .AsyncContext: return "KALSA_IROH_ASYNC_CONTEXT"
    case .Transport: return "KALSA_IROH_TRANSPORT"
    case nil: return "KALSA_IROH_OTHER"
    }
  }

  /// JS numbers arrive as Double; tunnel handles are small integers.
  private static func handle(_ id: Double) -> Int64 {
    Int64(id)
  }

  /// Deadlines cross as doubles and must land on the crate's u32 without
  /// trapping: NaN and negatives clamp to 0 (the crate rejects a 0 ms
  /// deadline as a Config error, like Android's toUInt()), positives
  /// truncate toward zero and saturate at UInt32.max.
  private static func deadlineMs(_ value: Double) -> UInt32 {
    if !value.isFinite {
      return value > 0 ? UInt32.max : 0
    }
    let clamped = min(max(value, 0), Double(UInt32.max))
    return UInt32(clamped)
  }

  private static func keyFilePath() throws -> String {
    let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
    // The crate requires the parent directory to exist; iOS creates the
    // container's Application Support lazily.
    try FileManager.default.createDirectory(at: base, withIntermediateDirectories: true)
    return base.appendingPathComponent("iroh-node.key").path
  }
}
