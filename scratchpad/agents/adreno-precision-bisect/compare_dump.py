#!/usr/bin/env python3
"""Compare llama-eval-callback tensor samples from CPU and OpenCL runs."""

import argparse
import math
import re
import sys
from pathlib import Path


HEADER = re.compile(r"^\s*common_debug_cb_eval:\s*(.*?)\s*=\s*\(([^)]*)\)\s*(.*)$")
NUMBER = re.compile(
    r"(?<![A-Za-z0-9_])(?:[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?|[-+]?(?:nan|inf))(?![A-Za-z0-9_])",
    re.IGNORECASE,
)


class AlignmentError(ValueError):
    pass


def parse_dump(path):
    events = []
    current = None
    for line_number, line in enumerate(Path(path).read_text(encoding="utf-8").splitlines(), 1):
        if line.lstrip().startswith("common_debug_cb_eval:"):
            if current is not None:
                events.append(current)
            match = HEADER.match(line)
            if match is None:
                raise ValueError(f"{path}:{line_number}: malformed common_debug_cb_eval header")
            body = match.group(3)
            op_match = re.match(r"([A-Za-z_][A-Za-z0-9_]*)\s*\(", body)
            shape_match = re.search(r"=\s*\{([^{}]*)\}\s*$", body)
            if op_match is None or shape_match is None:
                raise ValueError(f"{path}:{line_number}: missing op or result shape")
            shape = tuple(part.strip() for part in shape_match.group(1).split(",") if part.strip())
            current = {
                "name": match.group(1).strip(),
                "type": match.group(2).strip(),
                "op": op_match.group(1),
                "shape": shape,
                "values": [],
            }
        elif current is not None and "[" in line:
            current["values"].extend(float(item) for item in NUMBER.findall(line))
    if current is not None:
        events.append(current)
    if not events:
        raise ValueError(f"{path}: no common_debug_cb_eval tensors found")
    calls = {}
    for event in events:
        call = calls.get(event["name"], 0)
        event["call"] = call
        calls[event["name"]] = call + 1
    return events


def event_key(event):
    return event["name"], event["call"]


def align(cpu, gpu):
    if len(cpu) != len(gpu):
        raise AlignmentError(f"tensor count differs: CPU={len(cpu)} GPU={len(gpu)}")
    pairs = []
    for index, (left, right) in enumerate(zip(cpu, gpu)):
        if (event_key(left) != event_key(right) or left["type"] != right["type"] or
                left["op"] != right["op"] or left["shape"] != right["shape"]):
            raise AlignmentError(
                f"tensor {index} differs: CPU={event_key(left)} {left['type']} {left['op']} {left['shape']} "
                f"GPU={event_key(right)} {right['type']} {right['op']} {right['shape']}"
            )
        if len(left["values"]) != len(right["values"]):
            raise AlignmentError(f"tensor {index} sample count differs: CPU={len(left['values'])} GPU={len(right['values'])}")
        pairs.append((left, right))
    return pairs


def sample_stats(cpu, gpu):
    if not cpu["values"]:
        return "EMPTY", None, None
    if any(not math.isfinite(value) for value in cpu["values"] + gpu["values"]):
        return "NONFINITE", None, None
    delta = max(abs(right - left) for left, right in zip(cpu["values"], gpu["values"]))
    scale = max(abs(value) for value in cpu["values"]) + 1e-6
    return "OK", delta, delta / scale


def layer_number(name):
    numbers = re.findall(r"(?<![0-9])([0-9]+)(?![0-9])", name)
    return int(numbers[-1]) if numbers else None


