#!/usr/bin/env python3
# N2 acceptance offline: alpha = P(argmax_draft == token_target) + mean run-length
from __future__ import annotations
import argparse, hashlib, json, struct, sys, time
from pathlib import Path

def gguf_tokenizer_hashes(path: Path):
    with path.open("rb") as f:
        magic = f.read(4)
        assert magic == b"GGUF", magic
        ver = struct.unpack("<I", f.read(4))[0]
        n_tensors, n_kv = struct.unpack("<QQ", f.read(16))
        def rstr():
            n = struct.unpack("<Q", f.read(8))[0]
            return f.read(n).decode("utf-8", "replace")
        def rval(t):
            if t == 8:
                return rstr()
            if t == 4:
                return struct.unpack("<I", f.read(4))[0]
            if t == 5:
                return struct.unpack("<i", f.read(4))[0]
            if t == 6:
                return struct.unpack("<f", f.read(4))[0]
            if t == 7:
                return bool(struct.unpack("<?", f.read(1))[0])
            if t == 9:
                at = struct.unpack("<I", f.read(4))[0]
                n = struct.unpack("<Q", f.read(8))[0]
                if at == 8:
                    h = hashlib.sha256()
                    for _ in range(n):
                        s = rstr().encode()
                        h.update(s)
                        h.update(bytes([0]))
                    return ("n=%d" % n, h.hexdigest()[:16])
                sizes = {0:1,1:1,2:2,3:2,4:4,5:4,6:4,7:1,10:8,11:8,12:8}
                f.read(sizes.get(at, 0) * n)
                return ("n=%d" % n, None)
            sizes = {0:1,1:1,2:2,3:2,4:4,5:4,6:4,7:1,10:8,11:8,12:8}
            f.read(sizes.get(t, 0))
            return None
        out = {}
        for _ in range(n_kv):
            k = rstr()
            t = struct.unpack("<I", f.read(4))[0]
            if k in (
                "general.name",
                "general.architecture",
                "tokenizer.ggml.model",
                "tokenizer.ggml.pre",
                "tokenizer.ggml.tokens",
                "tokenizer.ggml.merges",
            ):
                if t == 9:
                    v, h = rval(t)
                    out[k] = v
                    if h:
                        out[k + ".sha16"] = h
                else:
                    out[k] = rval(t)
            else:
                rval(t)
        return out

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", required=True)
    ap.add_argument("--gens-dir", default="results/f5.5/b")
    ap.add_argument("--pattern", default="*-k8.gen.txt")
    ap.add_argument("--out", default="results/spec_ladder/n2")
    ap.add_argument("--n-ctx", type=int, default=4096)
    ap.add_argument("--n-gpu-layers", type=int, default=0)
    ap.add_argument("--threads", type=int, default=8)
    ap.add_argument("--max-tokens", type=int, default=0)
    args = ap.parse_args()
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    model = Path(args.model)
    meta = gguf_tokenizer_hashes(model)
    (out / "draft_tokenizer.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")
    print("draft tokenizer", meta)
    target = {
        "tokenizer.ggml.tokens.sha16": "49930cc8a75188cf",
        "tokenizer.ggml.merges.sha16": "2d0d7c583fcdbbcc",
        "tokenizer.ggml.pre": "qwen35",
    }
    match = (
        meta.get("tokenizer.ggml.tokens.sha16") == target["tokenizer.ggml.tokens.sha16"]
        and meta.get("tokenizer.ggml.merges.sha16") == target["tokenizer.ggml.merges.sha16"]
        and meta.get("tokenizer.ggml.pre") == target["tokenizer.ggml.pre"]
    )
    print("TOKENIZER_MATCH", match)
    ntok = meta.get("tokenizer.ggml.tokens", "")
    if not match or "n=248320" not in str(ntok):
        print("FATAL tokenizer mismatch or wrong vocab size; refuse acceptance on wrong draft family")
        sys.exit(3)
    try:
        from llama_cpp import Llama
        import numpy as np
    except ImportError as e:
        print("FATAL llama_cpp:", e)
        sys.exit(2)

    llm = Llama(
        model_path=str(model),
        n_ctx=args.n_ctx,
        n_threads=args.threads,
        n_gpu_layers=args.n_gpu_layers,
        logits_all=True,
        verbose=False,
    )
    gens = sorted(Path(args.gens_dir).glob(args.pattern))
    if not gens:
        print("no gen files")
        sys.exit(1)
    per_file = []
    total_pos = 0
    total_match = 0
    all_runs = []
    for gpath in gens:
        text = gpath.read_text(encoding="utf-8", errors="replace")
        tokens = llm.tokenize(text.encode("utf-8"), add_bos=True)
        if args.max_tokens > 0:
            tokens = tokens[: args.max_tokens]
        if len(tokens) < 2:
            continue
        llm.reset()
        llm.eval([tokens[0]])
        run = 0
        runs = []
        local_match = 0
        matches = []
        for i in range(len(tokens) - 1):
            # scores row for last evaluated token
            if hasattr(llm, "scores") and llm.scores is not None:
                scores = np.asarray(llm.scores[llm.n_tokens - 1])
            elif hasattr(llm, "_scores") and llm._scores is not None:
                scores = np.asarray(llm._scores[llm.n_tokens - 1])
            else:
                raise RuntimeError("cannot read logits")
            pred = int(scores.argmax())
            gold = int(tokens[i + 1])
            ok = pred == gold
            matches.append(1 if ok else 0)
            if ok:
                run += 1
                local_match += 1
            else:
                if run > 0:
                    runs.append(run)
                run = 0
            llm.eval([gold])
        if run > 0:
            runs.append(run)
        n = len(matches)
        alpha = local_match / n if n else 0.0
        mean_run = (sum(runs) / len(runs)) if runs else 0.0
        rec = {
            "file": gpath.name,
            "n_pos": n,
            "n_match": local_match,
            "alpha": alpha,
            "mean_run_length": mean_run,
            "n_runs": len(runs),
            "max_run": max(runs) if runs else 0,
            "runs_head": runs[:20],
        }
        per_file.append(rec)
        total_pos += n
        total_match += local_match
        all_runs.extend(runs)
        print("%s: alpha=%.4f n=%d mean_run=%.3f max_run=%d" % (gpath.name, alpha, n, mean_run, rec["max_run"]))
        (out / (gpath.stem + ".json")).write_text(json.dumps(rec, indent=2), encoding="utf-8")
    alpha_all = total_match / total_pos if total_pos else 0.0
    mean_run_all = (sum(all_runs) / len(all_runs)) if all_runs else 0.0

    def e_accept(k):
        if not all_runs:
            return 0.0
        return sum(min(r, k) for r in all_runs) / len(all_runs)

    summary = {
        "draft_model": str(model),
        "tokenizer_meta": meta,
        "tokenizer_match_target_qwen35": match,
        "target_token_sha16": target,
        "n_files": len(per_file),
        "total_pos": total_pos,
        "total_match": total_match,
        "alpha": alpha_all,
        "mean_run_length": mean_run_all,
        "e_accept_k2": e_accept(2),
        "e_accept_k4": e_accept(4),
        "e_accept_k8": e_accept(8),
        "e_accept_k16": e_accept(16),
        "verdict": "VERDE" if alpha_all >= 0.60 else ("GIALLO" if alpha_all >= 0.45 else "ROSSO"),
        "per_file": per_file,
        "prediction_a_verbale": "alpha ~ 55-70% with 1.7B same family; measuring 4B (tokenizer-matched)",
    }
    (out / "summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    print(json.dumps({k: summary[k] for k in ("alpha", "mean_run_length", "e_accept_k4", "verdict", "tokenizer_match_target_qwen35", "total_pos")}, indent=2))

if __name__ == "__main__":
    main()
