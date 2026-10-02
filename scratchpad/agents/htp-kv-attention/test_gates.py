"""Phone gate parsing and order, on saved dumpsys probe fixtures."""

from pathlib import Path

import gates

HERE = Path(__file__).parent


def snap_of(name):
    return gates.parse_probe((HERE / "fixtures" / name).read_text())


def test_s23_ok_passes_every_gate():
    snap = snap_of("probe-s23-ok.txt")
    assert snap["probe_ok"]
    assert snap["plug"] == {"AC": "false", "USB": "false", "Wireless": "false"}
    assert snap["battery_level"] == "87"
    assert snap["battery_temp_c"] == "31.2"
    assert snap["thermal_status"] == "0"
    assert snap["awake"] and snap["traced"] == "0"
    assert snap["model"] == "SM-S911U" and snap["soc"] == "SM8550"
    assert gates.gate_reason(snap, "phone-serial") is None


def test_charging_is_reported_before_low_battery():
    # USB powered AND 19%: the powered gate is checked first (spec order).
    snap = snap_of("probe-s23-charging-lowbatt.txt")
    assert gates.gate_reason(snap, "phone-serial") == "battery powered (USB)"


def test_low_battery_stops():
    snap = snap_of("probe-xiaomi-lowbatt.txt")
    assert gates.gate_reason(snap, "phone-serial") == "battery 19% < 25"


def test_hot_battery_stops():
    snap = snap_of("probe-s23-hotbattery.txt")
    assert "battery temp 45.6C >= 44" in gates.gate_reason(snap, "phone-serial")


def test_thermal_status_3_stops():
    snap = snap_of("probe-s23-thermal3.txt")
    assert gates.gate_reason(snap, "phone-serial") == "android_thermal_status=3"


def test_asleep_stops_and_traced_is_ignored_off_s23():
    snap = snap_of("probe-xiaomi-asleep.txt")
    assert snap["awake"] is False and snap["traced"] == "1"
    assert gates.gate_reason(snap, "phone-serial") == "screen asleep"


def test_traced_gate_applies_to_s23_only():
    snap = snap_of("probe-s23-traced.txt")
    assert gates.gate_reason(snap, "phone-serial") == "persist.traced.enable=1"
    xiaomi = snap_of("probe-xiaomi-asleep.txt")
    xiaomi["awake"] = True
    assert gates.gate_reason(xiaomi, "phone-serial") is None


def test_truncated_probe_fails_closed():
    snap = gates.parse_probe("===BATTERY===\n  level: 80\n")
    assert not snap["probe_ok"]
    assert gates.gate_reason(snap, "phone-serial") == \
        "probe-failed (no battery/thermal sections)"


def test_gate_list_order_matches_spec():
    assert gates.gate_list("phone-serial") == [
        "probe_ok", "not_powered(AC/USB/Wireless)", "battery>=25%",
        "battery_temp<44C", "thermal_status<3", "awake(mWakefulness)",
        "traced==0(SM-S911x only)"]
    assert gates.gate_list("qrd-tunnel") == [
        "probe_ok", "thermal_status<3", "skin<50C"]


def test_route_proof_needs_kv_on_the_intended_side():
    cpu_kv = ("HTP0 model buffer size HTP0 execute-op libggml-htp-v73.so "
              "CPU KV buffer size")
    htp_kv = cpu_kv.replace("CPU", "HTP0")
    assert gates.route_proved(cpu_kv, "v73", 1)
    assert not gates.route_proved(htp_kv, "v73", 1)
    assert gates.route_proved(htp_kv, "v73", 0)
    assert not gates.route_proved(cpu_kv, "v73", 0)
    assert not gates.route_proved("HTP0 model buffer size", "v73", 1)
