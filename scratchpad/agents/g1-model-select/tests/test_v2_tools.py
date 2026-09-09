import json
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from v2_tools import canned_result, complete_with_tools, endpoint, parsed_text_calls, response_calls
from v2b_tools import complete_with_app_semantics


class StubHandler(BaseHTTPRequestHandler):
    requests = []

    def do_POST(self):
        size = int(self.headers.get("Content-Length", "0"))
        request = json.loads(self.rfile.read(size))
        self.__class__.requests.append(request)
        if len(self.__class__.requests) == 1:
            message = {"role": "assistant", "content": "", "tool_calls": [{
                "id": "call-1", "type": "function",
                "function": {"name": "device_calc", "arguments": '{"expression":"2+3"}'},
            }]}
        else:
            message = {"role": "assistant", "content": "[Start thinking]hidden[End thinking]5"}
        body = json.dumps({
            "choices": [{"message": message, "finish_reason": "stop"}],
            "usage": {"prompt_tokens": 4, "completion_tokens": 2},
        }).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *_args):
        return


class AppSemanticsHandler(BaseHTTPRequestHandler):
    requests = []

    def do_POST(self):
        size = int(self.headers.get("Content-Length", "0"))
        request = json.loads(self.rfile.read(size))
        self.__class__.requests.append(request)
        n = len(self.__class__.requests)
        if n < 3:
            message = {"role": "assistant", "content": "", "tool_calls": [{
                "id": f"call-{n}", "type": "function",
                "function": {"name": "web_search", "arguments": '{"query":"same"}'},
            }]}
        else:
            message = {"role": "assistant", "content": "offline answer"}
        body = json.dumps({"choices": [{"message": message, "finish_reason": "tool_calls" if n < 3 else "stop"}]}).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *_args):
        return


class V2ToolTests(unittest.TestCase):
    def test_parsers_and_offline_executor(self):
        response = {"choices": [{"message": {"tool_calls": [{
            "id": "x", "function": {"name": "device_info", "arguments": "{}"}
        }]}}]}
        self.assertEqual(response_calls(response)[0]["name"], "device_info")
        self.assertEqual(parsed_text_calls('<function name="device_calc">{"expression":"3*4"}</function>')[0]["arguments"], {"expression": "3*4"})
        self.assertEqual(canned_result("device_calc", {"expression": "(2+3)*4"}), "20")

    def test_tool_round_appends_messages_and_reasks(self):
        StubHandler.requests = []
        server = ThreadingHTTPServer(("127.0.0.1", 0), StubHandler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            final, responses, meta = complete_with_tools(
                endpoint(f"http://127.0.0.1:{server.server_port}"),
                [{"role": "user", "content": "calculate"}],
                {"tools": [{"type": "function"}], "tool_choice": "auto"},
                5,
                0,
            )
        finally:
            server.shutdown()
            thread.join(timeout=2)
            server.server_close()
        self.assertEqual(len(responses), 2)
        self.assertEqual(meta["tool_rounds"], 1)
        self.assertEqual(final["choices"][0]["message"]["content"], "[Start thinking]hidden[End thinking]5")
        self.assertEqual([m["role"] for m in StubHandler.requests[1]["messages"]], ["user", "assistant", "tool"])
        self.assertEqual(StubHandler.requests[1]["tool_choice"], "auto")

    def test_app_repeated_failure_forces_text_only(self):
        AppSemanticsHandler.requests = []
        server = ThreadingHTTPServer(("127.0.0.1", 0), AppSemanticsHandler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            final, responses, meta = complete_with_app_semantics(
                endpoint(f"http://127.0.0.1:{server.server_port}"),
                [{"role": "user", "content": "search"}],
                {"tools": [{"type": "function"}], "tool_choice": "auto"}, 5, 0,
            )
        finally:
            server.shutdown()
            thread.join(timeout=2)
            server.server_close()
        self.assertEqual(len(responses), 3)
        self.assertEqual(final["choices"][0]["message"]["content"], "offline answer")
        self.assertEqual(AppSemanticsHandler.requests[2]["tool_choice"], "none")
        self.assertNotIn("tools", AppSemanticsHandler.requests[2])
        self.assertEqual(meta["round_call_counts"], [1, 1, 0])


if __name__ == "__main__":
    unittest.main()
