# HyperOS RAM recon — reclaiming a Xiaomi 14 for a large foreground compute workload

**Device under test (lab):** Xiaomi 14 (`houji`), official 12 GB LPDDR5X (user-observed ~11.4 GB `MemTotal`), HyperOS on Android 16, UFS 4.0.
**Workload:** `bmoe-cli` via adb / Termux-class shell. 12.5 GiB mmap model + ~2 GiB KV cache + ~1.7 GiB anonymous dense. Became swap-bound: 1–5 major faults/token, decode ~0.35 t/s vs expected 5–7 t/s, ~6 GB `MemAvailable`.
**Control:** Samsung S23, 8 GB physical, same config, fine.

**Date:** 2026-08-13.
**Scope:** what HyperOS actually does with RAM/swap, which knobs are real on stock (no root), and what a native foreground compute process can do about it.

Source labels used below:

- **[primary]** Xiaomi official docs, AOSP, Linux kernel, firmware `build.prop` dumps, AOSP Java.
- **[github]** public source / issue tracker (treat as evidence, not Xiaomi documentation).
- **[anecdotal]** XDA / Reddit / Xiaomi.eu / blogs. Useful for UI paths and “does this actually change anything”, not for kernel semantics.

Every actionable claim has a URL and the HyperOS / Android generation it applies to.

---

## 0. What is actually going wrong

Android’s own memory model is: **free RAM is wasted RAM**. The kernel swap daemon (`kswapd`) reclaims clean file pages and compresses dirty anonymous pages into **zRAM** (compressed RAM, not flash). If that is not enough, userspace `lmkd` kills processes using PSI (pressure-stall information). Official AOSP documentation is explicit that **Android does not use storage as swap**, because flash wear is real:

- https://developer.android.com/topic/performance/memory-management
  (AOSP / all modern Android; last updated 2026-07-22)
- https://source.android.com/docs/core/perf/lmkd
  (AOSP, Android 10+ PSI mode)

Xiaomi (and Samsung, Vivo, …) then added a **vendor layer on top of zRAM**: a flash-backed writeback device marketed as “Memory Extension” / “RAM Plus”. Wikipedia’s zram page names the OEM brands explicitly:

- https://en.wikipedia.org/wiki/Zram
  (encyclopedia; names Xiaomi “Memory Extension”, Samsung “RAM Plus”)

That vendor layer is the most plausible explanation for **major faults at 1–5/token**. A major fault from in-RAM zRAM is a decompress (microseconds). A major fault from a UFS-backed writeback page is a storage I/O (milliseconds). Decode at 0.35 t/s with 1–5 major faults/token is the flash-swap signature, not “the 12.5 GiB mmap is too big” (mmap of a clean file is page-cache; those faults would be file I/O on first touch, not a steady per-token tax on already-warm weights).

The ~6 GB `MemAvailable` on an 11.4 GB device is the other half: HyperOS keeps a large working set of system + compressed zRAM + file cache. Disabling Memory Extension will **not** magically turn those 6 GB into 10 GB. It can stop the OS from **evicting our anonymous dense region onto flash**.

Samsung One UI on an 8 GB S23 leaving more usable RAM for the same config is consistent with (a) a smaller HyperOS-class always-resident set and (b) RAM Plus being less aggressive or already off. It is **not** evidence that Xiaomi 14 has less physical DRAM.

Official Xiaomi 14 RAM: **12 GB LPDDR5X + UFS 4.0**, HyperOS. Shipped on HyperOS 1 / Android 14; current line is HyperOS 3 / Android 16.

- https://www.mi.com/global/product/xiaomi-14/specs/  **[primary]**
- https://en.wikipedia.org/wiki/Xiaomi_14  (OS lineage)

---

## 1. HyperOS “Memory extension” (virtual RAM / zram-on-flash)

### 1.1 What it does, exactly

Xiaomi’s own support article (KA-12358, still linked from current UK/SA support) states they implemented **“an external RAM function based on the Linux kernel’s native ZRAM”**, enabled at `Settings > Additional settings > Memory extension`. Enabling requires ~10 % free storage.

- https://www.mi.com/uk/support/article/KA-12358/  **[primary]** (Xiaomi Support; applies MIUI 12.5+ through HyperOS 1.x/2.x — the same Settings path is republished for HyperOS devices)
- https://www.mi.com/global/support/faq/details/KA-503400/  **[primary]** (Xiaomi 14T FAQ, HyperOS): Settings → Additional settings → Memory extension → pick a size → Reboot
- https://www.mi.com/global/support/faq/details/KA-497452/  **[primary]** (Redmi 13C, HyperOS): same path, plus an alternate path Settings → About phone → Storage → System files → Memory extension
- https://www.allabouthyperos.com/2025/04/hyperos-how-to-enable-or-disable-ram.html  **[anecdotal]** (HyperOS 1/2 UI walkthrough: Off / size picker, reboot)

Kernel mechanism this maps onto: **zRAM writeback**. zRAM is a compressed block device in RAM used as swap. With `CONFIG_ZRAM_WRITEBACK`, idle or incompressible compressed pages can be evicted from RAM onto a **backing device** (a file/loop on `/data`). Subsequent access is a **major fault from flash**.

- https://docs.kernel.org/admin-guide/blockdev/zram.html  **[primary]** (`backing_dev`, `idle`, `writeback`, `bd_stat`)
- AOSP later productized the same idea as `mmd` (Android 17+). Xiaomi shipped a vendor version years earlier. https://source.android.com/docs/core/perf/mmd  **[primary]** (Android 17+; **not** the daemon on our Android 16 device, but the semantics of writeback/recompression/idle age are the same kernel feature)

Firmware property names confirm “backing device”, not “extra DRAM”:

```
persist.miui.extm.enable=1
persist.miui.extm.version=3.0
persist.miui.extm.bdsize=<size in MiB>
```

Seen in HyperOS 1 / MIUI V816 `product.prop` dumps (e.g. Redmi `sapphire` / generic `missi_phone_global`):

- https://github.com/kibria5/device_xiaomi_sapphire_dump/blob/main/product.prop  **[github]** (HyperOS 1 / V816)
- https://gitlab.taiao.ai/fw-dumps/redmi/mivendor/-/blob/missi_phone_global-user-14-UKQ1.231207.002-V816.0.3.0.UNGMIXM-release-keys/product/etc/build.prop  **[github]** (same generation)

`bdsize` is the size of the writeback file. Xiaomi.eu users with **root** change it via:

```
su -c resetprop persist.miui.extm.bdsize 4096
```

- https://xiaomi.eu/community/threads/increase-memory-ram-extension-limit.65312/  **[anecdotal]** (MIUI 12.5 / 13; **requires root**; oversizing bootlooped a test device)

