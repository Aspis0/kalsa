import sys
import unittest

sys.path.insert(0, "/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/g1-model-select")
import run_corpus


def response(content="", calls=None):
    message = {"role": "assistant", "content": content}
    if calls is not None:
        message["tool_calls"] = calls
    return {"choices": [{"message": message}]}


class RunnerUnitTests(unittest.TestCase):
    def test_prompt_language_fallback(self):
        self.assertEqual(run_corpus.prompt_language("it"), "it")
        for lang in ("es", "fr", "de", "pt", "zh", "ja", "en"):
            self.assertEqual(run_corpus.prompt_language(lang), "en")

    def test_reasoning_markers_are_removed(self):
        self.assertEqual(run_corpus.strip_reasoning("<think>hidden</think>4"), "4")
        self.assertEqual(run_corpus.strip_reasoning("[Start thinking]hidden[End thinking] 4"), "4")
        self.assertEqual(run_corpus.strip_reasoning("<think>unfinished"), "")
        self.assertEqual(run_corpus.strip_reasoning("</think>4"), "4")

    def test_check_paths(self):
        self.assertEqual(run_corpus.check_response({"check": "exact", "check_payload": {"value": "4"}}, response("[Start thinking]x[End thinking] 4."))["status"], "PASS")
        self.assertEqual(run_corpus.check_response({"check": "regex", "check_payload": {"pattern": "^yes$"}}, response("YES"))["status"], "PASS")
        self.assertEqual(run_corpus.check_response({"check": "contains_all", "check_payload": {"items": ["alpha", "beta"]}}, response("alpha beta"))["status"], "PASS")
        schema = {"type": "object", "required": ["ok"], "properties": {"ok": {"const": True}}}
        self.assertEqual(run_corpus.check_response({"check": "json_schema", "check_payload": {"schema": schema}}, response('{"ok":true}'))["status"], "PASS")

    def test_all_tool_calls_are_scanned(self):
        calls = [
            {"function": {"name": "other", "arguments": "{}"}},
            {"function": {"name": "weather.get_current", "arguments": '{"city":"Roma"}'}},
        ]
        case = {"check": "json_schema", "check_payload": {"schema": {"type": "object", "required": ["tool_name", "arguments"]}}, "expected_tool": {"name": "weather.get_current", "required_arguments": {"city": "Roma"}}, "expects_answer_after_call": True}
        self.assertEqual(run_corpus.check_response(case, response("done", calls))["status"], "PASS")

    def test_retry_once(self):
        original = run_corpus.post_json
        calls = []
        def flaky(*_args):
            calls.append(1)
            if len(calls) == 1:
                raise ConnectionResetError("reset")
            return {"ok": True}
        run_corpus.post_json = flaky
        try:
            result, error = run_corpus.request_with_retry("http://stub", {}, 1, 0)
        finally:
            run_corpus.post_json = original
        self.assertEqual(result, {"ok": True})
        self.assertIsNone(error)
        self.assertEqual(len(calls), 2)


if __name__ == "__main__":
    unittest.main()
