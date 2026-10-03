// KalsaIrohModule — the iroh road's Apple bridge: one bridge object holding
// the node identity, tunnels handed to JS by number. Mirror of the Android
// module (expo.modules.kalsairoh.KalsaIrohModule): same method names, the
// same KALSA_IROH_* rejection codes, the same deadlines, and the same
// shutdown semantics — a shut-down or timed-out tunnel is closed for real.
//
// Every native call blocks on purpose — the crate's API is blocking and
// bounded by per-call deadlines — so calls are threaded like the Kotlin
// module: reads and writes (which park up to their deadline) each get a
// dedicated Thread, short control calls share a concurrent queue; never
// the JS thread, and never a Swift-concurrency thread the crate could
// mistake for a runtime context.
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
  // Mirror of the Kotlin module's two pools (Kotlin module .kt:44-45), in
  // GCD terms. Control calls (start, node id, open, shutdown) are short and
  // must stay responsive during teardown, so one 10 s dial must not block
  // the others: control is concurrent (GCD has no fixed-width pool, and the
  // width is not load-bearing for short, self-bounded calls). Reads and
  // writes park up to their deadline, so each gets a dedicated Thread like
  // Kotlin's unbounded cached pool: a concurrent queue would run parks on
  // libdispatch's shared worker pool, which is capped and shared, so a
  // burst of parked reads could queue and starve control calls.
  private let control = DispatchQueue(
    label: "app.kalsa.iroh.control", attributes: .concurrent)

  private func park(_ call: @escaping () -> Void) {
    let thread = Thread(block: call)
    thread.name = "app.kalsa.iroh.parking"
    // The crate's block_on stacks want more than the 512 KB
    // secondary-thread default.
    thread.stackSize = 1 << 20
    thread.start()
  }

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
      park {
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
      park {
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
      park {
        for tunnel in open {
          tunnel.shutdown()
        }
        // Released here: the crate's bounded runtime shutdown runs on a
        // parked thread, never the JS thread.
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
    let keyPath = try Self.keyFilePath()
    let started = try MobileBridge(keyPath: keyPath)
    // The key now exists (the crate loads-or-mints it atomically): mark it.
    try Self.markPrivate(URL(fileURLWithPath: keyPath))
    lock.lock()
    if destroyed {
      lock.unlock()
      // OnDestroy raced the start: never install the fresh bridge — its
      // runtime shutdown runs on a parked thread and the call rejects,
      // like the openTunnel race below.
      park { _ = started }
      throw IrohCallError(message: "the module is destroyed")
    }
    let previous = bridge
    bridge = started
    lock.unlock()
    if let previous {
      // Drop the replaced bridge outside the queues: its runtime shutdown
      // is bounded but not instant, and no caller is waiting on it.
      park { _ = previous }
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
    let code = Self.rejectionCode(error)
    if code == "KALSA_IROH_OTHER" {
      // One triage line for the unexpected bucket, like the Kotlin
      // module's Log.w. Safe to log: crate errors carry io::Error text
      // only — never key bytes or paths — and read/write payloads never
      // become messages.
      print("[KalsaIroh] \(code): \(message)")
    }
    promise.reject(code, message)
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
    case nil: break
    }
    // The uniffi machinery's own failures — stale handle, unknown enum
    // case, a Rust panic crossing the FFI (UniffiInternalError, private
    // inside the generated bindings, hence the type-name check) — mean the
    // compiled bindings and the native library disagree: the iOS analog of
    // the Kotlin module's `is LinkageError` arm.
    if String(describing: type(of: error)) == "UniffiInternalError" {
      return "KALSA_IROH_LINKAGE"
    }
    return "KALSA_IROH_OTHER"
  }

  /// JS numbers arrive as Double; a malformed handle must land in the
  /// "no tunnel <n>" rejection exactly like Kotlin's `id.toLong()` — NaN
  /// becomes 0, out-of-range saturates — never in a checked-conversion
  /// process kill.
  private static func handle(_ id: Double) -> Int64 {
    if id.isNaN { return 0 }
    if id >= Double(Int64.max) { return Int64.max }
    if id <= Double(Int64.min) { return Int64.min }
    return Int64(id)
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
    // container's Application Support lazily. Only a directory we create is
    // marked private: a pre-existing one is not ours to exclude wholesale.
    let created = !FileManager.default.fileExists(atPath: base.path)
    try FileManager.default.createDirectory(at: base, withIntermediateDirectories: true)
    if created {
      try markPrivate(base)
    }
    return base.appendingPathComponent("iroh-node.key").path
  }

  // The key is the node's permanent private identity: never in device
  // backups (Android pins the same policy with allowBackup: false) and
  // unreadable until first unlock. A directory's protection class is
  // inherited by the files the crate writes inside it; the key file gets
  // both attributes again in startBridge, once the crate has created it.
  // 0600 and the crate's atomic temp-file rename are untouched.
  private static func markPrivate(_ url: URL) throws {
    var values = URLResourceValues()
    values.isExcludedFromBackup = true
    var marked = url
    try marked.setResourceValues(values)
    try FileManager.default.setAttributes(
      [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication],
      ofItemAtPath: url.path)
  }
}
