#!/usr/bin/env python3
"""Compare llama-eval-callback tensor samples from CPU and OpenCL runs."""

import argparse
import math
import re
import sys
from pathlib import Path


HEADER = re.compile(r"^\s*ggml_debug:\s*(.*?)\s*=\s*\(([^)]*)\)\s*(.*)$")
NUMBER = re.compile(r"[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?")


class AlignmentError(ValueError):
    pass


def parse_dump(path):
    events = []
    current = None
    for line_number, line in enumerate(Path(path).read_text(encoding="utf-8").splitlines(), 1):
        if line.lstrip().startswith("ggml_debug:"):
            if current is not None:
                events.append(current)
            match = HEADER.match(line)
            if match is None:
                raise ValueError(f"{path}:{line_number}: malformed ggml_debug header")
            body = match.group(3)
            op_match = re.match(r"([A-Za-z_][A-Za-z0-9_]*)\s*\(", body)
            shape_match = re.search(r"=\s*\{([^{}]*)\}\s*$", body)
            if op_match is None or shape_match is None:
                raise ValueError(f"{path}:{line_number}: missing op or result shape")
            shape = tuple(part.strip() for part in shape_match.group(1).split(",") if part.strip())
            current = {
                "name": match.group(1).strip(),
                "op": op_match.group(1),
                "shape": shape,
                "values": [],
            }
        elif current is not None and "[" in line:
            current["values"].extend(float(item) for item in NUMBER.findall(line))
    if current is not None:
        events.append(current)
    if not events:
        raise ValueError(f"{path}: no ggml_debug tensors found")
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
        if event_key(left) != event_key(right) or left["op"] != right["op"] or left["shape"] != right["shape"]:
            raise AlignmentError(
                f"tensor {index} differs: CPU={event_key(left)} {left['op']} {left['shape']} "
                f"GPU={event_key(right)} {right['op']} {right['shape']}"
            )
        if len(left["values"]) != len(right["values"]):
            raise AlignmentError(f"tensor {index} sample count differs: CPU={len(left['values'])} GPU={len(right['values'])}")
        pairs.append((left, right))
    return pairs


def relative_error(cpu, gpu):
    if not cpu["values"]:
        return math.nan
    delta = max(abs(right - left) for left, right in zip(cpu["values"], gpu["values"]))
    scale = max(abs(value) for value in cpu["values"]) + 1e-6
    return delta / scale


def layer_number(name):
    numbers = re.findall(r"(?<![0-9])([0-9]+)(?![0-9])", name)
    return int(numbers[-1]) if numbers else None


def print_report(pairs):
    rows = []
    print("index\tname\top\tshape\trel")
    for index, (cpu, gpu) in enumerate(pairs):
        rel = relative_error(cpu, gpu)
        row = (index, cpu["name"], cpu["op"], cpu["shape"], rel)
        rows.append(row)
        shape = "{" + ",".join(cpu["shape"]) + "}"
        value = "nan" if math.isnan(rel) else f"{rel:.8g}"
        print(f"{index}\t{cpu['name']}\t{cpu['op']}\t{shape}\trel={value}")

    print("\n10 largest rel")
    ranked = sorted((row for row in rows if not math.isnan(row[4])), key=lambda row: row[4], reverse=True)[:10]
    for index, name, op, shape, rel in ranked:
        print(f"index={index} name={name} op={op} rel={rel:.8g}")

    print("\nrunning maximum by layer")
    layer_max = {}
    for row in rows:
        layer = layer_number(row[1])
        if not math.isnan(row[4]):
            layer_max[layer] = max(layer_max.get(layer, 0.0), row[4])
    running = 0.0
    for layer in sorted(layer_max, key=lambda value: (-1 if value is None else value)):
        running = max(running, layer_max[layer])
        label = "unlabeled" if layer is None else str(layer)
        print(f"layer={label} max_rel={layer_max[layer]:.8g} running_max={running:.8g}")


def self_test():
    fixture_dir = Path(__file__).with_name("fixtures")
    cpu = parse_dump(fixture_dir / "cpu-basic.txt")
    gpu = parse_dump(fixture_dir / "gpu-basic.txt")
    pairs = align(cpu, gpu)
    assert len(pairs) == 3 and pairs[0][0]["call"] == 0 and pairs[1][0]["call"] == 1
    assert relative_error(*pairs[0]) > 0.0
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
