#!/usr/bin/env python3
"""Hard multilingual chat probe (the Ling set), pointed at the lab server on 8191.

Copied from ~/lab/models/ling/quiz.py; only the port, the output path and a --smoke limit changed.
Unscored: answers are read by hand against the questions.
"""
import json, sys, time, urllib.request, os

QS = [
    ("it", "Un treno parte da Milano alle 14:40 e arriva a Roma alle 17:55. Un secondo treno parte da Roma alle 15:10 e arriva a Milano alle 18:20. Le due città distano 570 km e i treni viaggiano a velocità costante. A che ora si incrociano? Mostra il ragionamento in breve."),
    ("it", "Spiega la differenza tra 'gli ho detto' e 'le ho detto' e correggi questa frase: 'Se avrei saputo che venivi, ti avrei aspettato.'"),
    ("it", "Riassumi in tre frasi il significato del canto V dell'Inferno di Dante, citando un verso esatto."),
    ("it", "Scrivi una mail formale (max 80 parole) al condominio per segnalare un'infiltrazione d'acqua dal piano di sopra."),
    ("fr", "Explique la différence entre « je mangerais » et « je mangerai », puis écris une phrase correcte avec chacun."),
    ("fr", "Si j'ai 3 chemises, 4 pantalons et 2 paires de chaussures, mais que je refuse de porter la chemise rouge avec le pantalon vert, combien de tenues différentes puis-je composer ? Justifie."),
    ("fr", "Quelle est la différence juridique entre un CDD et un CDI en France ? Réponds en quatre phrases maximum."),
    ("zh", "请用简体中文解释成语“画蛇添足”的意思，并造一个句子。"),
    ("zh", "一个水池有两个进水管和一个出水管。甲管单独注满需要6小时，乙管单独注满需要4小时，丙管单独放空需要12小时。三管同时打开，几小时注满？请写出计算过程。"),
    ("zh", "用三句话比较儒家和道家对“治国”的看法。"),
    ("es", "Explica la diferencia entre 'ser' y 'estar' con 'aburrido' y 'listo', con un ejemplo de cada uno."),
    ("es", "Tengo 1.200 € ahorrados. Gasto el 15 %, luego invierto un tercio de lo que queda al 4 % anual de interés simple durante 18 meses. ¿Cuánto dinero tengo en total al final? Muestra los cálculos."),
    ("es", "Escribe un poema de cuatro versos con rima consonante sobre el mar Mediterráneo."),
]

BASE = "http://127.0.0.1:8191"
OUT_DIR = sys.argv[sys.argv.index("--out") + 1] if "--out" in sys.argv else os.path.expanduser("~/lab/bonsai/results/ling")


def ask(q):
    payload = {"messages": [{"role": "user", "content": q}], "max_tokens": 4096}
    if "--nothink" in sys.argv:
        payload["chat_template_kwargs"] = {"enable_thinking": False}
    body = json.dumps(payload).encode()
    req = urllib.request.Request(f"{BASE}/v1/chat/completions", body, {"Content-Type": "application/json"})
    t0 = time.time()
    d = json.load(urllib.request.urlopen(req, timeout=900))
    m = d["choices"][0]["message"]
    return {
        "content": m.get("content") or "",
        "reasoning_chars": len(m.get("reasoning_content") or ""),
        "finish": d["choices"][0].get("finish_reason"),
        "tok_s": round(d.get("timings", {}).get("predicted_per_second", 0), 1),
        "prompt_tok_s": round(d.get("timings", {}).get("prompt_per_second", 0), 1),
        "tokens": d.get("usage", {}).get("completion_tokens"),
        "wall_s": round(time.time() - t0, 1),
    }


smoke = "--smoke" in sys.argv
items = QS[:3] if smoke else QS
out = []
for lang, q in items:
    r = ask(q)
    r.update(lang=lang, q=q)
    out.append(r)
    print(f"[{lang}] finish={r['finish']} tok={r['tokens']} {r['tok_s']} tok/s wall={r['wall_s']}s reasoning={r['reasoning_chars']}", flush=True)

suffix = "-nothink" if "--nothink" in sys.argv else ""
dest = os.path.join(OUT_DIR, f"quiz-out{'-smoke' if smoke else ''}{suffix}.json")
os.makedirs(OUT_DIR, exist_ok=True)
json.dump(out, open(dest, "w"), ensure_ascii=False, indent=1)
print("wrote", dest)
