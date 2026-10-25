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
//     Contract per build target: on iPhone/iPad hardware, 0 is a real reading
//     (the app is at/over its limit), crosses to JS unchanged, and JS treats
//     it as zero headroom, not unknown. Where there is no iOS per-app limit
//     for the value to be relative to — the simulator, and a Mac host running
//     the iPad build (ProcessInfo.isiOSAppOnMac) — a 0 crosses as nil instead
//     and JS reads it as null = unknown; Apple marks os_proc_available_memory
//     unavailable on macOS
//     (https://developer.apple.com/documentation/os/os_proc_available_memory).

import ExpoModulesCore
import os

public class KalsaLifecycleModule: Module {
  public func definition() -> ModuleDefinition {
    Name("KalsaLifecycle")

    Function("availableMemoryBytes") { () -> Int64? in
      // iOS 13+; this pod's 16.4 deployment floor covers it. The symbol is
      // unavailable on macOS/Catalyst, which this iOS-only pod does not target.
      let bytes = Int64(os_proc_available_memory())
      // 0 stays a REAL reading on iPhone/iPad hardware. The simulator reads 0
      // regardless of the host's headroom, and a Mac host has no iOS per-app
      // limit for the value to be relative to (Apple marks the function
      // unavailable on macOS): there a 0 must cross as nil = "no platform
      // read", not as zero headroom that fail-closed every model load
      // (blocked_ram, "Not running here" pill).
      #if targetEnvironment(simulator)
      if bytes == 0 { return nil }
      #else
      if bytes == 0 && ProcessInfo.processInfo.isiOSAppOnMac { return nil }
      #endif
      return bytes
    }
  }
}