On-disk artefact (MIUI 13 investigation, still the only public filesystem-level look):

- File created at boot: `/data/extm/extm_file`, size = the UI picker (2 / 3 / 5 / … GB).
- Disabling Memory Extension **deletes** that file.
- One investigator found the file’s mtime/checksum did not change under short app-switching load (they concluded “gimmick”). A reply correctly identified it as **zram writeback**, which is touched on idle/long timescales, not on every app switch.

- https://www.reddit.com/r/PocoPhones/comments/151kr8d/why_do_my_phone_still_use_zram_even_though_i/  **[anecdotal]** (MIUI 13 / Poco X4 GT, 2023)

**ZRAM itself is independent of Memory Extension.** Turning the UI off does **not** remove `/dev/zram0` or zero `dumpsys meminfo`’s `ZRAM:` line. zRAM has been in Android since KitKat; only root can resize/disable it.

- Same Reddit thread (comment by KerneI-Panic). **[anecdotal]**
- Confirmed by HyperOS users who set Memory Extension = Off and still see multi-GB `ZRAM:` in `dumpsys meminfo`, and by people who tried `settings put global zram_enabled 0` with no effect:
  - https://linustechtips.com/topic/1627978-help-created-persistent-zramswap-via-termux-non-root-on-xiaomi-11t-and-cannot-remove-it-memory-extension-is-off/  **[anecdotal]** (HyperOS, Xiaomi 11T, 2025)
  - https://xiaomi.eu/community/threads/hyperos-1-0-stable-release.71170/page-180  **[anecdotal]** (HyperOS 1: “disabled Memory extension and ZRAM is still present”)

Companion firmware knobs that sit next to extm (same V816 `product.prop`; HyperOS 1, likely carried into 2.x/3.x):

| Property | Typical value | Role |
|---|---|---|
| `persist.lm.em.flush_zram_usedrate` | `30` | flush zRAM when used-rate crosses 30 % |
| `persist.lm.em.per_flush_quota_high/medium/low` | 8000 / 12000 / 20000 | per-flush quotas |
| `persist.sys.mms.compact_enable` | `true` | Xiaomi compact-on-reclaim |
| `persist.sys.use_boot_compact` | `true` | compact at boot |
| `persist.sys.mmms.switch` | `true` | Xiaomi MMMS on |
| `persist.sys.mmms.reclaim_switch` | `0` | extra reclaim path off by default |
| `persist.sys.spc.enabled` | `true` | Smart Process Control (see §2) |

Source: same `product.prop` dump as above.

### 1.2 How to disable it

**Settings UI (stock, no root) — this is the supported path.**

1. Settings → **Additional settings** → **Memory extension**.
2. Select **Off**.
3. Reboot when prompted.

Applies to: MIUI 12.5+, HyperOS 1.x, HyperOS 2.x. Confirmed on Xiaomi 14-series siblings (14T official FAQ) and HyperOS 2/3 community walkthroughs. On some HyperOS builds a second entry exists under About phone → Storage → System files.

- https://www.mi.com/global/support/faq/details/KA-503400/  **[primary]** (HyperOS, Xiaomi 14T)
- https://www.allabouthyperos.com/2025/04/hyperos-how-to-enable-or-disable-ram.html  **[anecdotal]** (HyperOS)

**adb-settable property**

| Action | Command | Root? | Generation |
|---|---|---|---|
| **Read** current flags | `adb shell getprop persist.miui.extm.enable` ; `getprop persist.miui.extm.bdsize` ; `getprop persist.miui.extm.version` | no | MIUI 12.5+ / HyperOS 1+ |
| **Write** enable/size | `resetprop persist.miui.extm.enable 0` then reboot | **yes** | same |
| **Write** via `settings put` | **no documented key**. `settings put global zram_enabled 0` is an AOSP leftover and does **not** turn off Xiaomi extm or vendor zRAM | n/a | HyperOS 1–3 **[anecdotal]** |

There is **no** public, non-root `settings put global/secure/system …` that toggles Memory Extension. Samsung One UI has `settings put global ram_expand_size_list …` for RAM Plus; Xiaomi does not publish an equivalent.

- Samsung (for contrast only): https://techwiser.com/how-to-disable-ram-plus-on-samsung-galaxy-phones-and-why-you-should/  **[anecdotal]**
- Xiaomi `zram_enabled 0` failure: LTT thread above. **[anecdotal]**

`getprop` of `persist.*` is readable by the shell uid. `setprop persist.*` from unprivileged `adb shell` is typically ignored or reset; Magisk `resetprop` is what Xiaomi.eu actually uses.

### 1.3 Does disabling it increase `MemAvailable`, or only reduce swap thrash?

**Mostly the second. Do not expect +4 GB `MemAvailable`.**

Why:

1. Memory Extension is a **writeback backing file**, not a reservation of DRAM. Turning it off deletes `/data/extm/extm_file`. It does not un-carve physical RAM.
2. **zRAM stays**. Compressed anonymous pages still occupy a slice of DRAM (`mem_used_total` in `/sys/block/zram0/mm_stat`). `dumpsys meminfo` will still show a multi-GB `ZRAM:` line. That compressed store is counted against the system, not against `MemAvailable` as free RAM.
3. What **does** change: idle/incompressible pages can no longer be evicted to UFS. For a large **hot** anonymous working set (our ~1.7 GiB dense + ~2 GiB cache), that is the difference between “kswapd compresses then writebacks, every token takes a UFS major fault” and “kswapd can only compress into zRAM or steal file cache”.

So the lab prediction:

| After Memory Extension = Off + reboot | Expected |
|---|---|
| `MemAvailable` | ≈ unchanged (± a few hundred MB from less writeback metadata / slightly different kswapd behaviour) |
| `dumpsys meminfo` `ZRAM:` total | still present (vendor zRAM) |
| `/data/extm/extm_file` | gone |
| `/sys/block/zram0/bd_stat` `bd_count` / `bd_reads` | stop growing (or node missing) |
| major faults/token on the dense/cache region | **should drop sharply** if they were flash writeback; stay high if they are in-RAM zRAM decompress |
| decode t/s | should recover toward 5–7 **if** the bound was flash-swap; will not, if the bound is “only 6 GB `MemAvailable` and the 2+1.7 GiB working set does not fit” |

If after disable you still see 1–5 major faults/token **and** `bd_stat` is idle, the remaining faults are zRAM (in-RAM) or file-cache refaults of the mmap. That is a **sizing** problem, not a toggle problem — see § product recommendation.

AOSP’s own later `mmd` docs are useful as a sanity check: writeback is for **idle** pages (default idle age 20–25 hours on AOSP 17). Xiaomi’s vendor policy is unpublished and, given our 0.35 t/s, appears far more aggressive than AOSP’s “20 hours idle” default — or kswapd is simply swapping the hot anon set into zRAM so hard that writeback of “idle” slots includes pages we are about to touch again.

