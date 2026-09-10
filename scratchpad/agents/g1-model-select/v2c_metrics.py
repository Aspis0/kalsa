import json
from urllib.request import Request, urlopen

from v2b_tools import visible_text


def tokenize_count(base_url, text, timeout):
    if not text:
        return 0, None
    request = Request(
        base_url.rstrip("/") + "/tokenize",
        data=json.dumps({"content": text, "parse_special": True}).encode("utf-8"),
        headers={"Content-Type": "application/json"},
    )
    try:
        with urlopen(request, timeout=timeout) as response:
            return len(json.loads(response.read().decode("utf-8")).get("tokens", [])), None
    except Exception as error:
        return len(text.split()), f"tokenize fallback: {error}"


def response_metrics(base_url, responses, timeout):
    model_response = responses[-1] if responses else {}
    model_answer = visible_text(model_response)
    visible_tokens, tokenize_error = tokenize_count(base_url, model_answer, timeout)
    predicted_tokens = sum(
        int((response.get("timings") or {}).get("predicted_n") or 0)
        for response in responses
    )
    return {
        "model_visible_answer": model_answer,
        "visible_answer_tokens": visible_tokens,
        "predicted_tokens": predicted_tokens,
        "reasoning_tokens": max(0, predicted_tokens - visible_tokens),
        "model_answer_empty": not bool(model_answer.strip()),
        "model_answer_bare_gt": model_answer.strip() == ">",
        "tokenize_error": tokenize_error,
    }
