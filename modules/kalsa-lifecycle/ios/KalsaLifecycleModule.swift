// KalsaLifecycleModule — Apple side of the lifecycle bridge: memory pressure
// only. The background-timer half is Android (Handler timers survive Activity
// pause); on iOS, JS timers are sufficient and this module deliberately does
// not re-implement them. The Android trim-memory event is NOT re-emitted here
// either: UIKit's coarse memory warning is not on the Android trim-level
// scale, and nothing consumed the mapping (level 15 was dead surface).
//
// Single capability, mirroring the Android bridge where semantically equal:
//   - availableMemoryBytes(): os_proc_available_memory(), the per-app jetsam
//     headroom — the closest iOS analog of Android's MemAvailable read. 0 is
//     a real reading (the app is at/over its limit) and crosses to JS
//     unchanged; JS treats it as zero headroom, not unknown.

import ExpoModulesCore
import os

public class KalsaLifecycleModule: Module {
  public func definition() -> ModuleDefinition {
    Name("KalsaLifecycle")

    Function("availableMemoryBytes") { () -> Int64 in
      // iOS 13+; this pod's 16.4 deployment floor covers it. The symbol is
      // unavailable on macOS/Catalyst, which this iOS-only pod does not target.
      Int64(os_proc_available_memory())
    }
  }
}
