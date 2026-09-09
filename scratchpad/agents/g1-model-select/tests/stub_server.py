#!/usr/bin/env python3
"""Tiny local OpenAI-compatible server used by the targeted runner test."""

import argparse
import json
from http.server import BaseHTTPRequestHandler, HTTPServer


class Handler(BaseHTTPRequestHandler):
    def do_POST(self):
        length = int(self.headers.get("Content-Length", "0"))
        request = json.loads(self.rfile.read(length))
        user_text = next((m.get("content", "") for m in reversed(request["messages"]) if m.get("role") == "user"), "")
        tool_calls = None
        if user_text == "EXACT":
            answer = "4"
        elif user_text == "REGEX":
            answer = "Wednesday"
        elif user_text == "CONTAINS":
            answer = "alpha and beta"
        elif user_text == "JSON":
            answer = '{"ok": true}'
        elif user_text == "THINK":
            answer = "[Start thinking] hidden arithmetic [End thinking] 4"
        elif user_text == "TOOL":
            answer = "Done."
            tool_calls = [{"id":"call_1","type":"function","function":{"name":"weather.get_current","arguments":"{\"city\":\"Roma\"}"}}]
        else:
            answer = user_text
        message = {"role": "assistant", "content": answer}
        if tool_calls:
            message["tool_calls"] = tool_calls
        response = {
            "id": "stub-completion",
            "choices": [{"index": 0, "message": message, "finish_reason": "stop"}],
            "usage": {"prompt_tokens": 12, "completion_tokens": 2, "total_tokens": 14},
            "timings": {"prompt_n": 12, "predicted_n": 2, "predicted_per_second": 100.0},
        }
        encoded = json.dumps(response).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)

    def log_message(self, *_args):
        return


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, required=True)
    args = parser.parse_args()
    HTTPServer(("127.0.0.1", args.port), Handler).serve_forever()


if __name__ == "__main__":
    main()
