"""Unit tests for SELFSPEC F0 scoring. No model, no network."""

from __future__ import annotations

import unittest
from pathlib import Path
import tempfile

from selfspec_f0_lib import (
    GATE_ALPHA,
    METHOD_EXACT,
    METHOD_W16,
    JOIN_MISALIGN,
    AcceptRow,
    RestartResult,
    expected_tokens_per_step,
    extract_done,
    gamma_empirical,
    join_flag,
    match_prefix,
    mtp_style_rate,
    parse_bmoe_json_line,
    pieces_from_progress,
    score_exact_restart,
    summarize_rows,
    write_acceptance_csv,
)


class MatchPrefixTests(unittest.TestCase):
    def test_full_match(self) -> None:
        self.assertEqual(match_prefix(["a", "b"], ["a", "b"]), 2)

    def test_partial(self) -> None:
        self.assertEqual(match_prefix(["a", "x", "c"], ["a", "b", "c"]), 1)

    def test_empty_draft(self) -> None:
        self.assertEqual(match_prefix([], ["a"]), 0)

    def test_draft_longer(self) -> None:
        self.assertEqual(match_prefix(["a", "b", "c"], ["a", "b"]), 2)


class JoinFlagTests(unittest.TestCase):
    def test_ok_monotone(self) -> None:
        self.assertEqual(join_flag(20, 10, 10, 15), "")

    def test_jump_too_far(self) -> None:
        self.assertEqual(join_flag(40, 10, 5, 12), JOIN_MISALIGN)

    def test_not_monotone(self) -> None:
        self.assertEqual(join_flag(12, 10, 5, 14), JOIN_MISALIGN)

    def test_below_base(self) -> None:
        self.assertEqual(join_flag(5, 10, 3, 10), JOIN_MISALIGN)


class FormulaTests(unittest.TestCase):
    def test_alpha_half_gamma2(self) -> None:
        self.assertAlmostEqual(expected_tokens_per_step(0.5, 2), 1.75)

    def test_alpha_one(self) -> None:
        self.assertEqual(expected_tokens_per_step(1.0, 4), 5.0)

    def test_mtp_style_alpha06_g4(self) -> None:
        # (0.6+0.36+0.216+0.1296)/4 = 1.3056/4
        self.assertAlmostEqual(mtp_style_rate(0.6, 4), 1.3056 / 4)

    def test_rejects_bad_alpha(self) -> None:
        with self.assertRaises(ValueError):
            expected_tokens_per_step(1.1, 2)


class GammaEmpiricalTests(unittest.TestCase):
    def test_all_accept(self) -> None:
        acc = [1, 1, 1, 1]
        g = gamma_empirical(acc, 2)
        self.assertEqual(g["n_accepted"], 2 + 2 + 2 + 1)
        self.assertEqual(g["full_window_rate"], 1.0)

    def test_first_reject_stops_prefix(self) -> None:
        acc = [1, 0, 1]
        g = gamma_empirical(acc, 2)
        self.assertEqual(g["n_accepted"], 1 + 0 + 1)