def print_report(pairs):
    rows = []
    print("value_format=common_debug_cb_eval %12.4f; finite rel has an approximately 1e-4 display floor")
    print("index\tname\ttype\top\tshape\tabs_diff\trel\tstatus")
    for index, (cpu, gpu) in enumerate(pairs):
        status, abs_diff, rel = sample_stats(cpu, gpu)
        row = {"index": index, "name": cpu["name"], "type": cpu["type"], "op": cpu["op"], "shape": cpu["shape"], "status": status,
               "abs_diff": abs_diff, "rel": rel}
        rows.append(row)
        shape = "{" + ",".join(cpu["shape"]) + "}"
        abs_value = "EMPTY" if status == "EMPTY" else "NONFINITE" if status == "NONFINITE" else f"{abs_diff:.8g}"
        rel_value = status if status != "OK" else f"{rel:.8g}"
        print(f"{index}\t{cpu['name']}\t{cpu['type']}\t{cpu['op']}\t{shape}\tabs_diff={abs_value}\trel={rel_value}\t{status}")

    print("\n10 largest rel (NONFINITE sorts first)")
    def rank(row):
        if row["status"] == "NONFINITE":
            return (0, 0.0)
        if row["status"] == "OK":
            return (1, -row["rel"])
        return (2, 0.0)
    for row in sorted(rows, key=rank)[:10]:
        rel = row["status"] if row["status"] != "OK" else f"{row['rel']:.8g}"
        abs_diff = row["status"] if row["status"] != "OK" else f"{row['abs_diff']:.8g}"
        print(f"index={row['index']} name={row['name']} type={row['type']} op={row['op']} abs_diff={abs_diff} rel={rel} status={row['status']}")

    print("\nrunning maximum by layer")
    layer_max = {}
    for row in rows:
        layer = layer_number(row["name"])
        current = layer_max.get(layer)
        if row["status"] == "NONFINITE":
            layer_max[layer] = ("NONFINITE", None)
        elif row["status"] == "EMPTY" and current is None:
            layer_max[layer] = ("EMPTY", None)
        elif row["status"] == "OK" and (current is None or current[0] != "NONFINITE"):
            base = current[1] if current and current[0] == "OK" else 0.0
            layer_max[layer] = ("OK", max(base, row["rel"]))
    running = 0.0
    running_nonfinite = False
    for layer in sorted(layer_max, key=lambda value: (-1 if value is None else value)):
        status, value = layer_max[layer]
        running_nonfinite = running_nonfinite or status == "NONFINITE"
        if not running_nonfinite and status == "OK":
            running = max(running, value)
        label = "unlabeled" if layer is None else str(layer)
        layer_value = status if status != "OK" else f"{value:.8g}"
        running_value = "NONFINITE" if running_nonfinite else f"{running:.8g}"
        print(f"layer={label} max_rel={layer_value} running_max={running_value}")


def self_test():
    fixture_dir = Path(__file__).with_name("fixtures")
    cpu = parse_dump(fixture_dir / "cpu-basic.txt")
    gpu = parse_dump(fixture_dir / "gpu-basic.txt")
    pairs = align(cpu, gpu)
    assert len(pairs) == 3 and pairs[0][0]["call"] == 0 and pairs[1][0]["call"] == 1
    assert sample_stats(*pairs[0])[2] > 0.0
    special = align(parse_dump(fixture_dir / "cpu-special.txt"), parse_dump(fixture_dir / "gpu-special.txt"))
    assert sample_stats(*special[0])[0] == "NONFINITE"
    assert sample_stats(*special[1])[0] == "EMPTY"
    assert sample_stats(*special[2])[2] > 50.0 and sample_stats(*special[2])[1] == 0.0001
    try:
        align(cpu, parse_dump(fixture_dir / "gpu-mismatch.txt"))
    except AlignmentError:
        pass
    else:
        raise AssertionError("mismatched op sequence was accepted")
    print("self-test: ok")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--self-test", action="store_true")
    parser.add_argument("dumps", nargs="*")
    args = parser.parse_args()
    if args.self_test:
        self_test()
        return 0
    if len(args.dumps) != 2:
        parser.error("provide CPU and GPU dump paths")
    try:
        print_report(align(parse_dump(args.dumps[0]), parse_dump(args.dumps[1])))
    except AlignmentError as error:
        print(f"UNALIGNED: {error}")
        return 2
    except (OSError, ValueError) as error:
        print(f"PARSE_ERROR: {error}")
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
