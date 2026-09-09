import json
import re

from checks import raw_text_from, reasoning_from, strip_reasoning, token_counts
from v2_tools import canned_result, has_raw_tool_syntax, request_with_retry, response_calls


MAX_TOOL_ROUNDS = 3


def visible_text(response):
    text = strip_reasoning(raw_text_from(response))
    text = re.sub(r"<\|tool_call_start\|>[\s\S]*?(?:<\|tool_call_end\|>|$)", "", text, flags=re.I)
    text = re.sub(r"<function\b[^>]*>[\s\S]*?</function>", "", text, flags=re.I)
    text = re.sub(r"<tool_call>[\s\S]*?</tool_call>", "", text, flags=re.I)
    return text.strip()


def response_with_visible_text(response, text):
    cleaned = json.loads(json.dumps(response, ensure_ascii=False))
    choices = cleaned.setdefault("choices", [])
    if choices:
        choices[0].setdefault("message", {})["content"] = text
    return cleaned


def finish_reason(response):
    choices = response.get("choices") or []
    return choices[0].get("finish_reason") if choices else None


def call_key(call):
    return f"{call.get('name')}:{json.dumps(call.get('arguments', {}), sort_keys=True, ensure_ascii=False)}"


def append_tool_turn(history, calls, failed_keys, successful_web_search):
    history.append({
        "role": "assistant",
        "content": "",
        "tool_calls": [
            {"id": call["id"], "type": "function", "function": call["function"]}
            for call in calls
        ],
    })
    for call in calls:
        name = call.get("name")
        key = call_key(call)
        # The offline web stub represents the app's thrown network failure.
        failed = name in {"web_search", "web_fetch"}
        if failed:
            failed_keys[key] = failed_keys.get(key, 0) + 1
        elif name == "web_search":
            successful_web_search += 1
        history.append({
            "role": "tool",
            "tool_call_id": call["id"],
            "name": name,
            "content": canned_result(name, call.get("arguments", {})),
        })
    return successful_web_search


def complete_with_app_semantics(url, messages, request_fields, timeout, retry_delay):
    history = json.loads(json.dumps(messages, ensure_ascii=False))
    responses, round_log, names, errors = [], [], [], []
    failed_keys = {}
    successful_web_search = 0
    force_text_only = False
    final = {}
    for round_index in range(MAX_TOOL_ROUNDS):
        text_only = round_index == MAX_TOOL_ROUNDS - 1 or force_text_only
        payload = dict(request_fields)
        if text_only:
            payload.pop("tools", None)
            payload["tool_choice"] = "none"
        else:
            payload["tool_choice"] = "auto"
        payload["messages"] = history
        response, error = request_with_retry(url, payload, timeout, retry_delay)
        if error:
            errors.append(error)
            break
        final = response
        responses.append(response)
        calls = response_calls(response)
        names.extend(call.get("name") for call in calls if call.get("name"))
        round_log.append({
            "round": round_index,
            "tool_choice": payload["tool_choice"],
            "text_only": text_only,
            "call_count": len(calls),
            "tool_names": [call.get("name") for call in calls],
            "finish_reason": finish_reason(response),
            "content_empty": not visible_text(response),
        })
        if not calls:
            if visible_text(response):
                break
            continue
        successful_web_search = append_tool_turn(history, calls, failed_keys, successful_web_search)
        if successful_web_search >= 2:
            force_text_only = True
        if any(failed_keys.get(call_key(call), 0) >= 2 for call in calls):
            force_text_only = True

    # LlamaService does one additional tool_choice:none completion when the
    # three loop rounds still yielded no user-visible text/tool-call finish.
    if not visible_text(final) or finish_reason(final) == "tool_calls":
        payload = dict(request_fields)
        payload.pop("tools", None)
        payload["tool_choice"] = "none"
        payload["messages"] = history
        response, error = request_with_retry(url, payload, timeout, retry_delay)
        if error:
            errors.append(error)
        else:
            final = response
            responses.append(response)
            calls = response_calls(response)
            names.extend(call.get("name") for call in calls if call.get("name"))
            round_log.append({
                "round": MAX_TOOL_ROUNDS,
                "tool_choice": "none",
                "text_only": True,
                "fallback": True,
                "call_count": len(calls),
                "tool_names": [call.get("name") for call in calls],
                "finish_reason": finish_reason(response),
                "content_empty": not visible_text(response),
            })
    reasoning = [reasoning_from(response) for response in responses]
    final_text = visible_text(final)
    if not final_text:
        final_text = "I couldn't complete the search. Please try again or rephrase your question."
        final = json.loads(json.dumps(final, ensure_ascii=False))
        choices = final.setdefault("choices", [])
        if choices:
            choices[0].setdefault("message", {})["content"] = final_text
    return final, responses, {
        "tool_rounds": sum(1 for item in round_log if item["call_count"]),
        "tool_names": names,
        "round_log": round_log,
        "round_call_counts": [item["call_count"] for item in round_log],
        "final_contains_raw_tool_syntax": has_raw_tool_syntax(raw_text_from(final)),
        "final_text": final_text,
        "final_empty": not bool(final_text),
        "reasoning_text": "\n\n".join(value for value in reasoning if value),
        "prompt_tokens": sum((token_counts(response)[0] or 0) for response in responses) or None,
        "completion_tokens": sum((token_counts(response)[1] or 0) for response in responses) or None,
        "round_timings": [response.get("timings") for response in responses],
        "error": "; ".join(errors) if errors else None,
        "failed_keys": failed_keys,
    }