class ExactRestartTests(unittest.TestCase):
    def test_mismatch_then_force(self) -> None:
        gold = ["A", "B", "C", "D"]
        prompt = "Q"

        def gen(prefix: str, n_predict: int) -> RestartResult:
            if prefix == "Q":
                return RestartResult(pieces=["A", "B", "X"], n_prompt=4)
            if prefix == "QABC":
                return RestartResult(pieces=["D"], n_prompt=7)
            raise AssertionError(f"unexpected prefix {prefix!r} n={n_predict}")

        rows = score_exact_restart("fact", prompt, gold, 2, 0.65, gen, n_prompt_0=4)
        self.assertEqual([r.pos for r in rows], [0, 1, 2, 3])
        self.assertEqual([r.accept for r in rows], [1, 1, 0, 1])
        self.assertTrue(all(r.method == METHOD_EXACT for r in rows))
        self.assertEqual(rows[2].draft_piece, "X")
        self.assertEqual(rows[2].gold_piece, "C")

    def test_all_match_one_call(self) -> None:
        gold = ["A", "B"]

        def gen(prefix: str, n_predict: int) -> RestartResult:
            self.assertEqual(prefix, "P")
            return RestartResult(pieces=["A", "B"], n_prompt=3)

        rows = score_exact_restart("x", "P", gold, 2, 0.0, gen, n_prompt_0=3)
        self.assertEqual([r.accept for r in rows], [1, 1])
        self.assertEqual(len({r.restart_id for r in rows}), 1)

    def test_empty_draft_is_reject(self) -> None:
        gold = ["A", "B"]

        def gen(prefix: str, n_predict: int) -> RestartResult:
            if prefix == "P":
                return RestartResult(pieces=[], n_prompt=2)
            if prefix == "PA":
                return RestartResult(pieces=["B"], n_prompt=3)
            raise AssertionError(prefix)

        rows = score_exact_restart("x", "P", gold, 2, 0.65, gen, n_prompt_0=2)
        self.assertEqual([r.accept for r in rows], [0, 1])
        self.assertEqual(rows[0].draft_piece, "")

    def test_resume_skips_done_prefix(self) -> None:
        gold = ["A", "B", "C"]
        calls: list[str] = []

        def gen(prefix: str, n_predict: int) -> RestartResult:
            calls.append(prefix)
            return RestartResult(pieces=["C"], n_prompt=5)

        prior = [
            AcceptRow(
                prompt="x",
                k_draft=2,
                drop=0.65,
                pos=0,
                accept=1,
                restart_id=0,
                n_prompt=3,
                draft_piece="A",
                gold_piece="A",
                join_flag="",
                method=METHOD_EXACT,
                window=0,
            ),
            AcceptRow(
                prompt="x",
                k_draft=2,
                drop=0.65,
                pos=1,
                accept=0,
                restart_id=0,
                n_prompt=3,
                draft_piece="Z",
                gold_piece="B",
                join_flag="",
                method=METHOD_EXACT,
                window=0,
            ),
        ]
        rows = score_exact_restart(
            "x",
            "P",
            gold,
            2,
            0.65,
            gen,
            n_prompt_0=3,
            start_t=2,
            start_rows=prior,
            start_restart_id=1,
        )
        self.assertEqual(calls, ["PAB"])
        self.assertEqual([r.accept for r in rows], [1, 0, 1])

    def test_explode_switches_to_windowed(self) -> None:
        gold = [f"t{i}" for i in range(48)]

        def gen(prefix: str, n_predict: int) -> RestartResult:
            # Always emit a wrong first piece so EXACT would restart every token.
            return RestartResult(pieces=["NO"], n_prompt=10)

        rows = score_exact_restart(
            "x",
            "P",
            gold,
            2,
            0.65,
            gen,
            n_prompt_0=10,
            explode_restarts=4,
            explode_alpha=0.50,
            explode_remain=8,
            window=16,
        )
        methods = {r.method for r in rows}
        self.assertIn(METHOD_EXACT, methods)
        self.assertIn(METHOD_W16, methods)
        wrows = [r for r in rows if r.method == METHOD_W16]
        self.assertTrue(all(r.window == 16 for r in wrows))
        # Windowed starts at 0/16/32 after the switch; rejects are measured, rest unmeasured.
        self.assertLess(len(rows), len(gold))


class ProgressParseTests(unittest.TestCase):
    def test_pieces_and_done(self) -> None:
        lines = [
            'BMOE_BEGIN {"id":3}',
            'BMOE_PROGRESS {"step":1,"steps":2,"wall_ms":1.0,"io_ms":0.0,"compute_ms":1.0,'
            '"mgmt_ms":0.0,"stall_ms":0.0,"read_mb":0.00,"cache_hit_pct":0.0,"majflt":0,'
            '"cpu_ms":0.0,"dense_resident_frac":-1.000,"delta_reasoning":"","delta_text":"Hel"}',
            'BMOE_PROGRESS {"step":2,"steps":2,"wall_ms":1.0,"io_ms":0.0,"compute_ms":1.0,'
            '"mgmt_ms":0.0,"stall_ms":0.0,"read_mb":0.00,"cache_hit_pct":0.0,"majflt":0,'
            '"cpu_ms":0.0,"dense_resident_frac":-1.000,"delta_reasoning":"","delta_text":"lo"}',
            'BMOE_DONE {"id":3,"cancelled":false,"tokens":2,"tok_s":1.5,"prefill_s":0.2,'
            '"prefill_tps":10.00,"load_s":1.0,"cache_hit_pct":0.0,"n_prompt":8,"n_past":10,'
            '"compute_s_tok":0.0,"io_s_tok":0.0,"cache_resident_mib":0,"cache_budget_mib":2000,'
            '"read_mib":0.0,"stall_s_tok":0.0,"mgmt_s_tok":0.0,"majflt_tok":0.00,"cpu_s_tok":0.0,'
            '"token_demand_mib":0.0,"mtp_drafted":0,"mtp_accepted":0,"mtp_decodes":0,'
            '"mtp_draft_s_tok":0.0,"drafted_steps":0,"loop_overhead_s_tok":0.0,'
            '"reasoning":"","text":"Hello"}',
        ]
        pieces, reset = pieces_from_progress(lines)
        self.assertEqual(pieces, ["Hel", "lo"])
        self.assertFalse(reset)
        done = extract_done(lines, 3)
        assert done is not None
        self.assertEqual(done["n_prompt"], 8)
        self.assertEqual(done["text"], "Hello")

    def test_reset_flag(self) -> None:
        lines = [
            'BMOE_PROGRESS {"step":1,"delta_reasoning":"","delta_text":"aa","reset":1}',
        ]
        pieces, reset = pieces_from_progress(lines)
        self.assertTrue(reset)
        self.assertEqual(pieces, ["aa"])

    def test_garbage_ignored(self) -> None:
        self.assertIsNone(parse_bmoe_json_line("hello"))
        self.assertIsNone(parse_bmoe_json_line("BMOE_DONE not-json"))