- https://source.android.com/docs/core/perf/mmd  **[primary]** (AOSP 17+ defaults; HyperOS 1/2/3 vendor policy is **not** documented)

---

## 2. HyperOS background / memory-reclaim daemons

HyperOS inherits the MIUI stack. None of this is documented by Xiaomi as an API. What follows is reconstructed from firmware properties, AOSP counterparts, and community observation.

### 2.1 The daemons / services

| Component | What it is | Evidence | Applies to |
|---|---|---|---|
| **extm** (`persist.miui.extm.*`) | Memory Extension / zRAM writeback | firmware props + Xiaomi FAQ | MIUI 12.5+ / HyperOS 1–3 |
| **SPC** (`persist.sys.spc.enabled=true`, `persist.sys.spc.mi_extra_free_enable`, `persist.sys.spc.extra_free_kbytes`) | “Smart Process Control”. Raises `extra_free_kbytes`-class watermarks so `kswapd` starts reclaiming earlier. Also process-restart / bind-visible flags | HyperOS 1 `product.prop` | HyperOS 1+ |
| **MMMS** (`persist.sys.mmms.switch=true`, `persist.sys.mmms.reclaim_switch=0`, `persist.sys.mmms.lowmem.reclaim.memavailable.thread=524288`) | Xiaomi memory-management service. Watermarks in kB of `MemAvailable`. `reclaim_switch=0` in shipping builds | same dump; also appears in VS/adb `getprop` captures | HyperOS 1+ |
| **MMS compact** (`persist.sys.mms.compact_enable=true`, `persist.sys.use_boot_compact=true`, `persist.sys.mms.bg_apps_limit`, `persist.sys.mms.cache_limit`) | Periodic / boot compaction of cached apps (AOSP `CachedAppOptimizer` analogue) | same dump | HyperOS 1+ |
| **millet** (`persist.sys.millet.handshake=true`, `persist.sys.millet.newversion=true`, `persist.sys.powmillet.enable`, `persist.sys.brightmillet.enable`) | Xiaomi freezer / binder handshake with `system_server`. Freezes cached apps | same dump | MIUI 13+ / HyperOS |
| **PowerKeeper** `com.miui.powerkeeper` | Battery & Performance. Kills background apps, applies per-app battery restrictions | dontkillmyapp; XDA | MIUI / HyperOS all |
| **MIUI Daemon** `com.miui.daemon` | “System Daemon”. Community reports: uninstalling it **raises** idle RAM (it was killing cached apps). Not a safe uninstall | XDA HyperOS thread | MIUI / HyperOS |
| **AOSP `lmkd`** | PSI-based process killer | AOSP | Android 10+ (so HyperOS 1–3) |
| **AOSP `CachedAppOptimizer`** | compact / freeze cached apps; `am compact`, `am freeze` | AOSP `ActivityManagerShellCommand` | Android 12+ |
| **AOSP `mmd`** | central zRAM writeback / recompress | AOSP | **Android 17+ only** — not on our Android 16 Xiaomi 14 unless Xiaomi backported it under another name (extm/MMMS is that backport) |
| **AOSP Memory Limiter** | cgroup v2 `memory.high` / `memory.swap.max` per app | AOSP | **Android 17+ only**, UID ≥ 10000 |

Sources:

- Firmware: https://github.com/kibria5/device_xiaomi_sapphire_dump/blob/main/product.prop  **[github]** (HyperOS 1)
- `getprop` capture showing the same keys live: https://developercommunity.visualstudio.com/t/ADB-GetProps-Parsing-Regression-in-VS-20/10490234  **[github-adjacent]** (readable without root)
- PowerKeeper / daemon: https://dontkillmyapp.com/xiaomi  **[primary-for-vendors]** (Urbandroid; MIUI 10–14, still the best HyperOS-adjacent user map)
- PowerKeeper risk: https://github.com/0x192/universal-android-debloater/issues/913  **[github]** — **do not uninstall `com.miui.powerkeeper`** (bootloop reports). Disable-user is also risky.
- Daemon RAM observation: https://xdaforums.com/t/what-is-system-daemon-permissions-setting-in-hyperos.4742642/  **[anecdotal]** (HyperOS, Xiaomi 14T Pro: removing daemon doubled idle RAM use)
- AOSP: https://source.android.com/docs/core/perf/lmkd ; https://source.android.com/docs/core/perf/mmd ; https://source.android.com/docs/core/perf/memory-limiter
- `am compact` / `am freeze` / `am memory-factor`: https://android.googlesource.com/platform/frameworks/base/+/master/services/core/java/com/android/server/am/ActivityManagerShellCommand.java  **[primary]**

### 2.2 Known toggles

#### Settings UI

| Toggle | Path (HyperOS 1/2/3; names drift) | What it actually does | Affects adb-shell native? | Affects Termux app uid? |
|---|---|---|---|---|
| **Memory extension** | Settings → Additional settings → Memory extension → Off | delete writeback file, reboot | **yes** (system-wide kswapd/writeback) | yes |
| **MIUI / system optimization** | Settings → Additional settings → Developer options → “Turn on system optimization” / “MIUI optimization” → Off | mixed bag: notification behaviour, recents, some memory policy. Community treats it as “less aggressive MIUI”. Can break UI theming | **unclear / weak** for kswapd | maybe |
| **Lock in recents** | Recents → long-press / drag down → padlock | exempts that **task** from “clear all” and some PowerKeeper kills | **no** (shell has no recents card) | **yes** |
| **Lock apps** (Security) | Security → Boost speed → gear → Lock apps | same idea, persisted | **no** | **yes** |
| **Autostart** | Settings → Apps → {app} → App permissions → Background autostart  *or* Security → Permissions → Autostart | allows the **app** to restart after kill | **no** | **yes** (keep Termux alive) |
| **Battery: No restrictions** | Settings → Apps → {app} → Battery saver → No restrictions  *or* Security → Battery → App battery saver → No restrictions | PowerKeeper stops restricting that package | **no** | **yes** |
| **Power plan** | Settings → Battery & performance → Performance (names vary) | less background killing, more heat | system-wide, weak | weak |
| **Boost speed / Ultra battery saver** | Security → Boost speed | will slaughter anything not locked | n/a (don’t turn this on during a run) | kills Termux unless locked |

- https://dontkillmyapp.com/xiaomi  **[primary-for-vendors]** (MIUI 10–14; HyperOS kept the same three levers: lock / autostart / no-restrictions)
- Developer-options MIUI optimization: https://codekk.com/new-second/close-miui-optimization  **[anecdotal]** (HyperOS path: Additional settings → Developer options)

#### adb `settings put` / `setprop` (no root)

