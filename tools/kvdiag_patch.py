#!/usr/bin/env python3
"""Apply usa-e-getta KVDIAG instrumentation to session.cpp (phone or local)."""
from pathlib import Path
import sys

def main() -> int:
    p = Path(sys.argv[1]) if len(sys.argv) > 1 else (
        Path.home() / "src/BigMoeOnEdge/core/src/engine/session.cpp"
    )
    bak = p.with_suffix(p.suffix + ".PREDIAG")
    if bak.exists():
        src = bak.read_text(encoding="utf-8")
    else:
        src = p.read_text(encoding="utf-8")
        bak.write_text(src, encoding="utf-8")

    needle = (
        "    // Reuse the KV prefix already decoded from earlier turns (chat mode only): find how many\n"
        "    // leading tokens still match the cache, drop the divergent tail, and prefill only the suffix.\n"
        "    // Keeping at least one token to decode means a turn is never a no-op. clear_kv leaves\n"
        "    // kv_tokens empty, so n_common = 0 and this reduces to a full prefill — the one-shot path the\n"
        "    // byte-identity gates exercise stays unchanged.\n"
        "    size_t n_common = 0;\n"
        "    if (chat_on && !im.kv_tokens.empty()) {\n"
        "        const size_t max_common = tokens.size() > 0 ? tokens.size() - 1 : 0;\n"
        "        while (n_common < im.kv_tokens.size() && n_common < max_common && im.kv_tokens[n_common] == tokens[n_common])\n"
        "            ++n_common;"
    )

    # Diagnostic block. Escapes are written as real C++ source characters.
    diag = r'''    // Reuse the KV prefix already decoded from earlier turns (chat mode only): find how many
    // leading tokens still match the cache, drop the divergent tail, and prefill only the suffix.
    // Keeping at least one token to decode means a turn is never a no-op. clear_kv leaves
    // kv_tokens empty, so n_common = 0 and this reduces to a full prefill — the one-shot path the
    // byte-identity gates exercise stays unchanged.
    size_t n_common = 0;
    // === KVDIAG usa-e-getta (mandato kv-reuse-diagnosis) — non committare ===
    {
        auto tok_txt = [&](llama_token t) -> std::string {
            char piece[256];
            int np = llama_token_to_piece(im.vocab, t, piece, sizeof(piece), 0, true);
            if (np < 0) {
                std::vector<char> buf(-np);
                np = llama_token_to_piece(im.vocab, t, buf.data(), (int)buf.size(), 0, true);
                if (np <= 0) return "?";
                return std::string(buf.data(), np);
            }
            if (np == 0) return "";
            return std::string(piece, np);
        };
        auto esc = [](const std::string & s) -> std::string {
            std::string o; o.reserve(s.size());
            for (unsigned char c : s) {
                if (c == '\n') o += "\\n";
                else if (c == '\r') o += "\\r";
                else if (c == '\t') o += "\\t";
                else if (c < 32) { char b[8]; std::snprintf(b, sizeof(b), "\\x%02x", c); o += b; }
                else o += (char)c;
            }
            return o;
        };
        std::fprintf(stderr, "KVDIAG n_common_atteso=? kv_tokens=%zu tokens=%zu chat_on=%d\n",
                     im.kv_tokens.size(), tokens.size(), (int)chat_on);
        std::fprintf(stderr, "KVDIAG kv[0..15]  =");
        for (size_t i = 0; i < im.kv_tokens.size() && i < 16; ++i)
            std::fprintf(stderr, " %d:%s", (int)im.kv_tokens[i], esc(tok_txt(im.kv_tokens[i])).c_str());
        if (im.kv_tokens.empty()) std::fprintf(stderr, " <empty>");
        std::fprintf(stderr, "\n");
        std::fprintf(stderr, "KVDIAG tok[0..15] =");
        for (size_t i = 0; i < tokens.size() && i < 16; ++i)
            std::fprintf(stderr, " %d:%s", (int)tokens[i], esc(tok_txt(tokens[i])).c_str());
        std::fprintf(stderr, "\n");
        size_t div = 0;
        size_t lim = im.kv_tokens.size() < tokens.size() ? im.kv_tokens.size() : tokens.size();
        while (div < lim && im.kv_tokens[div] == tokens[div]) ++div;
        if (im.kv_tokens.empty()) {
            std::fprintf(stderr, "KVDIAG prima divergenza a posizione N/A: kv_tokens empty (confronto saltato)\n");
        } else if (div >= lim) {
            std::fprintf(stderr, "KVDIAG prima divergenza: nessuna entro lim=%zu (kv=%zu tok=%zu)\n",
                         lim, im.kv_tokens.size(), tokens.size());
        } else {
            std::fprintf(stderr, "KVDIAG prima divergenza a posizione %zu: kv=%d:%s tok=%d:%s\n",
                         div,
                         (int)im.kv_tokens[div], esc(tok_txt(im.kv_tokens[div])).c_str(),
                         (int)tokens[div], esc(tok_txt(tokens[div])).c_str());
        }
        if (!im.kv_tokens.empty()) {
            size_t show_n = im.kv_tokens.size() < 80 ? im.kv_tokens.size() : 80;
            std::fprintf(stderr, "KVDIAG kv_full_head[%zu] =", show_n);
            for (size_t i = 0; i < show_n; ++i)
                std::fprintf(stderr, " %d:%s", (int)im.kv_tokens[i], esc(tok_txt(im.kv_tokens[i])).c_str());
            std::fprintf(stderr, "\n");
            show_n = tokens.size() < 80 ? tokens.size() : 80;
            std::fprintf(stderr, "KVDIAG tok_full_head[%zu] =", show_n);
            for (size_t i = 0; i < show_n; ++i)
                std::fprintf(stderr, " %d:%s", (int)tokens[i], esc(tok_txt(tokens[i])).c_str());
            std::fprintf(stderr, "\n");
        }
        std::fflush(stderr);
    }
    // === fine KVDIAG ===
    if (chat_on && !im.kv_tokens.empty()) {
        const size_t max_common = tokens.size() > 0 ? tokens.size() - 1 : 0;
        while (n_common < im.kv_tokens.size() && n_common < max_common && im.kv_tokens[n_common] == tokens[n_common])
            ++n_common;'''

    if needle not in src:
        print("NEEDLE NOT FOUND", file=sys.stderr)
        return 2
    if src.count(needle) != 1:
        print(f"NEEDLE COUNT={src.count(needle)}", file=sys.stderr)
        return 3

    p.write_text(src.replace(needle, diag, 1), encoding="utf-8")
    new = p.read_text(encoding="utf-8")
    idx = new.find("auto esc =")
    print("ESC_SNIPPET:")
    print(repr(new[idx:idx + 350]))
    print("KVDIAG_COUNT", new.count("KVDIAG"))
    print("PATCH_OK", p)
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
