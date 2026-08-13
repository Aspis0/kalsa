"""SELFSPEC F0 scoring helpers. No model I/O. English identifiers."""

from __future__ import annotations

import csv
import json
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any, Callable, Iterable


PROMPT_IDS = ("fact", "creative", "longfact", "code")

PROMPT_SHA256 = {
    "fact": "b5301c32c0bd8aae4cf5c25d667a52eef05b940a459a2e9c82b1b6134cf0dcbd",
    "creative": "761db0d07cbc312acb35fb8c64894be83f38a3a7f0ba14e2100ef6a44a29c871",
    "longfact": "24694e05189a25581384e9ab3dd6e80e92bdacf728a1a33c2a5e5f4cd3524f37",
    "code": "fc9467a37f595de422ec3255a4b0bb48586da741a0fad0d207a66a35569dbaa8",
}

METHOD_EXACT = "EXACT-RESTART"
METHOD_W16 = "WINDOWED-W16"
JOIN_OK = ""
JOIN_MISALIGN = "JOIN_MISALIGN"
JOIN_RESET = "RESET"

# Device numbers already on disk — not PC measurements.
# reports/moe-adopt-kexp.md:59  (S23 CPU k6d065 cache-2000 median tok/s)
DEVICE_CPU_K6_CACHE2000 = 5.861
# reports/moe-k4-split.md:311  (S23 CPU k6 cache-1000 N3 median tok/s)
DEVICE_CPU_K6_CACHE1000 = 2.901
# reports/moe-k4-split.md:311  (S23 GPU-split k6 cache-1000 median tok/s)
DEVICE_GPU_SPLIT_K6 = 2.025

GATE_ALPHA = 0.60
EARLY_POOR_ALPHA = 0.50


@dataclass
class RestartResult:
    pieces: list[str]
    n_prompt: int
    done: dict[str, Any] = field(default_factory=dict)
    raw_lines: list[str] = field(default_factory=list)
    reset: bool = False


@dataclass
class AcceptRow:
    prompt: str
    k_draft: int
    drop: float
    pos: int
    accept: int
    restart_id: int
    n_prompt: int
    draft_piece: str
    gold_piece: str
    join_flag: str
    method: str
    window: int

    def gate_eligible(self) -> bool:
        return self.join_flag not in (JOIN_MISALIGN, JOIN_RESET)


GenerateFn = Callable[[str, int], RestartResult]


def match_prefix(draft: list[str], gold: list[str]) -> int:
    n = min(len(draft), len(gold))
    i = 0
    while i < n and draft[i] == gold[i]:
        i += 1
    return i


def join_flag(
    n_prompt: int, n_prompt_0: int, t: int, prev_n_prompt: int | None, slack: int = 8
) -> str:
    """Flag retokenize mis-join. METHOD_PLAN.md:163-169."""
    if n_prompt < n_prompt_0 - 2:
        return JOIN_MISALIGN
    if n_prompt > n_prompt_0 + t + slack:
        return JOIN_MISALIGN
    if prev_n_prompt is not None and n_prompt < prev_n_prompt:
        return JOIN_MISALIGN
    return JOIN_OK


def expected_tokens_per_step(alpha: float, gamma: int) -> float:
    if gamma < 1:
        raise ValueError("gamma must be >= 1")
    if alpha < 0.0 or alpha > 1.0:
        raise ValueError("alpha must be in [0, 1]")
    if alpha == 1.0:
        return float(gamma + 1)
    return (1.0 - alpha ** (gamma + 1)) / (1.0 - alpha)


def mtp_style_rate(alpha: float, gamma: int) -> float:
    """E[accepted drafts] / gamma under independence. Not the bonus-token formula."""
    if gamma < 1:
        raise ValueError("gamma must be >= 1")
    if alpha < 0.0 or alpha > 1.0:
        raise ValueError("alpha must be in [0, 1]")
    if alpha == 1.0:
        return 1.0
    accepted = alpha * (1.0 - alpha**gamma) / (1.0 - alpha)
    return accepted / float(gamma)


def consecutive_prefix(accepts: list[int], start: int, gamma: int) -> int:
    n = 0
    end = min(len(accepts), start + gamma)
    for i in range(start, end):
        if accepts[i] != 1:
            break
        n += 1
    return n


