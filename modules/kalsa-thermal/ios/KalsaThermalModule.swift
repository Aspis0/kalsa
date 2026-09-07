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
  public func definition() -> ModuleDefinition {
    Name("KalsaThermal")
    Events(thermalStateDidChange)

    AsyncFunction("getCurrentThermalStateAsync") { () -> [String: Any] in
      currentSnapshot()
    }

    // Read first, then register. The initial value cannot be lost between the
    // query and subscription, and the explicit event below covers startup UI.
    OnStartObserving {
      let initial = currentSnapshot()
      NotificationCenter.default.addObserver(
        self,
        selector: #selector(self.thermalStateDidChange),
        name: ProcessInfo.thermalStateDidChangeNotification,
        object: nil
      )
      self.sendEvent(thermalStateDidChange, initial)
    }

    OnStopObserving {
      NotificationCenter.default.removeObserver(
        self,
        name: ProcessInfo.thermalStateDidChangeNotification,
        object: nil
      )
    }

    OnDestroy {
      NotificationCenter.default.removeObserver(
        self,
        name: ProcessInfo.thermalStateDidChangeNotification,
        object: nil
      )
    }
  }

  @objc
  private func thermalStateDidChange() {
    sendEvent(thermalStateDidChange, currentSnapshot())
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
