// KalsaLifecycleModule — Apple side of the lifecycle bridge: memory pressure
// only. The background-timer half is Android (Handler timers survive Activity
// pause); on iOS, JS timers are sufficient and this module deliberately does
// not re-implement them. The Android trim-memory event is NOT re-emitted here
// either: UIKit's coarse memory warning is not on the Android trim-level
// scale, and nothing consumed the mapping (level 15 was dead surface).
//
// Single capability, mirroring the Android bridge where semantically equal:
//   - availableMemoryBytes(): os_proc_available_memory(), the per-app jetsam
//     headroom — the closest iOS analog of Android's MemAvailable read.
//     Contract per build target: on device, 0 is a real reading (the app is
//     at/over its limit), crosses to JS unchanged, and JS treats it as zero
//     headroom, not unknown. On the simulator
//     (#if targetEnvironment(simulator) below), a 0 crosses as nil instead —
//     the simulator runs no per-app jetsam budget, so a 0 there carries no
//     information — and JS reads it as null = unknown. The iPad-on-Mac
//     (Designed for iPad) build is NOT covered by that branch
//     (TARGET_OS_SIMULATOR == 0): its 0s still cross unchanged, and what
//     os_proc_available_memory returns there is unmeasured.

import ExpoModulesCore
import os

public class KalsaLifecycleModule: Module {
  public func definition() -> ModuleDefinition {
    Name("KalsaLifecycle")

    Function("availableMemoryBytes") { () -> Int64? in
      // iOS 13+; this pod's 16.4 deployment floor covers it. The symbol is
      // unavailable on macOS/Catalyst, which this iOS-only pod does not target.
      let bytes = Int64(os_proc_available_memory())
      // Simulator-only fallback: the simulator does not run the per-app jetsam
      // budget, and os_proc_available_memory reads 0 there regardless of the
      // host's real headroom — which fail-closed every model load
      // (blocked_ram, "Not running here" pill). 0 stays a REAL reading on
      // hardware; targetEnvironment(simulator) compiles this branch out of
      // device builds. nil crosses to JS as null = "no platform read".
      #if targetEnvironment(simulator)
      if bytes == 0 { return nil }
      #endif
      return bytes
    }
  }
}
