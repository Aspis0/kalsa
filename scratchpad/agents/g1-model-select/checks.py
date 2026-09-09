import json
import re
import unicodedata


def raw_message_from(response):
    choices = response.get("choices") or []
    if not choices:
        return {}
    return choices[0].get("message") or {}


def strip_reasoning(content):
    if not isinstance(content, str):
        return ""
    text = content
    text = re.sub(r"<think>.*?</think>", "", text, flags=re.I | re.S)
    text = re.sub(r"\[Start thinking\].*?\[End thinking\]", "", text, flags=re.I | re.S)
    closing = list(re.finditer(r"</think>|\[End thinking\]", text, re.I))
    if closing:
        text = text[closing[-1].end():]
    leading = re.match(r"^\s*(?:<think>|\[Start thinking\])", text, re.I)
    if leading:
        marker = leading.group(0).lower()
        closing = "</think>" if "<think>" in marker else "[end thinking]"
        if closing not in text.lower():
            return ""
        text = text[leading.end():]
    return text.strip()


def raw_text_from(response):
    content = raw_message_from(response).get("content", "")
    return content if isinstance(content, str) else ""


def text_from(response):
    return strip_reasoning(raw_text_from(response))


def reasoning_from(response):
    message = raw_message_from(response)
    for key in ("reasoning_content", "reasoning", "thinking"):
        value = message.get(key)
        if isinstance(value, str):
            return value
    for key in ("reasoning_content", "reasoning"):
        value = response.get(key)
        if isinstance(value, str):
            return value
    return None


def tool_calls_from(response):
    calls = raw_message_from(response).get("tool_calls") or []
    values = []
    for call in calls:
        function = call.get("function") or {}
        arguments = function.get("arguments", {})
        if isinstance(arguments, str):
            try:
                arguments = json.loads(arguments)
            except json.JSONDecodeError:
                pass
        values.append({"tool_name": function.get("name"), "arguments": arguments})
    return values


def tool_call_mode(response):
    if tool_calls_from(response):
        return "structured"
    if re.search(r"<tool[_ ]?call|<function|tool_calls", raw_text_from(response), re.I):
        return "text"
    return "none"


def normalize_text(value):
    text = unicodedata.normalize("NFC", str(value)).replace("\u00a0", " ").strip()
    fenced = re.fullmatch(r"```(?:[A-Za-z0-9_-]+)?\s*(.*?)\s*```", text, re.S)
    if fenced:
        text = fenced.group(1).strip()
    text = re.sub(r"(?<!\w)(\d{1,3}(?:[.,]\d{3})+)(?!\w)", lambda m: m.group(1).replace(",", "").replace(".", ""), text)
    text = re.sub(r"(?<!\w)(\d+),(\d{1,2})(?!\w)", r"\1.\2", text)
    text = re.sub(r"\s+", " ", text).casefold().strip()
    return text.strip(" \t\r\n\"'“”‘’`*_~.,;:!?：；，。！？")


def comparison_values(text):
    normalized = normalize_text(text)
    last_line = next((line for line in reversed(str(text).splitlines()) if line.strip()), "")
    return normalized, normalize_text(last_line)


def normalized_argument(value):
    normalized = normalize_text(value)
    if not isinstance(value, str):
        return value
    months = {name: index for index, name in enumerate(("january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"), 1)}
    match = re.fullmatch(r"(\d{1,2})\s+([a-z]+)\s+(\d{4})", normalized)
    if match and match.group(2) in months:
        return f"{match.group(3)}-{months[match.group(2)]:02d}-{int(match.group(1)):02d}"
    match = re.fullmatch(r"([a-z]+)\s+(\d{1,2}),?\s+(\d{4})", normalized)
    if match and match.group(1) in months:
        return f"{match.group(3)}-{months[match.group(1)]:02d}-{int(match.group(2)):02d}"
    match = re.fullmatch(r"(\d{1,2})[-/](\d{1,2})[-/](\d{4})", normalized)
    if match:
        return f"{match.group(3)}-{int(match.group(2)):02d}-{int(match.group(1)):02d}"
    return re.sub(r"\s+", "", normalized)


