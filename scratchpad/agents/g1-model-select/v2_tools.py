import ast
import json
import re
import socket
import time
from http.client import RemoteDisconnected
from urllib.error import URLError
from urllib.request import Request, urlopen

from checks import raw_message_from, raw_text_from, reasoning_from, token_counts


KNOWN_TOOLS = {
    "web_search", "web_fetch", "document_chat", "write_note",
    "device_info", "device_calc", "create_miniapp",
}
RAW_TOOL = re.compile(r"<function\s+(?:name\s*=\s*)?[\"']?([A-Za-z_]\w*)[\"']?\s*>(.*?)</function>", re.I | re.S)
BRACKET_TOOL = re.compile(r"<\|tool_call_start\|>\s*\[?\s*([A-Za-z_]\w*)\((.*?)\)\s*\]?\s*<\|tool_call_end\|>", re.I | re.S)
JSON_TOOL = re.compile(r"<tool_call>\s*(\{.*?\})\s*</tool_call>", re.I | re.S)


def endpoint(base_url):
    base = base_url.rstrip("/")
    if base.endswith("/chat/completions"):
        return base
    if base.endswith("/v1"):
        return base + "/chat/completions"
    return base + "/v1/chat/completions"


def post_json(url, payload, timeout):
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    request = Request(url, data=body, headers={"Content-Type": "application/json"})
    with urlopen(request, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


REQUEST_ERRORS = (ConnectionResetError, RemoteDisconnected, URLError, TimeoutError, socket.timeout, ValueError)


def request_with_retry(url, payload, timeout, retry_delay):
    for attempt in range(2):
        try:
            return post_json(url, payload, timeout), None
        except REQUEST_ERRORS as error:
            if attempt == 0:
                time.sleep(retry_delay)
            else:
                return {}, str(error)
    return {}, "request failed"


def parse_args(raw):
    if isinstance(raw, dict):
        return raw
    if not isinstance(raw, str) or not raw.strip():
        return {}
    text = raw.strip()
    try:
        value = json.loads(text)
        return value if isinstance(value, dict) else {}
    except json.JSONDecodeError:
        pass
    try:
        value = ast.literal_eval(text)
        return value if isinstance(value, dict) else {}
    except (SyntaxError, ValueError):
        values = {}
        for match in re.finditer(r"([A-Za-z_]\w*)\s*=\s*(['\"])(.*?)\2", text, re.S):
            values[match.group(1)] = match.group(3)
        return values


def normalize_call(call, index):
    function = call.get("function") or {}
    name = function.get("name") or call.get("name")
    arguments = parse_args(function.get("arguments", call.get("arguments", {})))
    return {
        "id": call.get("id") or f"v2-call-{index}",
        "type": "function",
        "function": {"name": name, "arguments": json.dumps(arguments, ensure_ascii=False)},
        "name": name,
        "arguments": arguments,
    }


def parsed_text_calls(content):
    calls = []
    for match in RAW_TOOL.finditer(content or ""):
        body = match.group(2).strip()
        try:
            obj = json.loads(body)
            if isinstance(obj, dict) and "name" in obj:
                calls.append(normalize_call(obj, len(calls)))
                continue
        except json.JSONDecodeError:
            pass
        calls.append(normalize_call({"name": match.group(1), "arguments": body}, len(calls)))
    for match in BRACKET_TOOL.finditer(content or ""):
        calls.append(normalize_call({"name": match.group(1), "arguments": match.group(2)}, len(calls)))
    for match in JSON_TOOL.finditer(content or ""):
        try:
            obj = json.loads(match.group(1))
        except json.JSONDecodeError:
            continue
        if isinstance(obj, dict) and obj.get("name"):
            calls.append(normalize_call(obj, len(calls)))
    return calls


def response_calls(response):
    message = raw_message_from(response)
    structured = message.get("tool_calls") or []
    if structured:
        return [normalize_call(call, index) for index, call in enumerate(structured)]
    return parsed_text_calls(message.get("content", ""))


def has_raw_tool_syntax(text):
    return bool(re.search(r"<\|tool_call|</?function\b|<tool_call>|tool_calls", text or "", re.I))


class Arithmetic:
    def __init__(self, text):
        self.tokens = re.findall(r"\d+(?:\.\d+)?|[()+*/-]", text.replace(" ", ""))
        if "".join(self.tokens) != text.replace(" ", ""):
            raise ValueError("invalid expression")
        self.index = 0

    def take(self, token=None):
        if self.index >= len(self.tokens):
            return None
        value = self.tokens[self.index]
        if token is not None and value != token:
            raise ValueError("invalid expression")
        self.index += 1
        return value

    def expr(self):
        value = self.term()
        while self.index < len(self.tokens) and self.tokens[self.index] in ("+", "-"):
            op = self.take()
            rhs = self.term()
            value = value + rhs if op == "+" else value - rhs
        return value

    def term(self):
        value = self.factor()
        while self.index < len(self.tokens) and self.tokens[self.index] in ("*", "/"):
            op = self.take()
            rhs = self.factor()
            if op == "/" and rhs == 0:
                raise ZeroDivisionError
            value = value * rhs if op == "*" else value / rhs
        return value

    def factor(self):
        if self.index < len(self.tokens) and self.tokens[self.index] == "-":
            self.take("-")
            return -self.factor()
        if self.index < len(self.tokens) and self.tokens[self.index] == "(":
            self.take("(")
            value = self.expr()
            self.take(")")
            return value
        token = self.take()
        if token is None or token in "+-*/()":
            raise ValueError("invalid expression")
        return float(token)


def canned_result(name, arguments):
    if name in {"web_search", "web_fetch"}:
        return "Tool unavailable: the device is offline."
    if name == "device_calc":
        try:
            value = Arithmetic(str(arguments.get("expression", ""))).expr()
            if value.is_integer():
                return str(int(value))
            return str(value)
        except (ValueError, ZeroDivisionError):
            return "Invalid arithmetic expression."
    if name == "device_info":
        return json.dumps({"battery": 80, "network": "offline"}, separators=(",", ":"))
    return {
        "document_chat": "No document is open.",
        "write_note": "Note saved.",
        "create_miniapp": "Miniapp created.",
    }.get(name, "Tool unavailable: unknown tool.")


def complete_with_tools(url, messages, request_fields, timeout, retry_delay):
    history = json.loads(json.dumps(messages, ensure_ascii=False))
    responses = []
    rounds = 0
    names = []
    errors = []
    while True:
        payload = dict(request_fields)
        payload["messages"] = history
        response, error = request_with_retry(url, payload, timeout, retry_delay)
        if error:
            errors.append(error)
            break
        responses.append(response)
        calls = response_calls(response)
        names.extend(call.get("name") for call in calls if call.get("name"))
        executable = [call for call in calls if call.get("name") in KNOWN_TOOLS]
        if not executable or rounds >= 2:
            break
        rounds += 1
        message = raw_message_from(response)
        history.append({
            "role": "assistant",
            "content": message.get("content", "") if message.get("tool_calls") else "",
            "tool_calls": [
                {"id": call["id"], "type": "function", "function": call["function"]}
                for call in executable
            ],
        })
        for call in executable:
            history.append({
                "role": "tool",
                "tool_call_id": call["id"],
                "name": call["name"],
                "content": canned_result(call["name"], call["arguments"]),
            })
    final = responses[-1] if responses else {}
    reasoning = [reasoning_from(response) for response in responses]
    prompt_tokens = sum((token_counts(response)[0] or 0) for response in responses)
    completion_tokens = sum((token_counts(response)[1] or 0) for response in responses)
    return final, responses, {
        "tool_rounds": rounds,
        "tool_names": names,
        "final_contains_raw_tool_syntax": has_raw_tool_syntax(raw_text_from(final)),
        "reasoning_text": "\n\n".join(value for value in reasoning if value),
        "prompt_tokens": prompt_tokens or None,
        "completion_tokens": completion_tokens or None,
        "round_timings": [response.get("timings") for response in responses],
        "error": "; ".join(errors) if errors else None,
    }
