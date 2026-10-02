// KalsaThermalModule — iOS side of the platform thermal HARD-gate module.
//
// Reads ProcessInfo.processInfo.thermalState and reports it to the JS reader
// (src/engine/platformThermalStatus.ts). Built/registered by Expo autolinking
// once this module is generated with expo-module-scripts (see README). Until
// then the JS reader fails OPEN and the hard gate never engages.

import ExpoModulesCore

private let thermalStateDidChange = "thermalStateDidChange"

/** Bridges ProcessInfo thermalState and observes Apple's thermal notification. */
public class KalsaThermalModule: Module {
  // ExpoModulesCore's Module (= AnyModule & BaseModule) does not inherit
  // NSObject, so @objc members and #selector(self...) observers cannot compile
  // on it — use the block-based NotificationCenter API and keep the returned
  // token for removal on stop/destroy.
  //
  // OnStart/OnStopObserving run on Expo's background AsyncFunctionQueue, while
  // OnDestroy runs from ModuleHolder.deinit on whichever thread releases the
  // last reference; the lock makes the check-and-set on the token race-free.
  private let observerLock = NSLock()
  private var observerToken: NSObjectProtocol?

  public func definition() -> ModuleDefinition {
    Name("KalsaThermal")
    Events(thermalStateDidChange)

    AsyncFunction("getCurrentThermalStateAsync") { () -> [String: Any] in
      self.currentSnapshot()
    }

    // Read first, then register. The initial value cannot be lost between the
    // query and subscription, and the explicit event below covers startup UI.
    OnStartObserving {
      self.startObservingThermalState()
      self.sendEvent(thermalStateDidChange, self.currentSnapshot())
    }

    OnStopObserving {
      self.stopObservingThermalState()
    }

    OnDestroy {
      self.stopObservingThermalState()
    }
  }

  private func startObservingThermalState() {
    observerLock.lock()
    defer { observerLock.unlock() }
    guard observerToken == nil else { return }
    // .main: thermalStateDidChangeNotification posts on the main thread, and
    // sendEvent must not race the JS event emitter off it.
    observerToken = NotificationCenter.default.addObserver(
      forName: ProcessInfo.thermalStateDidChangeNotification,
      object: nil,
      queue: .main
    ) { [weak self] _ in
      guard let self else { return }
      self.sendEvent(thermalStateDidChange, self.currentSnapshot())
    }
  }

  private func stopObservingThermalState() {
    observerLock.lock()
    defer { observerLock.unlock() }
    guard let token = observerToken else { return }
    observerToken = nil
    NotificationCenter.default.removeObserver(token)
  }

  private func currentSnapshot() -> [String: Any] {
    let state = ProcessInfo.processInfo.thermalState
    return [
      "platform": "ios",
      "supported": true,
      "state": thermalStateName(state),
    ]
  }

  private func thermalStateName(_ state: ProcessInfo.ThermalState) -> String {
    switch state {
    case .nominal:
      return "nominal"
    case .fair:
      return "fair"
    case .serious:
      return "serious"
    case .critical:
      return "critical"
    @unknown default:
      return "unknown"
    }
  }
}
