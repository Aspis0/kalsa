"""Xiaomi 14 TTFT-v2 prewarm matrix. Device houji only. Never touch S23/Jelly.

Mirror kalsa-ttft-v2-jelly.md:
  1a  force-stop, cold launch, wait 90s (prewarm must finish), send. 2 reps.
  1b  force-stop, cold launch, send immediately (join in-flight prewarm). 1 rep.
  swipe-kill  recents swipe, relaunch, wait 90s, send. 1 rep.

Clock: adb TTFT_MARK at send tap + first KALSA_TELEMETRY after the mark
(ttft_ms ≈ telemetry_ts − predictedMs). Same as the Jelly runner.
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
import time
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from pathlib import Path

ADB = r"C:\Users\gualt\AppData\Local\Android\Sdk\platform-tools\adb.exe"
SERIAL = "adb-625689a2-9xEOfw._adb-tls-connect._tcp"
PKG = "com.kalsa.app"
ACTIVITY = "com.kalsa.app/.MainActivity"
IME = "com.google.android.inputmethod.latin/com.android.inputmethod.latin.LatinIME"
ROOT = Path(r"C:\Users\gualt\Desktop\Kalsa\moe-experiments\results\ttft_4b_xiaomi\postfix")
BOUNDS_RE = re.compile(r"\[(\d+),(\d+)\]\[(\d+),(\d+)\]")
TTFT_RE = re.compile(r'\{"event"\s*:\s*"ttft"[^}]*\}')
TELEMETRY_RE = re.compile(r"KALSA_TELEMETRY\s+(\{.*\})")
MARK_RE = re.compile(r"(\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\.\d+)\s+\d+\s+\d+\s+I\s+TTFT_MARK:\s+(\S+)")
THREADTIME_RE = re.compile(r"^(\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\.\d+)")
# RN console.log("KALSA_PREWARM", json) prints as 'KALSA_PREWARM', '{...}'
PREWARM_RE = re.compile(r"KALSA_PREWARM['\",\s]+(\{.*\})")
REUSING_RE = re.compile(r"reusing\s+(\d+)/(\d+)\s+prompt tokens")
KVDIAG_RE = re.compile(r"KALSA_KVDIAG['\",\s]+(\{.*\})")
EAGER_RE = re.compile(r"engine\.eagerInit")
PLACEHOLDERS = {
    "fai una domanda…",
    "fai una domanda...",
    "ask a question…",
    "ask a question...",
    "",
}
ABORT_TEMP_C = 43.0
FLOOR_LEVEL = 45
PROMPT = "ciao"
ENGINE_ACTIVITY_RE = re.compile(
    r"loadPrompt|RNLlama|KALSA_TELEMETRY|completion\(|not enough memory|model\.tooLarge|Memoria insufficiente",
    re.I,
)


def adb(*args: str, timeout: int = 60) -> subprocess.CompletedProcess:
    return subprocess.run(
        [ADB, "-s", SERIAL, *args],
        capture_output=True,
        text=True,
        timeout=timeout,
        check=False,
        encoding="utf-8",
        errors="replace",
    )


def adb_shell(cmdline: str, timeout: int = 60) -> str:
    r = adb("shell", cmdline, timeout=timeout)
    return (r.stdout or "") + (r.stderr or "")


def write_text(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def parse_bounds(raw: str | None):
    if not raw:
        return None
    m = BOUNDS_RE.fullmatch(raw.strip())
    if not m:
        return None
    return tuple(int(x) for x in m.groups())


def center(b):
    return ((b[0] + b[2]) // 2, (b[1] + b[3]) // 2)


def dump_ui(dest: Path | None = None) -> ET.Element:
    remote = "/sdcard/ttft_ui.xml"
    last_err = ""
    for attempt in range(6):
        r = adb("shell", "uiautomator", "dump", remote)
        txt = (r.stdout or "") + (r.stderr or "")
        if r.returncode == 0 or "dumped" in txt.lower():
            pulled = dest or (ROOT / "_tmp_ui.xml")
            pulled.parent.mkdir(parents=True, exist_ok=True)
            p = adb("pull", remote, str(pulled))
            if p.returncode == 0 and pulled.exists() and pulled.stat().st_size > 100:
                root = ET.parse(pulled).getroot()
                first = root.find(".//node")
                pkg = first.get("package") if first is not None else ""
                if pkg and pkg != PKG:
                    adb("shell", "input", "keyevent", "4")
                    time.sleep(0.3)
                    if "launcher" in pkg.lower() or pkg == "com.android.systemui":
                        adb("shell", "am", "start", "-n", ACTIVITY)
                        time.sleep(1.0)
                    last_err = f"overlay pkg={pkg}"
                    continue
                return root
            last_err = p.stderr or ""
        else:
            last_err = txt
        time.sleep(0.8 + attempt * 0.3)
    raise RuntimeError(f"uiautomator dump failed: {last_err}")


def iter_nodes(root: ET.Element):
    yield from root.iter("node")


def find_first(root: ET.Element, predicate):
    for n in iter_nodes(root):
        if predicate(n):
            return n
    return None


def tap_bounds(b):
    x, y = center(b)
    adb("shell", "input", "tap", str(x), str(y))
    return x, y


def tap_node(n):
    b = parse_bounds(n.get("bounds"))
    if not b:
        return None
    return tap_bounds(b)


def input_ascii(text: str) -> None:
    escaped = text.replace(" ", "%s")
    adb("shell", "input", "text", escaped)


def ime_off() -> None:
    adb("shell", "settings", "put", "secure", "show_ime_with_hard_keyboard", "1")
    adb("shell", "ime", "disable", IME)


def ime_on() -> None:
    adb("shell", "ime", "enable", IME)
    adb("shell", "ime", "set", IME)
    adb("shell", "settings", "put", "secure", "show_ime_with_hard_keyboard", "0")


def power_state() -> dict:
    raw = adb_shell("dumpsys battery")
    def grab(key: str) -> str:
        for line in raw.splitlines():
            if key in line:
                return line.split(":", 1)[-1].strip()
        return ""
    wake = adb_shell("dumpsys power")
    wakefulness = ""
    for line in wake.splitlines():
        if "mWakefulness=" in line and "Changing" not in line:
            wakefulness = line.split("mWakefulness=", 1)[-1].strip()
            break
    temp_raw = grab("temperature")
    try:
        temp_c = float(temp_raw) / 10.0
    except ValueError:
        temp_c = -1.0
    try:
        level = int(grab("level") or -1)
    except ValueError:
        level = -1
    return {
        "ac": grab("AC powered"),
        "usb": grab("USB powered"),
        "wireless": grab("Wireless powered"),
        "level": level,
        "status": grab("status"),
        "temp_tenths_c": temp_raw,
        "temp_c": temp_c,
        "wakefulness": wakefulness,
    }


def guard_power(where: str) -> dict:
    pwr = power_state()
    if pwr["temp_c"] >= ABORT_TEMP_C:
        raise RuntimeError(f"ABORT temp {pwr['temp_c']}C at {where}")
    if 0 <= pwr["level"] < FLOOR_LEVEL:
        raise RuntimeError(f"ABORT battery {pwr['level']}% at {where}")
    plugged = any(str(pwr.get(k)).lower() == "true" for k in ("ac", "usb", "wireless"))
    if plugged:
        raise RuntimeError(f"ABORT still plugged at {where}: {pwr}")
    return pwr


def keep_awake() -> None:
    adb("shell", "svc", "power", "stayon", "true")
    adb("shell", "settings", "put", "system", "screen_off_timeout", "1800000")
    adb("shell", "input", "keyevent", "KEYCODE_WAKEUP")


def logcat_prepare() -> None:
    adb("logcat", "-G", "16M")
    adb("logcat", "-c")


def logcat_dump(dest: Path) -> str:
    dest.parent.mkdir(parents=True, exist_ok=True)
    r = adb("logcat", "-d", "-v", "threadtime", timeout=90)
    text = r.stdout or ""
    dest.write_text(text, encoding="utf-8", errors="replace")
    return text


def parse_threadtime(ts: str) -> float | None:
    try:
        dt = datetime.strptime(ts, "%m-%d %H:%M:%S.%f")
        return dt.month * 1e7 + dt.day * 86400 + (
            dt.hour * 3600 + dt.minute * 60 + dt.second + dt.microsecond / 1e6
        )
    except ValueError:
        return None


def extract_prewarm(log: str) -> dict:
    events = []
    for line in log.splitlines():
        m = PREWARM_RE.search(line)
        if not m:
            continue
        ts_m = THREADTIME_RE.match(line)
        try:
            payload = json.loads(m.group(1))
        except json.JSONDecodeError:
            continue
        events.append({"ts": ts_m.group(1) if ts_m else None, **payload})
    reuse = None
    for m in REUSING_RE.finditer(log):
        reuse = {"reused": int(m.group(1)), "total": int(m.group(2))}
    kvdiags = []
    for line in log.splitlines():
        m = KVDIAG_RE.search(line)
        if not m:
            continue
        try:
            kvdiags.append(json.loads(m.group(1)))
        except json.JSONDecodeError:
            pass
    start = next((e for e in events if e.get("op") == "start"), None)
    done = next((e for e in events if e.get("op") == "done"), None)
    duration_s = None
    if start and done and start.get("ts") and done.get("ts"):
        a = parse_threadtime(start["ts"])
        b = parse_threadtime(done["ts"])
        if a is not None and b is not None:
            duration_s = round(b - a, 3)
    prompt_ms = done.get("promptMs") if done else None
    return {
        "events": events,
        "start": start,
        "done": done,
        "duration_s": duration_s,
        "prompt_ms": prompt_ms,
        "reuse": reuse,
        "kvdiag": kvdiags,
        "eager": bool(EAGER_RE.search(log)),
    }


def extract_metrics(log: str, mark_token: str) -> dict:
    ttft_json = None
    for m in TTFT_RE.finditer(log):
        try:
            ttft_json = json.loads(m.group(0))
        except json.JSONDecodeError:
            pass
    mark_ts = None
    for m in MARK_RE.finditer(log):
        if m.group(2) == mark_token:
            mark_ts = m.group(1)
    teles = []
    for line in log.splitlines():
        tm = TELEMETRY_RE.search(line)
        if not tm:
            continue
        ts_m = THREADTIME_RE.match(line)
        try:
            payload = json.loads(tm.group(1))
        except json.JSONDecodeError:
            continue
        teles.append({"ts": ts_m.group(1) if ts_m else None, **payload})
    if mark_ts:
        t_mark = parse_threadtime(mark_ts)
        if t_mark is not None:
            after = []
            for t in teles:
                ts = parse_threadtime(t.get("ts") or "")
                if ts is not None and ts + 0.05 >= t_mark:
                    after.append(t)
            teles = after
    first = teles[0] if teles else None
    out = {
        "ttft_json": ttft_json,
        "mark_ts": mark_ts,
        "telemetry": teles,
        "first_telemetry": first,
        "prewarm": extract_prewarm(log),
    }
    if ttft_json and "ttftMs" in ttft_json:
        out["ttft_ms"] = ttft_json["ttftMs"]
        out["ttft_source"] = "ttft_json"
        return out
    if first and mark_ts and first.get("ts"):
        t_mark = parse_threadtime(mark_ts)
        t_tel = parse_threadtime(first["ts"])
        pred = float(first.get("predictedMs") or 0)
        if t_mark is not None and t_tel is not None:
            first_token_s = t_tel - pred / 1000.0
            out["ttft_ms"] = round((first_token_s - t_mark) * 1000.0)
            out["ttft_source"] = "telemetry_minus_predicted"
            out["prompt_ms"] = first.get("promptMs")
            out["predicted_ms"] = first.get("predictedMs")
            return out
    if first and first.get("promptMs") is not None:
        out["ttft_ms"] = round(float(first["promptMs"]))
        out["ttft_source"] = "promptMs_only"
        out["prompt_ms"] = first.get("promptMs")
        out["predicted_ms"] = first.get("predictedMs")
    return out


def wait_ui(predicate, timeout_s: float, dest: Path | None = None) -> ET.Element:
    deadline = time.time() + timeout_s
    last = None
    while time.time() < deadline:
        try:
            last = dump_ui(dest)
            if predicate(last):
                return last
        except Exception:
            pass
        time.sleep(1.2)
    return last if last is not None else dump_ui(dest)


def is_pin_bouncer(root: ET.Element) -> bool:
    texts = " | ".join(f"{n.get('text')}|{n.get('content-desc')}" for n in iter_nodes(root))
    return any(
        x in texts
        for x in (
            "Enter PIN",
            "Inserisci il PIN",
            "keyguard_pin_view",
            "use fingerprint",
        )
    )


def abort_if_pin(root: ET.Element, where: str) -> None:
    if is_pin_bouncer(root):
        dest = ROOT / "NEEDS_HUMAN.txt"
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_text(f"NEEDS_HUMAN PIN bouncer at {where}\n", encoding="utf-8")
        raise RuntimeError(f"NEEDS_HUMAN PIN bouncer at {where}")


def is_chat_ready(root: ET.Element) -> bool:
    texts = " | ".join(f"{n.get('text')}|{n.get('content-desc')}" for n in iter_nodes(root))
    has_edit = any((n.get("class") or "").endswith("EditText") for n in iter_nodes(root))
    has_model = "Qwen" in texts or "Kalsa" in texts
    blocked = any(x in texts for x in ("Allow", "Consenti", "While using", "Enter PIN"))
    return has_edit and has_model and not blocked


def find_edit(root: ET.Element):
    return find_first(root, lambda n: (n.get("class") or "").endswith("EditText"))


def find_send(root: ET.Element):
    return find_first(
        root,
        lambda n: (n.get("content-desc") or "") in ("Invia", "Send") and n.get("clickable") == "true",
    )


def find_stop(root: ET.Element):
    return find_first(
        root,
        lambda n: (n.get("content-desc") or "") in ("Interrompi generazione", "Stop generation"),
    )


def find_desc(root: ET.Element, *descs: str):
    wanted = set(descs)
    return find_first(root, lambda n: (n.get("content-desc") or "") in wanted)


def screenshot(dest: Path) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    with open(dest, "wb") as f:
        subprocess.run(
            [ADB, "-s", SERIAL, "exec-out", "screencap", "-p"],
            stdout=f,
            timeout=30,
            check=False,
        )
    time.sleep(0.6)
    adb("shell", "input", "keyevent", "4")


def launch_cold() -> None:
    adb("shell", "am", "force-stop", PKG)
    time.sleep(1.0)
    adb("shell", "am", "start", "-n", ACTIVITY)


def launch_warm() -> None:
    adb("shell", "am", "start", "-n", ACTIVITY)


def recents_swipe_kill() -> None:
    """Xiaomi 14 1200x2670: open recents and fling the card up."""
    adb("shell", "input", "keyevent", "KEYCODE_APP_SWITCH")
    time.sleep(1.4)
    adb("shell", "input", "swipe", "600", "1500", "600", "120", "280")
    time.sleep(1.0)
    adb("shell", "input", "keyevent", "3")
    time.sleep(0.4)


def open_drawer(root: ET.Element | None = None) -> ET.Element:
    ui = root or dump_ui()
    n = find_desc(ui, "Menu", "Apri menu", "Open menu")
    if n is not None:
        tap_node(n)
        time.sleep(0.8)
        return dump_ui()
    # Header hamburger has no a11y label — swipe from left edge.
    adb("shell", "input", "swipe", "8", "800", "700", "800", "250")
    time.sleep(0.8)
    return dump_ui()


def new_chat(root: ET.Element | None = None) -> None:
    ui = root or dump_ui()
    n = find_desc(ui, "Nuova chat", "New chat")
    if n is None:
        ui = open_drawer(ui)
        n = find_desc(ui, "Nuova chat", "New chat")
    if n is not None:
        tap_node(n)
        time.sleep(1.0)


def type_and_send(text: str, out_dir: Path, mark_token: str) -> dict:
    ui = dump_ui(out_dir / "ui_before_type.xml")
    edit = find_edit(ui)
    if edit is None:
        raise RuntimeError("composer EditText not found")
    tap_node(edit)
    time.sleep(0.4)
    leftover = (edit.get("text") or "").strip()
    if leftover.lower() not in PLACEHOLDERS:
        adb_shell("input keyevent 123; input keyevent --repeat 80 67")
        time.sleep(0.2)
    input_ascii(text)
    time.sleep(0.5)
    ui = dump_ui(out_dir / "ui_after_type.xml")
    edit = find_edit(ui)
    typed = (edit.get("text") or "") if edit is not None else ""
    if text.replace(" ", "") not in typed.replace(" ", "") and text not in typed:
        raise RuntimeError(f"typed text missing in composer: {typed!r}")
    send = find_send(ui)
    if send is None:
        raise RuntimeError("Invia button not found")
    # Security-settings USB debugging is on: synthetic center tap now lands.
    b = parse_bounds(send.get("bounds"))
    if not b:
        raise RuntimeError("Send bounds missing")
    x = (b[0] + b[2]) // 2
    y = (b[1] + b[3]) // 2
    adb("shell", "log", "-p", "i", "-t", "TTFT_MARK", mark_token)
    adb("shell", "input", "tap", str(x), str(y))
    send_info = {
        "tap": (x, y),
        "prompt": text,
        "typed": typed,
        "mark": mark_token,
        "send_method": "center_tap",
        "retry": False,
        "ime_enter": False,
        "engine_hit": False,
    }
    time.sleep(3.0)
    probe = adb("logcat", "-d", "-v", "threadtime", timeout=30).stdout or ""
    if ENGINE_ACTIVITY_RE.search(probe.split(mark_token, 1)[-1] if mark_token in probe else probe):
        send_info["engine_hit"] = True
        return send_info
    # One retry tap, then IME Enter.
    send_info["retry"] = True
    adb("shell", "input", "tap", str(x), str(y))
    time.sleep(2.0)
    probe = adb("logcat", "-d", "-v", "threadtime", timeout=30).stdout or ""
    if ENGINE_ACTIVITY_RE.search(probe.split(mark_token, 1)[-1] if mark_token in probe else probe):
        send_info["engine_hit"] = True
        return send_info
    send_info["ime_enter"] = True
    send_info["send_method"] = "ime_enter"
    adb("shell", "input", "keyevent", "66")
    return send_info


def wait_metrics(out_dir: Path, mark_token: str, timeout_s: float) -> tuple[dict, str]:
    deadline = time.time() + timeout_s
    last = ""
    while time.time() < deadline:
        last = logcat_dump(out_dir / "logcat.txt")
        metrics = extract_metrics(last, mark_token)
        if metrics.get("ttft_ms") is not None or metrics.get("first_telemetry"):
            return metrics, last
        time.sleep(2.5)
    return extract_metrics(last, mark_token), last


def wait_prewarm_done(out_dir: Path, timeout_s: float) -> dict:
    deadline = time.time() + timeout_s
    last = ""
    while time.time() < deadline:
        last = logcat_dump(out_dir / "logcat_prewarm.txt")
        info = extract_prewarm(last)
        if info.get("done") is not None:
            return info
        time.sleep(2.0)
    return extract_prewarm(last)


def wait_generation_idle(timeout_s: float, dest: Path | None = None) -> bool:
    deadline = time.time() + timeout_s
    while time.time() < deadline:
        try:
            ui = dump_ui(dest)
            if find_stop(ui) is None and find_send(ui) is not None:
                return True
        except Exception:
            pass
        time.sleep(2.0)
    return False


def append_csv(row: dict) -> None:
    csv_path = ROOT / "timings.csv"
    keys = [
        "scenario", "rep", "ttft_ms", "ttft_source", "prompt_ms",
        "predicted_ms", "prewarm_s", "prewarm_prompt_ms", "reuse",
        "eager", "level", "temp_c", "wakefulness", "plugged",
        "prompt", "ok", "notes", "dir", "utc",
    ]
    write_header = not csv_path.exists()
    line = ",".join(json.dumps(str(row.get(k, ""))) for k in keys)
    with csv_path.open("a", encoding="utf-8") as f:
        if write_header:
            f.write(",".join(keys) + "\n")
        f.write(line + "\n")


def record_and_row(out_dir: Path, extra: dict, prompt: str, metrics: dict, notes: list) -> dict:
    pwr = power_state()
    pre = metrics.get("prewarm") or {}
    reuse = pre.get("reuse")
    reuse_s = ""
    if reuse:
        reuse_s = f"{reuse['reused']}/{reuse['total']}"
    meta = {
        "utc": datetime.now(timezone.utc).isoformat(),
        "serial": SERIAL,
        "pkg": PKG,
        "power": pwr,
        "metrics": metrics,
        **extra,
        "notes": ";".join(notes),
    }
    write_text(out_dir / "meta.json", json.dumps(meta, indent=2))
    plugged = any(str(pwr.get(k)).lower() == "true" for k in ("ac", "usb", "wireless"))
    row = {
        "scenario": extra.get("scenario"),
        "rep": extra.get("rep"),
        "ttft_ms": metrics.get("ttft_ms", ""),
        "ttft_source": metrics.get("ttft_source", ""),
        "prompt_ms": metrics.get("prompt_ms", ""),
        "predicted_ms": metrics.get("predicted_ms", ""),
        "prewarm_s": pre.get("duration_s", ""),
        "prewarm_prompt_ms": pre.get("prompt_ms", ""),
        "reuse": reuse_s,
        "eager": pre.get("eager", ""),
        "level": pwr.get("level"),
        "temp_c": pwr.get("temp_c"),
        "wakefulness": pwr.get("wakefulness"),
        "plugged": plugged,
        "prompt": prompt,
        "ok": isinstance(metrics.get("ttft_ms"), (int, float)) and metrics["ttft_ms"] > 0,
        "notes": ";".join(notes),
        "dir": str(out_dir),
        "utc": meta["utc"],
    }
    append_csv(row)
    write_text(out_dir / "result.json", json.dumps(row, indent=2))
    print(json.dumps(row, indent=2))
    return row


def header_text(root: ET.Element) -> str:
    n = find_first(
        root,
        lambda x: "Qwen" in ((x.get("text") or "") + (x.get("content-desc") or "")),
    )
    if n is None:
        return ""
    return (n.get("content-desc") or n.get("text") or "")


def engine_ready_chip(root: ET.Element) -> bool:
    h = header_text(root).lower()
    return "pronto" in h or "ready" in h


def prepare_session(ready_wait_s: float, out_dir: Path, cold: bool) -> ET.Element:
    ime_off()
    keep_awake()
    if cold:
        launch_cold()
    else:
        launch_warm()
    ui = wait_ui(is_chat_ready, ready_wait_s, out_dir / "ui_ready.xml")
    abort_if_pin(ui, f"{out_dir.name}_ready")
    ui = wait_ui(engine_ready_chip, 12, out_dir / "ui_pronto.xml")
    abort_if_pin(ui, f"{out_dir.name}_pronto")
    return ui


def run_1a(rep: int, wait_s: float, ttft_wait_s: float) -> dict:
    out_dir = ROOT / f"1a_r{rep}"
    out_dir.mkdir(parents=True, exist_ok=True)
    notes = [f"wait_s={wait_s}"]
    guard_power(f"1a_r{rep}_start")
    logcat_prepare()
    ui = prepare_session(45, out_dir, cold=True)
    if not is_chat_ready(ui):
        notes.append("chat_not_ready_after_wait")
    new_chat(ui)
    time.sleep(0.5)
    # 4B load on this SoC is ~52 s; 90 s from launch can land mid-prewarm.
    # Protocol floor is 90 s; keep waiting until prewarm-done (cap 240 s).
    t0 = time.time()
    pre = wait_prewarm_done(out_dir, max(wait_s, 240))
    elapsed = time.time() - t0
    if pre.get("done") is None:
        notes.append("prewarm_not_done_in_wait")
    if elapsed < wait_s:
        time.sleep(wait_s - elapsed)
    guard_power(f"1a_r{rep}_send")
    mark = f"1a_r{rep}"
    send_info = type_and_send(PROMPT, out_dir, mark)
    metrics, _ = wait_metrics(out_dir, mark, ttft_wait_s)
    wait_generation_idle(90, out_dir / "ui_idle.xml")
    screenshot(out_dir / "screen_after.png")
    try:
        dump_ui(out_dir / "ui_after.xml")
    except Exception as e:
        notes.append(f"ui_after_fail:{e}")
    return record_and_row(
        out_dir,
        {"scenario": "1a", "rep": rep, "send_info": send_info, "prewarm_watch": pre},
        PROMPT, metrics, notes,
    )


def run_1b(rep: int, ttft_wait_s: float) -> dict:
    out_dir = ROOT / f"1b_r{rep}"
    out_dir.mkdir(parents=True, exist_ok=True)
    notes = ["send_immediately"]
    guard_power(f"1b_r{rep}_start")
    logcat_prepare()
    ime_off()
    keep_awake()
    launch_cold()
    ui = wait_ui(is_chat_ready, 25, out_dir / "ui_ready.xml")
    abort_if_pin(ui, f"1b_r{rep}_ready")
    if not is_chat_ready(ui):
        notes.append("chat_not_ready_after_wait")
    # Join: wait until prewarm STARTS (engine ready, prefix in flight), then
    # send immediately. Tapping Send during model-load (before start) is a miss.
    t0 = time.time()
    pre_start = None
    while time.time() - t0 < 90:
        last = logcat_dump(out_dir / "logcat_prewarm.txt")
        info = extract_prewarm(last)
        if info.get("start") is not None:
            pre_start = info
            break
        time.sleep(1.0)
    if pre_start is None:
        notes.append("prewarm_start_not_seen")
    else:
        notes.append("joined_after_prewarm_start")
    mark = f"1b_r{rep}"
    send_info = type_and_send(PROMPT, out_dir, mark)
    metrics, _ = wait_metrics(out_dir, mark, ttft_wait_s)
    wait_generation_idle(180, out_dir / "ui_idle.xml")
    screenshot(out_dir / "screen_after.png")
    try:
        dump_ui(out_dir / "ui_after.xml")
    except Exception as e:
        notes.append(f"ui_after_fail:{e}")
    return record_and_row(
        out_dir,
        {"scenario": "1b", "rep": rep, "send_info": send_info},
        PROMPT, metrics, notes,
    )


def run_swipe(rep: int, wait_s: float, ttft_wait_s: float) -> dict:
    out_dir = ROOT / f"swipe_r{rep}"
    out_dir.mkdir(parents=True, exist_ok=True)
    notes = [f"wait_s={wait_s}"]
    guard_power(f"swipe_r{rep}_start")
    logcat_prepare()
    ui = prepare_session(45, out_dir, cold=True)
    new_chat(ui)
    recents_swipe_kill()
    time.sleep(1.5)
    logcat_prepare()
    launch_warm()
    wait_ui(is_chat_ready, 45, out_dir / "ui_relaunch.xml")
    t0 = time.time()
    pre = wait_prewarm_done(out_dir, max(wait_s, 240))
    elapsed = time.time() - t0
    if pre.get("done") is None:
        notes.append("prewarm_not_done_in_wait")
    if elapsed < wait_s:
        time.sleep(wait_s - elapsed)
    guard_power(f"swipe_r{rep}_send")
    mark = f"swipe_r{rep}"
    send_info = type_and_send(PROMPT, out_dir, mark)
    metrics, _ = wait_metrics(out_dir, mark, ttft_wait_s)
    wait_generation_idle(90, out_dir / "ui_idle.xml")
    screenshot(out_dir / "screen_after.png")
    return record_and_row(
        out_dir,
        {"scenario": "swipe-kill", "rep": rep, "send_info": send_info, "prewarm_watch": pre},
        PROMPT, metrics, notes,
    )


def select_4b() -> dict:
    """Open drawer → Impostazioni → Seleziona Qwen 3.5 4B if not active."""
    out_dir = ROOT / "select_4b"
    out_dir.mkdir(parents=True, exist_ok=True)
    ime_off()
    keep_awake()
    launch_warm()
    ui = wait_ui(is_chat_ready, 40, out_dir / "ui_ready.xml")
    ui = open_drawer(ui)
    dump_ui(out_dir / "ui_drawer.xml")
    n = find_desc(ui, "Impostazioni", "Settings")
    if n is None:
        n = find_first(ui, lambda x: (x.get("text") or "") in ("Impostazioni", "Settings"))
    if n is None:
        raise RuntimeError("Settings row not in drawer")
    tap_node(n)
    time.sleep(1.2)
    ui = dump_ui(out_dir / "ui_settings.xml")
    # Scroll until 4B row is visible.
    for _ in range(6):
        texts = " | ".join((n.get("text") or "") for n in iter_nodes(ui))
        if "Qwen 3.5 4B" in texts or "Qwen 3.5 4B · Q3" in texts:
            break
        adb("shell", "input", "swipe", "600", "1800", "600", "700", "300")
        time.sleep(0.6)
        ui = dump_ui()
    dump_ui(out_dir / "ui_models.xml")
    # Prefer the non-Q3 4B. Tap Seleziona on that row if present.
    four_b = find_first(
        ui,
        lambda n: (n.get("text") or "") == "Qwen 3.5 4B",
    )
    if four_b is None:
        raise RuntimeError("Qwen 3.5 4B row not found")
    # Walk siblings via parent: look for Seleziona / Attivo near this y.
    b = parse_bounds(four_b.get("bounds"))
    y = (b[1] + b[3]) // 2 if b else 0
    select = None
    active = None
    for n in iter_nodes(ui):
        t = n.get("text") or ""
        nb = parse_bounds(n.get("bounds"))
        if not nb:
            continue
        ny = (nb[1] + nb[3]) // 2
        if abs(ny - y) > 180:
            continue
        if t in ("Seleziona", "Select"):
            select = n
        if t in ("Attivo", "Active"):
            active = n
    notes = []
    if active is not None:
        notes.append("already_active")
    elif select is not None:
        tap_node(select)
        notes.append("tapped_select")
        time.sleep(2.0)
    else:
        notes.append("no_select_button")
    dump_ui(out_dir / "ui_after_select.xml")
    screenshot(out_dir / "screen_settings.png")
    header = header_text(dump_ui(out_dir / "ui_header.xml"))
    result = {"header": header, "notes": notes}
    write_text(out_dir / "result.json", json.dumps(result, indent=2))
    print(json.dumps(result, indent=2))
    return result


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument(
        "cmd",
        choices=["1a", "1b", "swipe", "matrix", "select-4b", "dump", "power", "ime-on", "ime-off"],
    )
    ap.add_argument("--rep", type=int, default=1)
    ap.add_argument("--wait", type=float, default=90)
    ap.add_argument("--ttft-wait", type=float, default=180)
    args = ap.parse_args()

    ROOT.mkdir(parents=True, exist_ok=True)
    keep_awake()

    if args.cmd == "power":
        print(json.dumps(power_state(), indent=2))
        return 0
    if args.cmd == "ime-on":
        ime_on()
        return 0
    if args.cmd == "ime-off":
        ime_off()
        return 0
    if args.cmd == "dump":
        dest = ROOT / "ui_now.xml"
        dump_ui(dest)
        print(dest)
        return 0
    if args.cmd == "select-4b":
        select_4b()
        return 0
    if args.cmd == "1a":
        run_1a(args.rep, args.wait, args.ttft_wait)
        return 0
    if args.cmd == "1b":
        run_1b(args.rep, args.ttft_wait)
        return 0
    if args.cmd == "swipe":
        run_swipe(args.rep, args.wait, args.ttft_wait)
        return 0
    if args.cmd == "matrix":
        rows = []
        rows.append(run_1a(1, args.wait, args.ttft_wait))
        time.sleep(8)
        rows.append(run_1a(2, args.wait, args.ttft_wait))
        time.sleep(8)
        rows.append(run_1b(1, max(args.ttft_wait, 240)))
        time.sleep(8)
        rows.append(run_swipe(1, args.wait, args.ttft_wait))
        write_text(ROOT / "matrix.json", json.dumps(rows, indent=2))
        return 0
    return 1


if __name__ == "__main__":
    sys.exit(main())