Readable without root (do this first on the Xiaomi 14):

```
adb shell getprop persist.miui.extm.enable
adb shell getprop persist.miui.extm.bdsize
adb shell getprop persist.miui.extm.version
adb shell getprop persist.sys.spc.enabled
adb shell getprop persist.sys.spc.mi_extra_free_enable
adb shell getprop persist.sys.mmms.switch
adb shell getprop persist.sys.mmms.reclaim_switch
adb shell getprop persist.sys.mms.compact_enable
adb shell getprop persist.sys.millet.newversion
adb shell settings get global zram_enabled
adb shell settings get secure miui_optimization
```

Writable without root, **with caveats**:

- `settings put` to `global` / `secure` / `system` on HyperOS often requires **USB debugging (Security settings)** plus a Xiaomi account. Documented by tweakradje for HyperOS 3:
  - https://sites.google.com/site/tweakradje/xiaomi-hyperos-3-tweaking  **[anecdotal]** (HyperOS 3 / Android 16 — **our generation**)
- Even then, the keys that exist are AOSP-ish (`zram_enabled`, `cached_apps_freezer`, `miui_optimization`). **None of them is documented to disable extm or SPC.**
- `setprop persist.sys.spc.enabled false` / `setprop persist.miui.extm.enable 0` from unprivileged shell: usually a no-op (property service rejects or the value does not persist). Needs `resetprop` (root).

AOSP knobs that **are** intended to be flipped from `adb shell` (permission `android.permission.SET_ACTIVITY_WATCHER` / shell):

```
adb shell am memory-factor set NORMAL     # override AM's memory-pressure factor
adb shell am memory-factor reset
adb shell am compact native full <pid>    # compact one native pid
adb shell am compact system
adb shell am kill-all                     # kill cached apps (useful to free RAM before a run)
```

- https://android.googlesource.com/platform/frameworks/base/+/master/services/core/java/com/android/server/am/ActivityManagerShellCommand.java  **[primary]** (`memory-factor` subcommands: `set NORMAL|MODERATE|LOW|CRITICAL`, plus `reset` / `get` in help text)
- CTS usage: https://android.googlesource.com/platform/cts/+/master/tests/app/src/android/app/cts/ActivityManagerProcessStateTest.java  **[primary]**

`am memory-factor set NORMAL` tells ActivityManager “the device is not under memory pressure”, which **suppresses trim/kill escalation**. It does **not** change `vm.swappiness` and will not stop `kswapd` from swapping our anon pages. Useful as a “don’t also kill Termux / don’t compact us” belt; not a swap fix.

### 2.3 Per-app exemptions vs a native process

This is the question that actually matters for `bmoe-cli`.

| Lever | `adb shell` native (uid `2000` / `AID_SHELL`) | Termux / F-Droid Termux (app uid ≥ 10000) |
|---|---|---|
| Recents lock | no card → no effect | **does** keep the Termux activity from being cleared |
| Autostart | n/a | **does** let Termux restart after a kill; does **not** stop swap |
| Battery “No restrictions” | n/a | **does** stop PowerKeeper from SIGKILLing Termux when the screen is off |
| PowerKeeper / millet freeze | **not targeted as an app**. Shell is a system uid. millet/PowerKeeper package lists don’t include uid 2000 | **is** targeted once the Termux activity is cached |
| SPC / MMMS watermarks / extm writeback / zRAM / `kswapd` | **yes, system-wide**. Our anon pages are just anon pages | same |
| `lmkd` PSI kills | possible at CRITICAL (`ro.lmk.critical=0` means any process). In practice shell oom_adj is low (native / persistent-ish) so we are killed late | Termux in background has high oom_adj → killed early unless locked + foreground |
| AOSP Memory Limiter (Android 17+) | **exempt** (only UID ≥ 10000) | would apply. **Not on our Android 16 device** unless Xiaomi backported it |

- Memory Limiter scope: https://source.android.com/docs/core/perf/memory-limiter  **[primary]** (Android 17+; “monitors app processes (UID >= 10000) by default. System processes are generally exempt.”)
- LMK score ladder (foreground last): https://developer.android.com/topic/performance/memory-management  **[primary]**

**Practical consequence for this lab:**

- If `bmoe-cli` is launched as `adb shell /data/local/tmp/bmoe-cli …`, **none** of the Xiaomi per-app UI (lock / autostart / no-restrictions) applies. Only system-wide knobs (Memory Extension, Developer optimization, `am memory-factor`, killing cached apps before the run) matter.
- If it is launched **inside Termux**, treat Termux as a normal MIUI-hated app: Lock + Autostart + No restrictions + keep the session in the foreground (screen on, or a wakelock). That prevents **kills**, not **swap**.
- In both cases the anon dense region is still swappable by `kswapd`. Per-app exemptions do not pin pages.

---

## 3. Swappiness / zRAM via adb (no root)

### 3.1 What is readable on stock HyperOS

All of the following are world-readable on AOSP and on HyperOS (shell uid):

```
# physical + reclaim picture
cat /proc/meminfo                  # MemTotal, MemAvailable, SwapTotal, SwapFree, AnonPages, …
grep -E 'nr_free|nr_inactive|nr_active|pgmajfault|pswpin|pswpout' /proc/vmstat

# kswapd personality
cat /proc/sys/vm/swappiness
cat /proc/sys/vm/extra_free_kbytes        # may 404; SPC may have its own
cat /proc/sys/vm/watermark_scale_factor   # may 404
cat /proc/sys/vm/vfs_cache_pressure

# zRAM (may be zram0 only)
cat /sys/block/zram0/disksize
cat /sys/block/zram0/comp_algorithm
cat /sys/block/zram0/mm_stat          # orig, compr, mem_used_total, …
cat /sys/block/zram0/bd_stat          # writeback backing-device stats; 0/missing if extm off
cat /sys/block/zram0/backing_dev      # often permission denied, try anyway
cat /proc/swaps

# Android view
dumpsys meminfo | head -n 40          # header has "ZRAM:" total swap
dumpsys meminfo <pid>                 # per-process Swapped Dirty / PSS
getprop | grep -E 'extm|zram|lmk|mmms|spc|millet|mmd'

# lmkd / PSI (Android 10+)
getprop ro.lmk.use_psi
getprop ro.lmk.swap_free_low_percentage
getprop ro.config.low_ram
cat /proc/<pid>/oom_score_adj
```

- zRAM sysfs: https://docs.kernel.org/admin-guide/blockdev/zram.html  **[primary]**
- `dumpsys meminfo`: https://developer.android.com/tools/dumpsys#meminfo  **[primary]**
- `MemAvailable` definition (kernel): accounts for free + reclaimable file/slab, **minus** watermarks. It is the right number for “will this working set fit”. It is **not** `MemFree`.

### 3.2 What is settable without root

