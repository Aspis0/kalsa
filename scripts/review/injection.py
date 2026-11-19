"""Script-side detector for instructions hidden in reviewed data."""

from __future__ import annotations

import base64
import binascii
import re
import unicodedata

BIDI = "\u202a\u202b\u202d\u202e\u2066\u2067\u2068\u2069"
ZERO_WIDTH = "\u200b\u200c\u200d\u2060\ufeff"
CONFUSABLE = str.maketrans({
    "\u0438": "i", "\u0433": "g", "\u043d": "n", "\u043e": "o", "\u0440": "r",
    "\u0441": "c", "\u0443": "u", "\u0445": "x", "\u0435": "e", "\u0430": "a",
    "\u04bb": "h", "\u0442": "t", "\u043c": "m", "\u0432": "b", "\u043a": "k",
    "\u0455": "s", "\u0456": "i",
})
LEET_I = str.maketrans({"0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "@": "a", "$": "s"})
LEET_L = str.maketrans({"0": "o", "1": "l", "3": "e", "4": "a", "5": "s", "7": "t", "@": "a", "$": "s"})
PHRASES = (
    r"ignore[\s\-_]+(all[\s\-_]+)?(previous|prior|above|earlier)[\s\-_]+(instruction|prompt|order|rule)",
    r"(disregard|override|forget)\s+(the\s+)?(above|previous|prior|earlier|all)",
    r"(do\s+not|don't|no\s+need\s+to)\s+(check|review|flag|question)",
    r"(this|the)\s+code\s+(has\s+been|was)\s+(reviewed|approved|audited|checked)",
    r"it\s+has\s+been\s+approved",
    r"ignroe\s+previous\s+instructoins",
    r"disragard\s+the\s+above",
    r"already\s+(audited|approved|reviewed|checked)",
    r"(approved|signed\s+off)\s+by\s+(security|the\s+security\s+team)",
    r"(dear|hey|hello)\s+(assistant|reviewer|ai|model)",
    r"you\s+are\s+(the\s+)?(reviewer|assistant|ai|model)",
    r"ai\s+reader|language\s+model|system\s+prompt",
    r"ignoriere\s+(alle\s+)?(vorherigen|vorhergehenden)\s+(anweisungen|instruktionen)",
    r"(ignora|ignore)\s+las\s+instrucciones\s+anteriores",
    r"ignorez\s+les\s+instructions\s+précédentes",
    r"ignora\s+le\s+istruzioni\s+precedenti",
    r"ignore\s+as\s+instruções\s+anteriores",
    r"无视.{0,8}(之前|以前).{0,8}(指令|指示)",
    r"忽略.{0,8}(之前|以前).{0,8}(指令|指示)",
    r"以前の指示を(無視|无视)",
    r"игнорируй\s+предыдущие\s+(инструкции|указания)",
    r"проигнорируй\s+предыдущие\s+указания",
    r"ігноруй\s+попередні\s+інструкції",
    r"تجاهل\s+التعليمات\s+السابقة",
    r"Previous instructions ko ignor karo",
    r"پچھلی ہدایات کو نظر انداز کریں",
    r"önceki\s+talimatları\s+yok\s+say",
    r"zignoruj\s+poprzednie\s+instrukcje",
    r"negeer\s+vorige\s+instructies",
    r"bỏ\s+qua\s+(các\s+)?hướng\s+dẫn\s+trước",
    r"abaikan\s+instruksi\s+sebelumnya",
)
ADDRESS = re.compile("|".join(PHRASES), re.IGNORECASE)
ESCAPE = re.compile(r"\\x([0-9a-f]{2})|\\u([0-9a-f]{4})", re.IGNORECASE)
CANDIDATE = re.compile(r"[A-Za-z0-9+/=]{16,}|\b[0-9a-f]{12,64}\b", re.IGNORECASE)
MAGIC = (b"\x7fELF", b"PK\x03\x04", b"MZ", b"\x89PNG")


def fold(text: str) -> str:
    return unicodedata.normalize("NFKC", text).translate(CONFUSABLE)


def leet_views(text: str) -> list[str]:
    return [text.translate(LEET_I), text.translate(LEET_L)]


def _unescape(text: str) -> str:
    def replace(match: re.Match[str]) -> str:
        value = match.group(1) or match.group(2)
        try:
            return chr(int(value, 16))
        except ValueError:
            return value
    return ESCAPE.sub(replace, text)


def _identifier(value: str) -> bool:
    return "_" in value or re.search(r"[a-z][A-Z]", value) is not None


def _decode(value: str) -> bytes | None:
    if _identifier(value) and not re.search(r"[+/=]", value):
        return None
    cleaned = value.replace("=", "")
    for candidate in (cleaned, cleaned + "=" * (-len(cleaned) % 4)):
        try:
            decoded = base64.b64decode(candidate, validate=True)
            if len(decoded) >= 16:
                return decoded
        except (binascii.Error, ValueError):
            pass
    try:
        if len(value) >= 12:
            return bytes.fromhex(value)
    except ValueError:
        pass
    return None


def decoded_text(text: str) -> tuple[list[str], bool]:
    out = []
    found = False
    for match in CANDIDATE.finditer(text):
        value = match.group(0)
        if re.search(r"(sha256|http|lockfile|git)", text[max(0, match.start() - 24):match.start()], re.IGNORECASE):
            continue
        data = _decode(value)
        if data is None:
            continue
        found = True
        if data.startswith(MAGIC):
            out.append("executable payload")
        elif all(byte in (9, 10, 13) or 32 <= byte < 127 for byte in data):
            out.append(data.decode("ascii"))
    return out, found


NOUNS = {
    "review", "reviewer", "reviewers", "audit", "scanner", "scanners", "security", "check", "bot", "bots", "tool", "tools",
    "automated", "model", "models", "ai", "llm", "assistant", "agent", "agents", "reader", "instruction", "inctrukцii", "instruktsii",
    "reviewer", "prüfer", "prüfung", "auditor", "revisor", "revisión", "seguridad",
    "herramienta", "assistant", "audit", "sécurité", "outil", "modèle", "revisione",
    "sicurezza", "strumento", "modello", "auditoria", "segurança", "ferramenta",
    "проверка", "аудит", "безопасность", "инструмент", "модель", "перевірка", "аудит",
    "безпека", "инструмент", "مراجعة", "تدقيق", "أمان", "أداة", "نموذج", "بررسی",
    "حسابرسی", "امنیت", "ابزار", "مدل", "समीक्षा", "ऑडिट", "सुरक्षा", "उपकरण",
    "denetim", "araç", "yardımcı", "audyt", "narzędzie", "controle", "tools",
    "kiểm", "công", "mô", "tinjauan", "keamanan", "审查", "审计", "安全", "工具",
    "レビュー", "監査", "セキュリティ", "ツール", "검토", "감사", "보안", "도구",
}
DISMISS = {
    "skip", "ignore", "safe", "fine", "approved", "cleared", "verified", "harmless",
    "need", "flag", "nothing", "looked", "ok", "disregard", "override",
    "ignoriere", "anweisungen", "ignora", "ignorez", "проигнорируй", "указания",
    "ігноруй", "تجاهل", "پچھلی", "zignoruj", "negeer", "bỏ", "abaikan", "忽略",
    "无視", "無視", "무시", "해도", "инструкции",
}
SEGMENT = re.compile(r"(?://|#|--|/\*|<!--)(.*)$|(['\"`])([^'\"`]*)\2")


def distance(a: str, b: str) -> int:
    if abs(len(a) - len(b)) > 1:
        return 2
    previous = list(range(len(b) + 1))
    for index, char in enumerate(a, 1):
        current = [index]
        for other, target in enumerate(b, 1):
            cost = min(
                current[other - 1] + 1,
                previous[other] + 1,
                previous[other - 1] + (char != target),
            )
            if index > 1 and other > 1 and char == b[other - 2] and a[index - 2] == target:
                cost = min(cost, previous[other - 2] + 1)
            current.append(cost)
        previous = current
    return previous[-1]


def near(word: str, words: set[str]) -> bool:
    if word in words:
        return True
    return len(word) >= 5 and any(len(candidate) >= 5 and distance(word, candidate) == 1 for candidate in words)


def segments(text: str) -> list[str]:
    out = []
    for line in text.split("\n"):
        for match in SEGMENT.finditer(line):
            out.append(match.group(1) or match.group(3) or "")
    return out


def cooccurrence(text: str) -> bool:
    for segment in segments(fold(text)):
        for sentence in re.split(r"[.;!?\n]+", segment):
            words = re.findall(r"[^\W\d_]+", sentence.lower(), re.UNICODE)
            if any(near(word, NOUNS) for word in words) and any(near(word, DISMISS) for word in words):
                return True
    return False


def scan(text: str) -> list[str]:
    folded = fold(text)
    views = [text, folded, *leet_views(text), _unescape(text)]
    decoded = []
    for view in [text, folded, _unescape(text)]:
        values, _ = decoded_text(view)
        decoded.extend(values)
    hits = []
    if any(ADDRESS.search(view) for view in [*views, *decoded]) or cooccurrence(text):
        hits.append("addressed-to-reader")
    if '"verdict"' in text or '"harmless"' in text:
        hits.append("fake-answer")
    if "precedent" in text.lower() or "kalsa" in text.lower():
        hits.append("review-vocabulary")
    if any(char in text for char in BIDI + ZERO_WIDTH):
        hits.append("hidden-unicode")
    for view in views:
        if any(len(line) > 2000 for line in view.split("\n")):
            hits.append("long-line")
        if any(len(line) > 600 and line.count(" ") < 5 for line in view.split("\n")):
            hits.append("minified-line")
    if decoded:
        hits.append("encoded-instruction-data")
    return sorted(set(hits))