def gamma_empirical(accepts: list[int], gamma: int) -> dict[str, Any]:
    """Prefix-accept stats for speculative windows starting at every measured index."""
    starts = list(range(len(accepts)))
    prefixes: list[int] = []
    drafted = 0
    accepted = 0
    full = 0
    usable = 0
    for t in starts:
        remain = len(accepts) - t
        g = min(gamma, remain)
        if g < 1:
            continue
        pref = consecutive_prefix(accepts, t, g)
        prefixes.append(pref)
        drafted += g
        accepted += pref
        if remain >= gamma and pref == gamma:
            full += 1
        if remain >= gamma:
            usable += 1
    return {
        "gamma": gamma,
        "n_starts": len(prefixes),
        "n_full_starts": usable,
        "n_drafted": drafted,
        "n_accepted": accepted,
        "accept_rate": (accepted / drafted) if drafted else None,
        "full_window_rate": (full / usable) if usable else None,
        "mean_accepted_prefix": (sum(prefixes) / len(prefixes)) if prefixes else None,
        "mean_accepted_prefix_fullstarts": (
            sum(
                consecutive_prefix(accepts, t, gamma)
                for t in range(len(accepts) - gamma + 1)
            )
            / usable
            if usable
            else None
        ),
        "e_tokens_per_step_independence": None,
    }


