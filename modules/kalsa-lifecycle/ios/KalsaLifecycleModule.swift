// KalsaLifecycleModule — Apple side of the lifecycle bridge: memory pressure
// only. The background-timer half is Android (Handler timers survive Activity
// pause); on iOS, JS timers are sufficient and this module deliberately does
// not re-implement them.
//
// Two capabilities, mirroring the Android bridge where semantically equal:
//   - "trimMemory" event: UIKit's memory-warning notification, reported as
//     level 15 (Android ComponentCallbacks2.TRIM_MEMORY_RUNNING_CRITICAL) —
//     a foreground app told to free memory before the system acts on it.
//   - availableMemoryBytes(): os_proc_available_memory(), the per-app jetsam
//     headroom — the closest iOS analog of Android's MemAvailable read.

import ExpoModulesCore
import UIKit

private let trimMemory = "trimMemory"

public class KalsaLifecycleModule: Module {
  private var observing = false

  public func definition() -> ModuleDefinition {
    Name("KalsaLifecycle")
    Events(trimMemory)

    Function("availableMemoryBytes") { () -> Int64 in
      Int64(os_proc_available_memory())
    }

    OnStartObserving {
      self.startObservingMemoryWarning()
    }

    OnStopObserving {
      self.stopObservingMemoryWarning()
    }

    OnDestroy {
      self.stopObservingMemoryWarning()
    }
  }

  private func startObservingMemoryWarning() {
    guard !observing else { return }
    observing = true
    NotificationCenter.default.addObserver(
      self,
      selector: #selector(self.onMemoryWarning),
      name: UIApplication.didReceiveMemoryWarningNotification,
      object: nil
    )
  }

  private func stopObservingMemoryWarning() {
    guard observing else { return }
    observing = false
    NotificationCenter.default.removeObserver(
      self,
      name: UIApplication.didReceiveMemoryWarningNotification,
      object: nil
    )
  }

  @objc
  private func onMemoryWarning() {
    // 15 = ComponentCallbacks2.TRIM_MEMORY_RUNNING_CRITICAL (see file header).
    sendEvent(trimMemory, ["level": 15])
  }
}