| Knob | Read | Write from `adb shell` | Effect if it worked |
|---|---|---|---|
| `/proc/sys/vm/swappiness` | yes | **no** (`EACCES`). Needs `CAP_SYS_ADMIN` / root | 0–200; Android often ships 60 or 100. Lower = keep anon, steal file cache instead |
| `/sys/block/zram0/disksize` | yes | **no** (EBUSY once initialized; also permission) | zRAM capacity |
| `/sys/block/zram0/reset`, `backing_dev`, `writeback`, `idle` | sometimes | **no** | would disable writeback |
| `settings put global zram_enabled 0` | key may exist | yes (with Security settings) | **does not** disable HyperOS zRAM / extm **[anecdotal, HyperOS]** |
| `am memory-factor set NORMAL` | n/a | **yes** (shell) | AM pressure only |
| `am compact` / `am kill-all` | n/a | **yes** | free cached-app RAM before a run |
| `cmd activity memory-factor …` | alias of `am` on some builds | yes | same |
| `persist.miui.extm.enable` | `getprop` yes | `setprop` no / `resetprop` yes | Memory Extension |
| `persist.sys.spc.enabled` / `mmms.reclaim_switch` | `getprop` yes | root | watermarks / extra reclaim |

**`echo 0 > /proc/sys/vm/swappiness` is blocked on stock.** That is standard Android SELinux + uid 2000, not a HyperOS special. Same for writing any `/proc/sys/vm/*` and `/sys/block/zram0/*` that change policy.

AOSP `zram_enabled` (Settings.Global) is consumed by some AOSP init/scripts and by tweak lists (tweakradje even *sets it to 1*). On HyperOS the vendor init owns zRAM; flipping the Settings key is cargo-cult.

- https://sites.google.com/site/tweakradje/xiaomi-hyperos-3-tweaking  **[anecdotal]** (`settings put global zram_enabled 1` listed among HyperOS 3 tweaks — i.e. they treat it as an AOSP switch, not as Memory Extension)

### 3.3 `dumpsys` / `am` knobs worth using

Before every lab run (no root):

```
adb shell am kill-all
adb shell am memory-factor set NORMAL
adb shell dumpsys meminfo | head -n 40
adb shell cat /proc/meminfo
```

`am kill-all` drops cached apps and is the one no-root action that can move `MemAvailable` by hundreds of MB to a couple of GB, depending on how much junk HyperOS was holding. It will **not** drop system_server, persistent apps, or zRAM contents already compressed.

`am memory-factor` values (AOSP `ProcessStats`):

- `NORMAL` — no extra trim
- `MODERATE` / `LOW` / `CRITICAL` — escalating `onTrimMemory` / kill eligibility

Forcing `NORMAL` for the duration of a decode run is cheap insurance. Reset after:

```
adb shell am memory-factor reset
```

There is **no** `am` subcommand that sets swappiness or disables writeback.

---

## 4. `mlock` / `madvise` from a native process

### 4.1 Would `mlock` of the anon dense region prevent swap-out?

**Yes, if it succeeds.** `mlock`/`mlock2(MLOCK_ONFAULT)` pins pages in RAM; `kswapd` will not swap them. That is exactly why llama.cpp has `--mlock`.

### 4.2 Is it permitted without root on HyperOS?

**Not for 1.7 GiB.** Android’s unprivileged `RLIMIT_MEMLOCK` is **64 KiB** (the historical Linux default, enforced in AOSP tests). Raising it requires `CAP_IPC_LOCK` or `CAP_SYS_RESOURCE`, which the shell uid and Termux app uid do not have.

- AOSP test comment “memlock at, or under, 64KB”: https://android.googlesource.com/platform/system/core/+/ee065fe080bd947137c5ce5b42bfb6b3699f560d  (search the tree for `RLIMIT_MEMLOCK` / `max_limit = 65536`; the 64 KB cap is the AOSP userspace default, Android 13–16)
- `mlock(2)` man: `RLIMIT_MEMLOCK` is not enforced only if the process is privileged (`CAP_IPC_LOCK`)

What you will see, same as on desktop when the ulimit is low:

```
warning: failed to mlock 1825361100-byte buffer (after previously locking 0 bytes): Cannot allocate memory
Try increasing RLIMIT_MEMLOCK ('ulimit -l' as root).
```

llama.cpp’s own text (current tree, `llama-mmap.cpp`):

- https://huggingface.co/spaces/Steven10429/apply_lora_and_quantize/blame/main/llama.cpp/src/llama-mmap.cpp  **[github]** (mirrors ggml-org/llama.cpp; `MLOCK_SUGGESTION` / `RLIMIT_MEMLOCK`)
- Same warning in the wild: https://github.com/ggml-org/llama.cpp/issues/15120  **[github]**

`ulimit -l` inside `adb shell` or Termux will report `64` (kilobytes). `ulimit -l unlimited` fails without root.

### 4.3 llama.cpp `--mlock` precedent on Android / Xiaomi

- `--mlock` on Android is **best-effort**. Failure is a warning; load continues; pages remain swappable. That is the intended llama.cpp behaviour.
- Xiaomi Pad 8 Pro, 12 GB RAM, Termux, Adreno OpenCL: **“`--mlock` causes OOM with GPU offload on 12 GB RAM”**. So even when the RLIMIT is somehow not the blocker (or only part of the buffer is locked), pinning on a 12 GB HyperOS device fights the same ~6 GB `MemAvailable` ceiling we see.

  - https://github.com/ggml-org/llama.cpp/discussions/23736  **[github]** (2026, Xiaomi Pad 8 Pro / HyperOS-class, 12 GB)

- Older Xiaomi Termux writeups (Poco F1, 6 GB) already told people “Android background always-resident set means you do not have your advertised RAM”; they recommended a userspace swapfile for *small*-RAM phones — the opposite of what we want.

  - https://ivonblog.com/en-us/posts/alpaca-cpp-termux-android/  **[anecdotal]** (2023)

**Do not `swapon` a Termux swapfile on this phone.** HyperOS users have created persistent multi-GB swap/zRAM they then could not undo without a wipe (`settings put global zram_enabled 0` did nothing).

- https://www.reddit.com/r/termux/comments/1p68uo9/help-created-persistent-zramswap-via-termux/  **[anecdotal]** (HyperOS)

### 4.4 What *is* permitted, and useful