def position_buckets(
    rows: Iterable[AcceptRow], width: int = 50
) -> list[dict[str, Any]]:
    buckets: dict[int, list[int]] = {}
    for r in rows:
        if not r.gate_eligible():
            continue
        b = (r.pos // width) * width
        buckets.setdefault(b, []).append(r.accept)
    out = []
    for start in sorted(buckets):
        xs = buckets[start]
        out.append(
            {
                "lo": start,
                "hi": start + width - 1,
                "n": len(xs),
                "accepted": sum(xs),
                "rate": (sum(xs) / len(xs)) if xs else None,
            }
        )
    return out


def pooled_alpha(rows: Iterable[AcceptRow]) -> dict[str, Any]:
    xs = [r.accept for r in rows if r.gate_eligible()]
    n = len(xs)
    acc = sum(xs)
    return {
        "n_positions": n,
        "n_accepted": acc,
        "n_excluded_join": 0,
        "alpha": (acc / n) if n else None,
    }


def score_exact_restart(
    prompt_id: str,
    prompt: str,
    gold_pieces: list[str],
    k_draft: int,
    drop: float,
    generate_fn: GenerateFn,
    n_prompt_0: int | None = None,
    explode_restarts: int = 24,
    explode_alpha: float = 0.45,
    explode_remain: int = 32,
    window: int = 16,
    slack: int = 8,
    start_t: int = 0,
    start_rows: list[AcceptRow] | None = None,
    start_restart_id: int = 0,
    start_method: str = METHOD_EXACT,
    start_prev_np: int | None = None,
    on_update: Callable[[list[AcceptRow], int], None] | None = None,
) -> list[AcceptRow]:
    """Teacher-force by restart-after-mismatch. Falls back to WINDOWED-W16 if cost explodes."""
    rows: list[AcceptRow] = list(start_rows or [])
    t = start_t
    restart_id = start_restart_id
    prev_np: int | None = start_prev_np
    np0 = n_prompt_0
    method = start_method
    n_gold = len(gold_pieces)

    while t < n_gold:
        if method == METHOD_EXACT:
            n_done = sum(
                1 for r in rows if r.method == METHOD_EXACT and r.gate_eligible()
            )
            n_acc = sum(
                r.accept for r in rows if r.method == METHOD_EXACT and r.gate_eligible()
            )
            remain = n_gold - t
            alpha_so_far = (n_acc / n_done) if n_done else 1.0
            if (
                restart_id >= explode_restarts
                and n_done >= 16
                and alpha_so_far < explode_alpha
                and remain >= explode_remain
            ):
                method = METHOD_W16
                continue

        if method == METHOD_W16:
            if t % window != 0:
                t = ((t // window) + 1) * window
                if t >= n_gold:
                    break
            n_pred = min(window, n_gold - t)
        else:
            n_pred = n_gold - t

        prefix = prompt + "".join(gold_pieces[:t])
        result = generate_fn(prefix, n_pred)
        if np0 is None:
            np0 = result.n_prompt
        flag = join_flag(result.n_prompt, np0, t, prev_n_prompt=prev_np, slack=slack)
        if result.reset:
            flag = JOIN_RESET if flag == JOIN_OK else flag
        prev_np = result.n_prompt

        gold_tail = gold_pieces[t:]
        m = match_prefix(result.pieces, gold_tail)
        win = 0 if method == METHOD_EXACT else window

        for i in range(m):
            rows.append(
                AcceptRow(
                    prompt=prompt_id,
                    k_draft=k_draft,
                    drop=drop,
                    pos=t + i,
                    accept=1,
                    restart_id=restart_id,
                    n_prompt=result.n_prompt,
                    draft_piece=result.pieces[i],
                    gold_piece=gold_tail[i],
                    join_flag=flag,
                    method=method,
                    window=win,
                )
            )

        next_t: int
        if method == METHOD_EXACT:
            if t + m < n_gold:
                draft_miss = result.pieces[m] if m < len(result.pieces) else ""
                rows.append(
                    AcceptRow(
                        prompt=prompt_id,
                        k_draft=k_draft,
                        drop=drop,
                        pos=t + m,
                        accept=0,
                        restart_id=restart_id,
                        n_prompt=result.n_prompt,
                        draft_piece=draft_miss,
                        gold_piece=gold_tail[m],
                        join_flag=flag,
                        method=method,
                        window=win,
                    )
                )
                next_t = t + m + 1
            else:
                next_t = n_gold
        else:
            # Windowed: first mismatch is a measured reject; later window slots are unmeasured.
            if t + m < t + n_pred:
                draft_miss = result.pieces[m] if m < len(result.pieces) else ""
                rows.append(
                    AcceptRow(
                        prompt=prompt_id,
                        k_draft=k_draft,
                        drop=drop,
                        pos=t + m,
                        accept=0,
                        restart_id=restart_id,
                        n_prompt=result.n_prompt,
                        draft_piece=draft_miss,
                        gold_piece=gold_tail[m],
                        join_flag=flag,
                        method=method,
                        window=win,
                    )
                )
            next_t = t + window

        restart_id += 1
        t = next_t
        if on_update is not None:
            on_update(rows, t)

    return rows


def parse_bmoe_json_line(line: str) -> tuple[str, dict[str, Any]] | None:
    raw = line.strip()
    if not raw.startswith("BMOE_"):
        return None
    space = raw.find(" ")
    if space < 0:
        return None
    tag = raw[:space]
    blob = raw[space + 1 :].strip()
    if not blob.startswith("{"):
        return None
    try:
        obj = json.loads(blob)
    except json.JSONDecodeError:
        return None
    if not isinstance(obj, dict):
        return None
    return tag, obj


def pieces_from_progress(lines: Iterable[str]) -> tuple[list[str], bool]:
    pieces: list[str] = []
    reset = False
    for line in lines:
        parsed = parse_bmoe_json_line(line)
        if parsed is None:
            continue
        tag, obj = parsed
        if tag != "BMOE_PROGRESS":
            continue
        delta = obj.get("delta_text", "")
        if not isinstance(delta, str):
            delta = ""
        if obj.get("reset") == 1:
            reset = True
            pieces = [delta] if delta else []
        else:
            pieces.append(delta)
    return pieces, reset


def extract_done(
    lines: Iterable[str], req_id: int | None = None
) -> dict[str, Any] | None:
    last = None
    for line in lines:
        parsed = parse_bmoe_json_line(line)
        if parsed is None:
            continue
        tag, obj = parsed
        if tag != "BMOE_DONE":
            continue
        if req_id is not None and int(obj.get("id", -1)) != req_id:
            continue
        last = obj
    return last


def write_detail_csv(path: Path, rows: list[AcceptRow]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fields = [
        "pos",
        "accepted",
        "restart_id",
        "n_prompt",
        "draft_piece",
        "gold_piece",
        "join_flag",
        "method",
        "window",
    ]
    with path.open("w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fields, extrasaction="ignore")
        w.writeheader()
        for r in rows:
            w.writerow(
                {
                    "pos": r.pos,
                    "accepted": r.accept,
                    "restart_id": r.restart_id,
                    "n_prompt": r.n_prompt,
                    "draft_piece": r.draft_piece.replace("\n", "\\n"),
                    "gold_piece": r.gold_piece.replace("\n", "\\n"),
                    "join_flag": r.join_flag,
                    "method": r.method,
                    "window": r.window,
                }
            )


def write_acceptance_csv(path: Path, rows: list[AcceptRow]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fields = [
        "prompt",
        "k_draft",
        "drop",
        "pos",
        "accept",
        "method",
        "window",
        "join_flag",
    ]
    with path.open("w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fields)
        w.writeheader()
        for r in rows:
            w.writerow(
                {
                    "prompt": r.prompt,
                    "k_draft": r.k_draft,
                    "drop": r.drop,
                    "pos": r.pos,
                    "accept": r.accept,
                    "method": r.method,
                    "window": r.window,
                    "join_flag": r.join_flag,
                }
            )


def summarize_rows(
    rows: list[AcceptRow],
    *,
    pc_k2_toks: float | None,
    pc_k6_toks: float | None,
    pc_speed_n: int | None,
    pc_speed_prompt: str | None,
    notes: dict[str, Any],
) -> dict[str, Any]:
    excluded = [r for r in rows if not r.gate_eligible()]
    eligible = [r for r in rows if r.gate_eligible()]

    def pack(subset: list[AcceptRow]) -> dict[str, Any]:
        acc = [r.accept for r in subset]
        methods = sorted({r.method for r in subset})
        gtab = {}
        alpha = (sum(acc) / len(acc)) if acc else None
        for g in range(2, 7):
            emp = gamma_empirical(acc, g)
            emp["e_tokens_per_step_independence"] = (
                expected_tokens_per_step(alpha, g) if alpha is not None else None
            )
            emp["mtp_style_rate_independence"] = (
                mtp_style_rate(alpha, g) if alpha is not None else None
            )
            gtab[str(g)] = emp
        return {
            "n_positions": len(acc),
            "n_accepted": sum(acc),
            "alpha": alpha,
            "methods": methods,
            "vs_position": position_buckets(subset),
            "gamma": gtab,
        }

    per_prompt: dict[str, Any] = {}
    for pid in PROMPT_IDS:
        for k in sorted({r.k_draft for r in rows}):
            for d in sorted({r.drop for r in rows}):
                sub = [
                    r
                    for r in eligible
                    if r.prompt == pid and r.k_draft == k and r.drop == d
                ]
                if not sub:
                    continue
                per_prompt.setdefault(pid, {})[f"k{k}_d{d:g}"] = pack(sub)

    pooled: dict[str, Any] = {}
    for k in sorted({r.k_draft for r in eligible}):
        for d in sorted({r.drop for r in eligible}):
            sub = [r for r in eligible if r.k_draft == k and r.drop == d]
            if not sub:
                continue
            pooled[f"k{k}_d{d:g}"] = pack(sub)

    primary = pooled.get("k2_d0.65")
    primary_alpha = primary["alpha"] if primary else None
    primary_n = primary["n_positions"] if primary else 0
    mtp4 = None
    if primary and primary_alpha is not None:
        mtp4 = primary["gamma"]["4"]["accept_rate"]

    gate_pass = bool(primary_alpha is not None and primary_alpha >= GATE_ALPHA)
    verdict = "PASS_LANE_OPEN" if gate_pass else "SELFSPEC_DEAD"

    ratio = None
    if pc_k2_toks and pc_k6_toks and pc_k6_toks > 0:
        ratio = pc_k2_toks / pc_k6_toks

    def standin_speed(device_k6: float, label: str) -> dict[str, Any]:
        out: dict[str, Any] = {
            "label": label,
            "device_k6_toks": device_k6,
            "stand_in": True,
            "note": (
                "t_verify is (gamma+1)*t_k6 and t_draft is gamma*t_k2; "
                "no batched verify exists yet. Device k2 uses PC k2/k6 ratio; "
                "device ratios will differ (mandates/selfspec-f0-acceptance.md:27-28)."
            ),
            "by_gamma": {},
        }
        if primary_alpha is None:
            return out
        t_k6 = 1.0 / device_k6
        t_k2 = None
        if ratio is not None:
            device_k2 = device_k6 * ratio
            t_k2 = 1.0 / device_k2 if device_k2 > 0 else None
            out["device_k2_toks_from_pc_ratio"] = device_k2
        elif pc_k2_toks and pc_k2_toks > 0:
            t_k2 = 1.0 / pc_k2_toks
        for g in range(2, 7):
            e_tok = expected_tokens_per_step(primary_alpha, g)
            rec: dict[str, Any] = {
                "E_tokens_per_step": e_tok,
                "formula": "(1-alpha**(gamma+1))/(1-alpha)",
            }
            if t_k2 is not None:
                t_step = g * t_k2 + (g + 1) * t_k6
                rec["t_step_s"] = t_step
                rec["E_tok_s"] = e_tok / t_step if t_step > 0 else None
                rec["baseline_k6_tok_s"] = device_k6
                rec["speedup_vs_k6"] = (
                    (e_tok / t_step) / device_k6 if t_step > 0 else None
                )
            out["by_gamma"][str(g)] = rec
        return out

    pc_model: dict[str, Any] | None = None
    if pc_k2_toks and pc_k6_toks and primary_alpha is not None:
        t_k2 = 1.0 / pc_k2_toks
        t_k6 = 1.0 / pc_k6_toks
        by_gamma: dict[str, Any] = {}
        for g in range(2, 7):
            e_tok = expected_tokens_per_step(primary_alpha, g)
            t_step = g * t_k2 + (g + 1) * t_k6
            by_gamma[str(g)] = {
                "E_tokens_per_step": e_tok,
                "t_step_s": t_step,
                "E_tok_s": e_tok / t_step,
                "speedup_vs_k6": (e_tok / t_step) / pc_k6_toks,
            }
        pc_model = {
            "stand_in": True,
            "pc_k2_toks": pc_k2_toks,
            "pc_k6_toks": pc_k6_toks,
            "pc_k2_over_k6": ratio,
            "n": pc_speed_n,
            "prompt": pc_speed_prompt,
            "by_gamma": by_gamma,
        }

    return {
        "n_rows_total": len(rows),
        "n_excluded_join_or_reset": len(excluded),
        "per_prompt": per_prompt,
        "pooled": pooled,
        "primary_key": "k2_d0.65",
        "primary_alpha": primary_alpha,
        "primary_n_positions": primary_n,
        "primary_mtp_style_accept_rate_gamma4": mtp4,
        "gate": {
            "rule": "pooled teacher-forced token acceptance (k=2 drop 0.65) >= 0.60",
            "source": "mandates/selfspec-f0-acceptance.md:29-30",
            "alpha_threshold": GATE_ALPHA,
            "pass": gate_pass,
            "stricter_full_window_note": (
                "P(all 4 draft tokens accepted) >= 0.60 would need alpha ~>= 0.88 "
                "under independence (METHOD_PLAN.md:239-241). Not the primary gate."
            ),
            "mtp_style_note": (
                "Engine --mtp reports mtp_accepted/mtp_drafted "
                "(BigMoeOnEdge/docs/telemetry.md:145-147,458-459). "
                "Independence MTP-style at gamma=4 is mtp_style_rate_independence in gamma.4."
            ),
        },
        "verdict": verdict,
        "pc_speed": {
            "k2_toks": pc_k2_toks,
            "k6_toks": pc_k6_toks,
            "ratio_k2_over_k6": ratio,
            "n": pc_speed_n,
            "prompt": pc_speed_prompt,
        },
        "speedup_model": {
            "pc": pc_model,
            "device_cpu_k6_cache2000": standin_speed(
                DEVICE_CPU_K6_CACHE2000,
                "S23 CPU k6d065 cache-2000 (reports/moe-adopt-kexp.md:59)",
            ),
            "device_cpu_k6_cache1000": standin_speed(
                DEVICE_CPU_K6_CACHE1000,
                "S23 CPU k6 cache-1000 (reports/moe-k4-split.md:311)",
            ),
            "device_gpu_split_k6": standin_speed(
                DEVICE_GPU_SPLIT_K6,
                "S23 GPU-split k6 cache-1000 (reports/moe-k4-split.md:311)",
            ),
        },
        "notes": notes,
    }


def dump_json(path: Path, obj: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(obj, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )


def row_to_dict(r: AcceptRow) -> dict[str, Any]:
    return asdict(r)