def arguments_match(actual, expected):
    if not isinstance(actual, dict):
        return False
    expected_date = normalized_argument(expected["date"]) if "date" in expected else None
    for key, wanted in expected.items():
        if key not in actual:
            return False
        actual_value = normalized_argument(actual[key])
        wanted_value = normalized_argument(wanted)
        if actual_value == wanted_value:
            continue
        date_time = re.fullmatch(r"(\d{4}-\d{2}-\d{2})[t ](\d{2}:\d{2})(?::\d{2})?", actual_value) if isinstance(actual_value, str) else None
        if key in {"start", "end"} and date_time and re.fullmatch(r"\d{2}:\d{2}", wanted_value or ""):
            if normalized_argument(actual.get("date")) == expected_date and date_time.group(2) == wanted_value:
                continue
        return False
    return True


def expected_tool_value(response, expected):
    for call in tool_calls_from(response):
        if call["tool_name"] == expected["name"] and arguments_match(call["arguments"], expected["required_arguments"]):
            return call
    return None


def json_content(text):
    stripped = text.strip()
    fenced = re.fullmatch(r"```(?:json)?\s*(.*?)\s*```", stripped, re.S | re.I)
    if fenced:
        stripped = fenced.group(1)
    return json.loads(stripped)


def check_response(case, response):
    check = case["check"]
    if check == "rubric":
        return {"status": "RUBRIC", "detail": "blind rubric required"}
    payload = case["check_payload"]
    tool_value = None
    if case.get("expected_tool"):
        tool_value = expected_tool_value(response, case["expected_tool"])
        if not tool_value:
            return {"status": "FAIL", "detail": "expected structured tool call and arguments not found"}
        if case.get("expects_answer_after_call") and not text_from(response):
            return {"status": "FAIL", "detail": "tool call returned no answer content"}
        return {"status": "PASS", "detail": "ok"}
    value = tool_value if tool_value is not None else text_from(response)
    try:
        if check == "exact":
            expected = normalize_text(payload["value"])
            passed = expected in comparison_values(value)
        elif check == "regex":
            flags = re.I if "i" in payload.get("flags", "") else 0
            passed = re.search(payload["pattern"], normalize_text(value), flags) is not None
        elif check == "contains_all":
            normalized = normalize_text(value)
            passed = all(normalize_text(item) in normalized for item in payload["items"])
        elif check == "json_schema":
            candidate = value if tool_value is not None else json_content(value)
            passed = schema_matches(candidate, payload["schema"])
        else:
            return {"status": "FAIL", "detail": "unsupported check type"}
    except (KeyError, TypeError, ValueError, json.JSONDecodeError, re.error) as error:
        return {"status": "FAIL", "detail": f"check error: {error}"}
    return {"status": "PASS" if passed else "FAIL", "detail": "ok" if passed else "check mismatch"}


def schema_matches(value, schema):
    if "const" in schema and value != schema["const"]:
        return False
    if "enum" in schema and value not in schema["enum"]:
        return False
    kind = schema.get("type")
    if kind == "object":
        if not isinstance(value, dict):
            return False
        if any(key not in value for key in schema.get("required", [])):
            return False
        properties = schema.get("properties", {})
        if schema.get("additionalProperties") is False and any(key not in properties for key in value):
            return False
        return all(schema_matches(value[key], rule) for key, rule in properties.items() if key in value)
    if kind == "array":
        if not isinstance(value, list):
            return False
        if len(value) < schema.get("minItems", 0) or len(value) > schema.get("maxItems", len(value)):
            return False
        item_schema = schema.get("items")
        if isinstance(item_schema, list):
            return len(value) == len(item_schema) and all(schema_matches(item, rule) for item, rule in zip(value, item_schema))
        return item_schema is None or all(schema_matches(item, item_schema) for item in value)
    if kind == "string" and not isinstance(value, str):
        return False
    if kind == "integer" and (not isinstance(value, int) or isinstance(value, bool)):
        return False
    if kind == "number" and (not isinstance(value, (int, float)) or isinstance(value, bool)):
        return False
    if kind == "boolean" and not isinstance(value, bool):
        return False
    return True


def token_counts(response):
    usage = response.get("usage") or {}
    timings = response.get("timings") or {}
    prompt = usage.get("prompt_tokens", timings.get("prompt_n"))
    completion = usage.get("completion_tokens", timings.get("completion_n", timings.get("predicted_n")))
    return prompt, completion