| Call | Unprivileged? | Use for us |
|---|---|---|
| `madvise(MADV_WILLNEED)` on the mmap model | **yes** | prefetch weights into page cache *before* decode, so first-token major faults happen in a controlled burst. Does **not** pin. |
| `madvise(MADV_HUGEPAGE)` | yes, often ignored on 4K Android | ignore |
| `madvise(MADV_DONTFORK)` | yes | good hygiene if we fork |
| `madvise(MADV_COLD)` / `MADV_PAGEOUT` | yes | **do not** use on the hot set |
| `posix_fadvise(POSIX_FADV_WILLNEED)` on the GGUF fd | yes | same as WILLNEED |
| `mlock` / `mlockall(MCL_CURRENT)` | no (64 KB) | skip without root |
| `mmap(..., MAP_LOCKED)` | same RLIMIT | skip |
| `prctl(PR_SET_THP_DISABLE)` | yes | not our problem |

Pinning is a **root-only** lab tool on this device. The product-side equivalent is “don’t allocate a working set larger than `MemAvailable`”.

---

## 5. Per-app RAM ceilings, PSI kills, shell uid vs Termux uid

### 5.1 Does HyperOS impose a per-process anon ceiling on shell?

**No documented per-process anon cap on HyperOS 1/2/3 / Android 16 for uid 2000.**

What *does* exist:

1. **`lmkd` + PSI** (AOSP, Android 10+, so all HyperOS). Kills by `oom_score_adj`, not by “this pid used 1.7 GiB”. Defaults (AOSP 11+ strategy):

   | Property | Default | Meaning |
   |---|---|---|
   | `ro.lmk.use_psi` | `true` | PSI, not vmpressure |
   | `ro.lmk.psi_partial_stall_ms` | 70 | low-memory notify |
   | `ro.lmk.psi_complete_stall_ms` | 700 | critical |
   | `ro.lmk.swap_free_low_percentage` | 20 | kill when free swap < 20 % of SwapTotal |
   | `ro.lmk.swap_util_max` | 100 | “already swapped most anon and still in trouble” (100 = check off) |
   | `ro.lmk.critical` | 0 | at CRITICAL, **any** process is eligible |
   | `ro.config.low_ram` | `false` on a 12 GB flagship | high-performance kill strategy |

   - https://source.android.com/docs/core/perf/lmkd  **[primary]**

   If Memory Extension + zRAM make `SwapTotal` look huge (e.g. 6–8 GB) and then fill it, `swap_free_low_percentage=20` will start killing when 80 % of that swap is used — **including, eventually, us**. Disabling Memory Extension *shrinks* `SwapTotal` (the writeback portion), which can make this threshold *tighter* on the remaining zRAM. Watch `SwapFree` during a run.

2. **Xiaomi SPC / MMMS watermarks** (`persist.sys.mmms.lowmem.reclaim.memavailable.thread=524288` kB = 512 MB). These make `kswapd` nervous earlier; they are not a per-pid cap. **[github firmware, HyperOS 1]**

3. **AOSP Memory Limiter** (cgroup v2 `memory.high` / `memory.swap.max`): Android **17+**, apps only (UID ≥ 10000). Recommended visible-process cap ≈ ½–⅔ of RAM (on 12 GB that would be 6–8 GB — enough to squeeze a 12.5+2+1.7 working set if someone ever ships it on this phone). **Not on our Android 16 build** unless a hidden vendor XML exists at `/vendor/etc/memory-limiter-config.xml` (worth a one-line check).

   - https://source.android.com/docs/core/perf/memory-limiter  **[primary]**
   - Probe: `adb shell ls /vendor/etc/memory-limiter-config.xml` ; `adb shell am memory-limiter status` (command missing ⇒ not present)

4. **Termux `ulimit -v` / cgroup**: Termux does not set an address-space cap by default. HyperOS does not add one for uid 2000.

### 5.2 Documented difference: adb-shell uid vs Termux app uid

| | `adb shell` (uid 2000) | Termux app uid |
|---|---|---|
| PowerKeeper / millet / recents / autostart | ignored | fully applied |
| `lmkd` oom_adj when “in use” | low (native / not an app) | TOP if the activity is focused; jumps to cached if you leave Termux |
| Screen off | process keeps running (adb connection) | Termux is cached → freeze + compact + kill unless No restrictions + lock + wakelock |
| Memory Limiter (A17+) | exempt | limited |
| `kswapd` / zRAM / extm | **identical** | **identical** |
| SELinux | `shell` domain | `untrusted_app` |
| RLIMIT_MEMLOCK | 64 KB | 64 KB |

For a multi-hour decode, **prefer `adb shell` (uid 2000)** so PowerKeeper cannot freeze us mid-token. If you must use Termux: lock + No restrictions + keep the activity focused + `termux-wake-lock`.

Neither uid gets a free pass on swap.

---

## 6. What other on-device LLM projects do on Xiaomi

There is **no** Xiaomi-specific llama.cpp / MLC / MNN “set this persist.sys and HyperOS will leave you alone” recipe. What exists:

### llama.cpp

- Runs in Termux on Xiaomi phones/tablets, including 12 GB class.
- **`--mlock` is useless-to-harmful** on stock Android (RLIMIT) and has been observed to OOM a 12 GB Xiaomi Pad under GPU offload.
  - https://github.com/ggml-org/llama.cpp/discussions/23736  **[github]** (Xiaomi Pad 8 Pro, 12 GB, 2026)
- Practical knobs the Adreno/Termux writeups actually use: pin threads to big cores (`-C`), keep KV in f16 if the GPU backend requires it, **size context / cache to what fits**, prompt-cache / `--cache-ram` so you do not rebuild a 2 GiB cache you cannot hold.
- Older Xiaomi Pad 6 Pro 12 GB Termux issue (garbage output on partial offload), memory not the bug: https://github.com/ggml-org/llama.cpp/issues/4774  **[github]**
- Poco F1 / 6 GB: “advertised RAM is not yours; Termux dies immediately under 8 GB class if you ignore the always-resident set.” https://ivonblog.com/en-us/posts/alpaca-cpp-termux-android/  **[anecdotal]**

### MLC / MNN / Xiaomi’s own on-device work

- Xiaomi publishes on-device inference samples (e.g. StableDiffusionOnDevice) but **no public HyperOS memory-policy guide** for third-party native engines.
- No MLC or MNN issue tracker hit that says “on HyperOS set persist.miui.extm.enable=0”. Absence is data: everyone is either (a) sizing the model down or (b) using GPU offload so the hot set is smaller.

### Termux-side “fixes” that are traps

- Creating a userspace `swapfile` + `swapon` inside Termux. On HyperOS this has been reported to **latch a 6 GB zRAM/swap** that survives uninstall and ignores Memory Extension = Off and `zram_enabled 0`. Do not do this.
  - https://linustechtips.com/topic/1627978-help-created-persistent-zramswap-via-termux-non-root-on-xiaomi-11t-and-cannot-remove-it-memory-extension-is-off/  **[anecdotal]** (HyperOS, 2025)
