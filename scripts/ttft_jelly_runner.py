"""Jelly TTFT matrix runner. Device 192.168.1.82 only. Never touch S23.

Release APKs drop console.info, so {"event":"ttft"} is absent. Measurement is
an adb log mark at send tap plus the first KALSA_TELEMETRY line
(first_token ≈ telemetry_ts - predictedMs).
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
SERIAL = "192.168.1.82:44395"
PKG = "com.kalsa.app"
ACTIVITY = "com.kalsa.app/.MainActivity"
IME = "com.google.android.inputmethod.latin/com.android.inputmethod.latin.LatinIME"
ROOT = Path(r"C:\Users\gualt\Desktop\Kalsa\moe-experiments\results\ttft_verify_jelly")
BOUNDS_RE = re.compile(r"\[(\d+),(\d+)\]\[(\d+),(\d+)\]")
TTFT_RE = re.compile(r'\{"event"\s*:\s*"ttft"[^}]*\}')
TELEMETRY_RE = re.compile(r"KALSA_TELEMETRY\s+(\{.*\})")
MARK_RE = re.compile(r"(\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\.\d+)\s+\d+\s+\d+\s+I\s+TTFT_MARK:\s+(\S+)")
THREADTIME_RE = re.compile(r"^(\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\.\d+)")
PLACEHOLDERS = {
    "fai una domanda…",
    "fai una domanda...",
    "ask a question…",
    "ask a question...",
    "",
}


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
                    # Overlay or we got kicked to launcher. Bring Kalsa back.
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
    return {
        "ac": grab("AC powered"),
        "usb": grab("USB powered"),
        "level": grab("level"),
        "status": grab("status"),
        "temp_tenths_c": grab("temperature"),
    }


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
    """Return seconds from an arbitrary epoch (comparable within one day)."""
    try:
        dt = datetime.strptime(ts, "%m-%d %H:%M:%S.%f")
        return dt.month * 1e7 + dt.day * 86400 + (
            dt.hour * 3600 + dt.minute * 60 + dt.second + dt.microsecond / 1e6
        )
    except ValueError:
        return None


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


def is_chat_ready(root: ET.Element) -> bool:
    texts = " | ".join(f"{n.get('text')}|{n.get('content-desc')}" for n in iter_nodes(root))
    has_edit = any((n.get("class") or "").endswith("EditText") for n in iter_nodes(root))
    has_model = "Qwen" in texts or "Kalsa" in texts
    blocked = any(x in texts for x in ("Allow", "Consenti", "While using"))
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
    adb("shell", "input", "keyevent", "4")  # dismiss screenshot chip if any


def launch_cold() -> None:
    adb("shell", "am", "force-stop", PKG)
    time.sleep(1.0)
    adb("shell", "am", "start", "-n", ACTIVITY)


def launch_warm() -> None:
    adb("shell", "am", "start", "-n", ACTIVITY)


def press_home() -> None:
    adb("shell", "input", "keyevent", "3")


def recents_swipe_kill() -> None:
    """Approximate swipe-from-recents kill."""
    adb("shell", "input", "keyevent", "KEYCODE_APP_SWITCH")
    time.sleep(1.2)
    # Jelly 480x854: swipe the card up
    adb("shell", "input", "swipe", "240", "450", "240", "80", "250")
    time.sleep(1.0)
    adb("shell", "input", "keyevent", "3")
    time.sleep(0.4)


def new_chat(root: ET.Element | None = None) -> None:
    ui = root or dump_ui()
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
    adb("shell", "log", "-p", "i", "-t", "TTFT_MARK", mark_token)
    xy = tap_node(send)
    return {"tap": xy, "prompt": text, "typed": typed, "mark": mark_token}


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
    csv_path = ROOT / "matrix.csv"
    keys = [
        "arm", "scenario", "rep", "ttft_ms", "ttft_source", "prompt_ms",
        "predicted_ms", "power", "level", "temp_c", "prompt", "ok",
        "notes", "dir", "utc",
    ]
    write_header = not csv_path.exists()
    line = ",".join(json.dumps(str(row.get(k, ""))) for k in keys)
    with csv_path.open("a", encoding="utf-8") as f:
        if write_header:
            f.write(",".join(keys) + "\n")
        f.write(line + "\n")


def record_and_row(out_dir: Path, extra: dict, prompt: str, metrics: dict, notes: list) -> dict:
    pwr = power_state()
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
    row = {
        "arm": extra.get("arm"),
        "scenario": extra.get("scenario"),
        "rep": extra.get("rep"),
        "ttft_ms": metrics.get("ttft_ms", ""),
        "ttft_source": metrics.get("ttft_source", ""),
        "prompt_ms": metrics.get("prompt_ms", ""),
        "predicted_ms": metrics.get("predicted_ms", ""),
        "power": f"AC={pwr.get('ac')}",
        "level": pwr.get("level"),
        "temp_c": (float(pwr.get("temp_tenths_c") or 0) / 10.0),
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
    if cold:
        launch_cold()
    else:
        launch_warm()
    ui = wait_ui(is_chat_ready, ready_wait_s, out_dir / "ui_ready.xml")
    # P0-2: wait briefly for Pronto. On Jelly this chip never flipped in 70s
    # of idle (eager init did not mlock); keep the wait short.
    ui = wait_ui(engine_ready_chip, 12, out_dir / "ui_pronto.xml")
    return ui


def run_s1(arm: str, rep: int, prompt: str, ready_wait_s: float, ttft_wait_s: float) -> dict:
    out_dir = ROOT / arm / f"S1_r{rep}"
    out_dir.mkdir(parents=True, exist_ok=True)
    notes = []
    logcat_prepare()
    ui = prepare_session(ready_wait_s, out_dir, cold=True)
    if not is_chat_ready(ui):
        notes.append("chat_not_ready_after_wait")
    if not engine_ready_chip(ui):
        notes.append("chip_not_pronto")
    new_chat(ui)
    time.sleep(0.8)
    mark = f"S1_{arm}_r{rep}"
    send_info = type_and_send(prompt, out_dir, mark)
    metrics, _ = wait_metrics(out_dir, mark, ttft_wait_s)
    wait_generation_idle(90, out_dir / "ui_idle.xml")
    screenshot(out_dir / "screen_after.png")
    try:
        dump_ui(out_dir / "ui_after.xml")
    except Exception as e:
        notes.append(f"ui_after_fail:{e}")
    return record_and_row(
        out_dir,
        {"scenario": "S1", "arm": arm, "rep": rep, "send_info": send_info},
        prompt, metrics, notes,
    )


def run_s2(arm: str, rep: int, prompt: str, ready_wait_s: float, bg_s: float, ttft_wait_s: float) -> dict:
    out_dir = ROOT / arm / f"S2_r{rep}"
    out_dir.mkdir(parents=True, exist_ok=True)
    notes = [f"background_s={bg_s}"]
    logcat_prepare()
    ui = prepare_session(ready_wait_s, out_dir, cold=True)
    new_chat(ui)
    time.sleep(0.5)
    # Load the engine first. P0-1 is keepalive, not first-load.
    type_and_send("Say OK", out_dir, f"S2_{arm}_r{rep}_warm")
    wait_generation_idle(ttft_wait_s, out_dir / "ui_warm_idle.xml")
    notes.append("warmup_sent")
    press_home()
    time.sleep(bg_s)
    launch_warm()
    wait_ui(is_chat_ready, 30, out_dir / "ui_resume.xml")
    logcat_prepare()  # isolate measured send from warmup telemetry
    mark = f"S2_{arm}_r{rep}"
    send_info = type_and_send(prompt, out_dir, mark)
    metrics, _ = wait_metrics(out_dir, mark, ttft_wait_s)
    wait_generation_idle(90, out_dir / "ui_idle.xml")
    screenshot(out_dir / "screen_after.png")
    return record_and_row(
        out_dir,
        {"scenario": "S2", "arm": arm, "rep": rep, "send_info": send_info},
        prompt, metrics, notes,
    )


def run_s3(arm: str, rep: int, n_warmup: int, ready_wait_s: float, ttft_wait_s: float) -> dict:
    out_dir = ROOT / arm / f"S3_r{rep}"
    out_dir.mkdir(parents=True, exist_ok=True)
    notes = [f"warmup={n_warmup}"]
    logcat_prepare()
    ui = prepare_session(ready_wait_s, out_dir, cold=True)
    if not engine_ready_chip(ui):
        notes.append("chip_not_pronto")
    new_chat(ui)
    time.sleep(0.8)
    # Seed instruction so later replies stay short.
    seed = "Reply with only the word OK. No other text."
    type_and_send(seed, out_dir, f"S3_{arm}_r{rep}_seed")
    wait_generation_idle(ttft_wait_s, out_dir / "ui_seed_idle.xml")
    for i in range(1, n_warmup + 1):
        mark = f"S3_{arm}_r{rep}_w{i}"
        try:
            type_and_send(str(i), out_dir, mark)
        except Exception as e:
            notes.append(f"warmup_{i}_fail:{e}")
            ime_off()
            continue
        ok_idle = wait_generation_idle(ttft_wait_s, out_dir / f"ui_w{i}_idle.xml")
        if not ok_idle:
            notes.append(f"warmup_{i}_not_idle")
        write_text(out_dir / "warmup_progress.txt", f"{i}/{n_warmup}")
    prompt = "25"
    mark = f"S3_{arm}_r{rep}"
    logcat_prepare()  # isolate measured send
    send_info = type_and_send(prompt, out_dir, mark)
    metrics, _ = wait_metrics(out_dir, mark, ttft_wait_s)
    wait_generation_idle(90, out_dir / "ui_idle.xml")
    screenshot(out_dir / "screen_after.png")
    return record_and_row(
        out_dir,
        {"scenario": "S3", "arm": arm, "rep": rep, "send_info": send_info},
        prompt, metrics, notes,
    )


def run_s6(arm: str, rep: int, prompt: str, ready_wait_s: float, ttft_wait_s: float) -> dict:
    out_dir = ROOT / arm / f"S6_r{rep}"
    out_dir.mkdir(parents=True, exist_ok=True)
    notes = []
    logcat_prepare()
    ui = prepare_session(ready_wait_s, out_dir, cold=True)
    if not engine_ready_chip(ui):
        notes.append("chip_not_pronto")
    new_chat(ui)
    type_and_send("Remember the word banana. Reply OK.", out_dir, f"S6_{arm}_r{rep}_seed")
    wait_generation_idle(ttft_wait_s, out_dir / "ui_seed_idle.xml")
    recents_swipe_kill()
    time.sleep(2)
    launch_warm()
    wait_ui(is_chat_ready, ready_wait_s, out_dir / "ui_relaunch.xml")
    time.sleep(6)
    mark = f"S6_{arm}_r{rep}"
    logcat_prepare()
    send_info = type_and_send(prompt, out_dir, mark)
    metrics, _ = wait_metrics(out_dir, mark, ttft_wait_s)
    wait_generation_idle(90, out_dir / "ui_idle.xml")
    screenshot(out_dir / "screen_after.png")
    return record_and_row(
        out_dir,
        {"scenario": "S6", "arm": arm, "rep": rep, "send_info": send_info},
        prompt, metrics, notes,
    )


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["s1", "s2", "s3", "s6", "send", "dump", "power", "ime-on", "ime-off"])
    ap.add_argument("--arm", default="after")
    ap.add_argument("--rep", type=int, default=1)
    ap.add_argument("--prompt", default="Reply with the single word hello")
    ap.add_argument("--label", default="manual")
    ap.add_argument("--ready-wait", type=float, default=45)
    ap.add_argument("--ttft-wait", type=float, default=180)
    ap.add_argument("--bg", type=float, default=300)
    ap.add_argument("--warmup", type=int, default=24)
    args = ap.parse_args()

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
    try:
        if args.cmd == "s1":
            run_s1(args.arm, args.rep, args.prompt, args.ready_wait, args.ttft_wait)
        elif args.cmd == "s2":
            run_s2(args.arm, args.rep, args.prompt, args.ready_wait, args.bg, args.ttft_wait)
        elif args.cmd == "s3":
            run_s3(args.arm, args.rep, args.warmup, args.ready_wait, args.ttft_wait)
        elif args.cmd == "s6":
            run_s6(args.arm, args.rep, args.prompt, args.ready_wait, args.ttft_wait)
        elif args.cmd == "send":
            out_dir = ROOT / args.arm / args.label
            out_dir.mkdir(parents=True, exist_ok=True)
            ime_off()
            logcat_prepare()
            mark = args.label
            send_info = type_and_send(args.prompt, out_dir, mark)
            metrics, _ = wait_metrics(out_dir, mark, args.ttft_wait)
            wait_generation_idle(90, out_dir / "ui_idle.xml")
            record_and_row(out_dir, {"scenario": args.label, "arm": args.arm, "rep": "", "send_info": send_info}, args.prompt, metrics, [])
    finally:
        # Keep IME disabled across the matrix; caller runs ime-on at the end.
        pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