class SummaryGateTests(unittest.TestCase):
    def _rows(self, accepts: list[int], drop: float = 0.65) -> list[AcceptRow]:
        out = []
        for i, a in enumerate(accepts):
            out.append(
                AcceptRow(
                    prompt="fact",
                    k_draft=2,
                    drop=drop,
                    pos=i,
                    accept=a,
                    restart_id=0,
                    n_prompt=10,
                    draft_piece="d",
                    gold_piece="g",
                    join_flag="",
                    method=METHOD_EXACT,
                    window=0,
                )
            )
        return out

    def test_pass_at_60(self) -> None:
        rows = self._rows([1] * 6 + [0] * 4)
        s = summarize_rows(
            rows,
            pc_k2_toks=10.0,
            pc_k6_toks=5.0,
            pc_speed_n=128,
            pc_speed_prompt="longfact",
            notes={},
        )
        self.assertEqual(s["primary_alpha"], 0.6)
        self.assertTrue(s["gate"]["pass"])
        self.assertEqual(s["verdict"], "PASS_LANE_OPEN")
        self.assertGreater(
            s["speedup_model"]["pc"]["by_gamma"]["4"]["E_tokens_per_step"], 1.0
        )

    def test_dead_below_60(self) -> None:
        rows = self._rows([1] * 5 + [0] * 5)
        s = summarize_rows(
            rows,
            pc_k2_toks=None,
            pc_k6_toks=None,
            pc_speed_n=None,
            pc_speed_prompt=None,
            notes={},
        )
        self.assertEqual(s["verdict"], "SELFSPEC_DEAD")
        self.assertFalse(s["gate"]["pass"])
        self.assertGreaterEqual(GATE_ALPHA, 0.60)

    def test_join_excluded_from_gate(self) -> None:
        rows = self._rows([1, 1, 1])
        rows[1].join_flag = JOIN_MISALIGN
        s = summarize_rows(
            rows,
            pc_k2_toks=None,
            pc_k6_toks=None,
            pc_speed_n=None,
            pc_speed_prompt=None,
            notes={},
        )
        self.assertEqual(s["primary_n_positions"], 2)
        self.assertEqual(s["n_excluded_join_or_reset"], 1)

    def test_csv_has_window_label(self) -> None:
        rows = self._rows([1, 0])
        rows[1].method = METHOD_W16
        rows[1].window = 16
        with tempfile.TemporaryDirectory() as td:
            p = Path(td) / "acceptance.csv"
            write_acceptance_csv(p, rows)
            text = p.read_text(encoding="utf-8")
            self.assertIn("method,window", text)
            self.assertIn("WINDOWED-W16,16", text)


class SpeedupStandInTests(unittest.TestCase):
    def test_device_sources_present(self) -> None:
        rows = [
            AcceptRow(
                prompt="fact",
                k_draft=2,
                drop=0.65,
                pos=0,
                accept=1,
                restart_id=0,
                n_prompt=1,
                draft_piece="a",
                gold_piece="a",
                join_flag="",
                method=METHOD_EXACT,
                window=0,
            )
        ]
        s = summarize_rows(
            rows,
            pc_k2_toks=12.0,
            pc_k6_toks=6.0,
            pc_speed_n=64,
            pc_speed_prompt="x",
            notes={},
        )
        self.assertEqual(s["pc_speed"]["ratio_k2_over_k6"], 2.0)
        cache2k = s["speedup_model"]["device_cpu_k6_cache2000"]
        self.assertTrue(cache2k["stand_in"])
        self.assertEqual(cache2k["device_k6_toks"], 5.861)
        self.assertIn("moe-adopt-kexp.md:59", cache2k["label"])


if __name__ == "__main__":
    unittest.main()