- Uninstalling `com.miui.powerkeeper` or `com.miui.daemon` to “get RAM back”. Daemon removal *does* raise idle RAM (it was killing cached apps) but PowerKeeper removal has **bootloop** reports. Not a lab procedure for a flagship we still need tomorrow.
  - https://github.com/0x192/universal-android-debloater/issues/913  **[github]**

### What actually works, across projects

1. Measure `MemAvailable` on the specific ROM, do not trust the box (12 GB / 8 GB).
2. Keep the engine process in a uid/`oom_adj` that will not be frozen (adb shell, or a locked foreground Termux).
3. Turn off OEM flash-swap (Memory Extension / RAM Plus).
4. Size KV cache / context so `mmap + cache + anon + ~1.5 GB OS headroom` ≤ `MemAvailable`.
5. Do not `mlock` without root.

That is the same list this report ends on.

---

## Product-side recommendation (no web needed — this is the robust fix)

**Make the S23 ram-guard universal.**

Regardless of every HyperOS knob above:

1. At loader start, read `/proc/meminfo` `MemAvailable` (and, if present, `SwapFree` / zRAM `mm_stat`).
2. Compute a conservative budget:
   - `budget = MemAvailable - headroom`
   - `headroom` ≥ 1.0–1.5 GiB on HyperOS (system + compositor + kswapd target). The S23 can use a smaller headroom; **use the larger number everywhere** or make it OEM-specific with HyperOS as the default.
3. Size `--cache-mb` so `model_rss_estimate + cache + anon_dense + headroom ≤ MemAvailable`.
   - The 12.5 GiB mmap is **file-backed**. Only the *touched* pages count against RAM. A probe that just stats the file will over-reject. Either (a) treat the mmap as “will become fully resident if we decode long enough” and refuse, or (b) madvise/WILLNEED a working subset and budget that subset. For a 12.5 GiB model on a 6 GB `MemAvailable` device, (a) is the honest answer: **this config does not fit**.
4. **Refuse** to start (non-zero exit, clear message) rather than start and die at 0.35 t/s with 5 major faults/token.
5. Optionally re-probe every N tokens; if `MemAvailable` collapses or `pgmajfault` rate exceeds a threshold, shrink/stop rather than thrash.

HyperOS knobs in the checklist below are the **lab-side complement**: they can move `MemAvailable` from 6 GB toward 7–8 GB and, more importantly, stop flash writeback. They will not turn an 11.4 GB HyperOS phone into a 12 GB Linux box. The loader must assume the worse number.

---

## Baseline probe (run this first, before changing anything)

All **[adb]**, no root. Save the output; it is the before/after for every checklist item.

```
adb shell getprop ro.product.device
adb shell getprop ro.miui.ui.version.name
adb shell getprop ro.build.version.release
adb shell getprop persist.miui.extm.enable
adb shell getprop persist.miui.extm.bdsize
adb shell getprop persist.miui.extm.version
adb shell getprop persist.sys.spc.enabled
adb shell getprop persist.sys.mmms.switch
adb shell getprop persist.sys.mmms.reclaim_switch
adb shell getprop persist.sys.mms.compact_enable
adb shell getprop ro.lmk.use_psi
adb shell getprop ro.lmk.swap_free_low_percentage
adb shell getprop ro.config.low_ram
adb shell cat /proc/meminfo
adb shell cat /proc/sys/vm/swappiness
adb shell cat /proc/swaps
adb shell cat /sys/block/zram0/disksize
adb shell cat /sys/block/zram0/mm_stat
adb shell cat /sys/block/zram0/bd_stat
adb shell dumpsys meminfo | head -n 50
adb shell ls /data/extm /vendor/etc/memory-limiter-config.xml
adb shell am memory-limiter status
adb shell ulimit -l
adb shell id
```

Interpretation cheatsheet:

- `persist.miui.extm.enable=1` + non-empty `bd_stat` → flash writeback is live. This is the first thing to kill.
- `MemAvailable` ~6 GB on `MemTotal` ~11.4 GB → HyperOS idle set is ~5.4 GB. That is the hard budget.
- `ulimit -l` = 64 → `mlock` is dead.
- `id` uid=2000 → per-app UI is irrelevant; uid≥10000 → lock Termux.
- `am memory-limiter status` fails → good (no A17 cap).
- After a 30 s decode, `pgmajfault` delta / tokens ≈ the 1–5 you already measured. After disabling extm, that ratio is the success metric, not `MemAvailable`.

---

## CHECKLIST — Xiaomi 14, ordered by expected impact

Do them in order. Re-run the baseline probe after each change that needs a reboot. Stop when major-faults/token collapse **or** when `MemAvailable` still cannot host `cache+anon+headroom` (then the product-side refuse path is the answer).

### 1. Disable Memory Extension  `[settings-UI]`  — **highest expected impact on flash major faults**

- Path: **Settings → Additional settings → Memory extension → Off → Reboot**.
- HyperOS 1.x / 2.x / 3.x (official Xiaomi FAQ path).
- Confirm after reboot: `getprop persist.miui.extm.enable` is `0` or empty; `/data/extm/extm_file` gone; `bd_stat` zeros/missing.
- Does **not** require root. No reliable `[adb]` equivalent without root.
- https://www.mi.com/global/support/faq/details/KA-503400/

### 2. Free cached-app RAM immediately before the run  `[adb]`

```
adb shell am kill-all
adb shell am memory-factor set NORMAL
```

- AOSP, all HyperOS. Raises `MemAvailable` by whatever cached apps were holding. Does not touch zRAM contents.
- https://android.googlesource.com/platform/frameworks/base/+/refs/heads/main/services/core/java/com/android/server/am/ActivityManagerShellCommand.java

### 3. Run as `adb shell` uid 2000, not as a background Termux app  `[adb]`

- Launch `bmoe-cli` from `adb shell`, screen on or `svc power stayon usb`.
- If you must use Termux: **[settings-UI]** Recents → Lock Termux; Settings → Apps → Termux → Battery → **No restrictions**; Security → Autostart → Termux on; `termux-wake-lock`.
- HyperOS 1–3. Prevents kills, not swap.
- https://dontkillmyapp.com/xiaomi

### 4. Developer options: turn **off** “system / MIUI optimization”  `[settings-UI]`

- Enable Developer options (tap OS version 7×). Additional settings → Developer options → **Turn on system optimization** → Off. Reboot if asked.
- HyperOS 1–3. **[anecdotal]** effect on kswapd; low cost, do it once.
- https://codekk.com/new-second/close-miui-optimization
- Optional `[adb]` after enabling “USB debugging (Security settings)”: `adb shell settings put secure miui_optimization 0`  **[anecdotal, HyperOS 3]** https://sites.google.com/site/tweakradje/xiaomi-hyperos-3-tweaking

### 5. Size the run to the probe, do not hope  `[adb]` (product behaviour)

- Read `MemAvailable`. If `cache + anon_dense + 1.5 GiB > MemAvailable`, **refuse** or cut `--cache-mb` until it fits.
- This is the S23 ram-guard, made universal. It is the only item on this list that still matters if every OEM toggle is a no-op.

### 6. Prefetch, don’t pin  `[adb]` (loader)

- `madvise(MADV_WILLNEED)` / `posix_fadvise(WILLNEED)` on the mmap region you will actually touch. Legal without root.
- Do **not** pass `--mlock` on stock HyperOS. It will fail (64 KB RLIMIT) or OOM.
- https://github.com/ggml-org/llama.cpp/discussions/23736

### 7. Watch the right counters during decode  `[adb]`

```
# in another shell, 1 Hz
adb shell cat /proc/vmstat | grep -E 'pgmajfault|pswpin|pswpout'
adb shell cat /sys/block/zram0/bd_stat
adb shell cat /sys/block/zram0/mm_stat
adb shell cat /proc/meminfo | grep -E 'MemAvailable|SwapFree|AnonPages'
```

- If `bd_stat` `bd_reads` climbs in lockstep with tokens → still on flash writeback (extm not actually off, or another backing device).
- If `bd_stat` idle but `pswpin`/`pgmajfault` climb → in-RAM zRAM. Only remaining non-root lever is **shrink the working set** (step 5) and `am kill-all` (step 2).
- If `AnonPages` falls while we are decoding → kswapd is stealing our dense/cache. Same conclusion.

### 8. Optional: Performance power plan  `[settings-UI]`

- Settings → Battery & performance → **Performance** (wording varies by HyperOS 1/2/3).
- Weak, system-wide. Do it if the phone is otherwise on a battery-saver plan.

### 9. Do **not** do these without a wipe-ready lab  `[needs-root]` or unsafe

| Action | Why not |
|---|---|
| `resetprop persist.miui.extm.enable 0` / `persist.miui.extm.bdsize 0` | works, but the Settings UI already does the supported equivalent |
| `echo 0 > /proc/sys/vm/swappiness` | `[needs-root]`; on a 6 GB `MemAvailable` device this trades swap-thrash for **file-cache thrash of the 12.5 GiB mmap** (also fatal). Only consider after extm is off *and* the working set fits |
| `echo 1 > /sys/block/zram0/reset` then smaller `disksize` | `[needs-root]`; can wedge swap if something still has it open |
| `settings put global zram_enabled 0` | does not disable vendor zRAM on HyperOS **[anecdotal]** |
| Termux `dd` + `mkswap` + `swapon` | has latched persistent 6 GB swap on HyperOS **[anecdotal]** |
| `pm uninstall -k --user 0 com.miui.powerkeeper` | bootloop reports **[github]** |
| `pm uninstall` `com.miui.daemon` | raises idle RAM (cached apps survive) but undefined side effects **[anecdotal]** |
| `--mlock` / `mlock` of 1.7 GiB | `[needs-root]` to raise `RLIMIT_MEMLOCK`; on 12 GB Xiaomi can OOM even then |

### 10. If we ever unlock / root this unit  `[needs-root]`

Priority order, still after step 1:

1. `resetprop persist.sys.mmms.reclaim_switch 0` (already 0 on V816 dumps — confirm).
2. `resetprop persist.sys.spc.mi_extra_free_enable false` — stop SPC from inflating watermarks (HyperOS 1+ props; **undocumented**, measure `MemAvailable` + major faults before/after).
3. `echo 10 > /proc/sys/vm/swappiness` **only if** the mmap working set is already resident and we are still swapping the 1.7 GiB anon.
4. `mlock` the anon dense region (not the 12.5 GiB file map).
5. Shrink zRAM `disksize` (e.g. 1–2 GB) so kswapd cannot park our hot set in compressed RAM.

Treat every persist.sys write as “reboot and re-probe”. There is no Xiaomi document for these.

---

## What success looks like on *this* phone

| Signal | Today (swap-bound) | After a useful tweak |
|---|---|---|
| decode | ~0.35 t/s | 5–7 t/s (CPU-bound, not fault-bound) |
| major faults / token | 1–5 | ≪ 0.1 steady-state (a burst at start from WILLNEED is OK) |
| `bd_stat` bd_reads | climbing | flat |
| `MemAvailable` during decode | collapsing toward watermarks | stable above headroom |
| `SwapFree` | draining | stable |

If faults die and t/s does not recover, the remaining problem is thermal / scheduler / backend, not RAM. If `MemAvailable` never exceeds `cache+anon+headroom`, **refuse the config** — the S23 result does not transfer.

---

## Source index (compact)

**Xiaomi official**

- https://www.mi.com/global/product/xiaomi-14/specs/
- https://www.mi.com/uk/support/article/KA-12358/
- https://www.mi.com/global/support/faq/details/KA-503400/
- https://www.mi.com/global/support/faq/details/KA-497452/

**AOSP / Android developers / kernel**

- https://developer.android.com/topic/performance/memory-management
- https://developer.android.com/tools/dumpsys#meminfo
- https://source.android.com/docs/core/perf/lmkd
- https://source.android.com/docs/core/perf/mmd
- https://source.android.com/docs/core/perf/memory-limiter
- https://android.googlesource.com/platform/frameworks/base/+/master/services/core/java/com/android/server/am/ActivityManagerShellCommand.java
- https://docs.kernel.org/admin-guide/blockdev/zram.html

**Firmware / implementation evidence**

- https://github.com/kibria5/device_xiaomi_sapphire_dump/blob/main/product.prop
- https://gitlab.taiao.ai/fw-dumps/redmi/mivendor/-/blob/missi_phone_global-user-14-UKQ1.231207.002-V816.0.3.0.UNGMIXM-release-keys/product/etc/build.prop

**Vendor-behaviour (anecdotal unless noted)**

- https://dontkillmyapp.com/xiaomi
- https://xiaomi.eu/community/threads/increase-memory-ram-extension-limit.65312/
- https://www.reddit.com/r/PocoPhones/comments/151kr8d/why_do_my_phone_still_use_zram_even_though_i/
- https://sites.google.com/site/tweakradje/xiaomi-hyperos-3-tweaking
- https://www.allabouthyperos.com/2025/04/hyperos-how-to-enable-or-disable-ram.html
- https://linustechtips.com/topic/1627978-help-created-persistent-zramswap-via-termux-non-root-on-xiaomi-11t-and-cannot-remove-it-memory-extension-is-off/
- https://github.com/0x192/universal-android-debloater/issues/913

**On-device LLM**

- https://github.com/ggml-org/llama.cpp/discussions/23736
- https://github.com/ggml-org/llama.cpp/issues/4774
- https://ivonblog.com/en-us/posts/alpaca-cpp-termux-android/

---

DONE
