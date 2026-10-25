//! Which lines of the engine's stderr may leave the process. The stderr file, the
//! log tail and the exit reason all read this module.

/// The out-of-memory words, lower-cased. `oom.rs` reads a death by them, so it uses
/// this list rather than keeping its own.
pub const OUT_OF_MEMORY_WORDS: &[&str] = &[
    "out of memory",
    "out_of_memory",
    "outofdevicememory",
    "vk_error_out_of_device_memory",
    "outofhostmemory",
    "vk_error_out_of_host_memory",
    "enomem",
    "bad_alloc",
];

/// Engine lines kept by their `func:` (or `tag func:`), as the log prints them after
/// the timestamp and severity, with runs of spaces read as one. At the engine's
/// default verbosity these print counts, timings and load metadata, not request text.
/// Prompt text does reach the engine's stderr at higher verbosity (`slot launch_slot_`
/// dumps the slot): `kalsa-launch`'s argv never asks for that (`LOUD`), and
/// `child.rs`'s `strip_llama_env` removes the `LLAMA_*` knobs. `srv load_model:` quotes
/// a home-redacted model path, which is not user content. `srv load_slot_ch:` is left
/// out on purpose: it quotes the chat's own file.
const KNOWN_ENGINE_FAMILIES: &[&str] = &[
    "slot print_timing:",
    "slot create_check:",
    "slot launch_slot_:",
    "slot get_availabl:",
    "slot release:",
    "srv load_model:",
    "srv llama_server:",
    "srv init_listene:",
    "srv init:",
    "srv handle_sleep:",
    "srv save_slot_ch:",
    "srv operator(): operator(): cleaning up before exit",
    "srv operator(): unauthorized: Invalid API Key",
    "cmn init:",
    "cmn common_param:",
    "que start_loop:",
    "load_hparams:",
    // Model metadata the engine prints when it loads; no chat text reaches these.
    "llama_model_loader:",
    "llama_model_load:",
    "print_info:",
    "load_tensors:",
    "llama_context:",
    "llama_kv_cache:",
    "ggml_metal",
    "ggml_vulkan:",
    "ggml_cuda",
    // Shapes the stderr tests and the device probe write; none is a chat line.
    "load: ",
    "main: ",
    "restored ",
    "srv update_slots: all slots are idle",
];

/// Where a failure line starts. Anchored at the start of the line, because a prompt
/// echoed mid-line can contain any of these words.
const FAILURE_STARTS: &[&str] = &[
    "GGML_ASSERT",
    "CUDA error",
    "vk::",
    "VK_ERROR_",
    "out of memory",
    "out_of_memory",
    "segmentation fault",
];

/// Line tags of the families that carry request text. A withheld line under one of
/// them never counts as an out-of-memory death.
const REQUEST_FAMILY_TAGS: &[&str] = &["slot ", "srv ", "que "];

/// Marks of request text in a line under no request tag. Only the out-of-memory
/// decision reads them; a line that matches neither is taken as a backend's.
const REQUEST_TEXT_MARKS: &[&str] = &[
    "common_chat_",
    "anthropic string not as expected",
    "got exception",
    "json.exception",
    "parse_error",
    "unparsed",
    "Tool call mismatch",
    "Ignoring content part",
    "unsupported Responses tool type",
];

/// Whether a stderr line may be kept as a log line.
pub(crate) fn is_safe_engine_line(line: &str) -> bool {
    let body = body(line);
    KNOWN_ENGINE_FAMILIES.iter().any(|family| body.starts_with(family)) || is_failure_line(line)
}

/// Whether a line names an engine failure: it starts with one of [`FAILURE_STARTS`],
/// or it is a `GGML_ASSERT(...) failed` line. A quote does not disqualify it: the
/// crash reason and the telemetry signature both need the assertion's own text.
pub(crate) fn is_failure_line(line: &str) -> bool {
    let body = body(line);
    FAILURE_STARTS.iter().any(|start| body.starts_with(start))
        || (body.contains("GGML_ASSERT(") && body.ends_with(") failed"))
}

/// Whether a line reports a backend's out-of-memory death. A request's line never
/// does, because a prompt can quote the words.
pub(crate) fn is_out_of_memory_line(line: &str) -> bool {
    let body = body(line);
    let request_text = REQUEST_FAMILY_TAGS.iter().any(|tag| body.starts_with(tag))
        || REQUEST_TEXT_MARKS.iter().any(|mark| body.contains(mark));
    if request_text {
        return false;
    }
    let body = body.to_lowercase();
    OUT_OF_MEMORY_WORDS.iter().any(|word| body.contains(word))
}

/// The line as the log prints it after the timestamp and severity, with runs of
/// spaces read as one: `0.14.153.586 I slot print_timing:  id 2` gives
/// `slot print_timing: id 2`.
fn body(line: &str) -> String {
    let rest = strip_severity(strip_timestamp(line));
    rest.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// The engine's own timestamp (`0.14.153.586`), or the `<addr>` the redactor writes
/// in its place.
fn strip_timestamp(line: &str) -> &str {
    if let Some(rest) = line.strip_prefix("<addr> ") {
        return rest;
    }
    match line.split_once(' ') {
        Some((stamp, rest)) if is_timestamp(stamp) => rest,
        _ => line,
    }
}

fn is_timestamp(stamp: &str) -> bool {
    let parts: Vec<&str> = stamp.split('.').collect();
    parts.len() == 4 && parts.iter().all(|part| !part.is_empty() && part.bytes().all(|byte| byte.is_ascii_digit()))
}

/// The one-letter severity llama.cpp writes before a line (`I srv ...`).
fn strip_severity(line: &str) -> &str {
    match line.split_once(' ') {
        Some(("I" | "W" | "E" | "D", rest)) => rest,
        _ => line,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Lines copied from the engine's log, one per family, numbers kept. None
    /// carries a path or an id.
    const REAL_LINES: &[&str] = &[
        "0.14.153.586 I slot print_timing: id  2 | task 0 | prompt eval time =     129.19 ms /    11 tokens (   11.74 ms per token,    85.15 tokens per second)",
        "2.50.870.437 W slot create_check: id  0 | task 29 | erasing old context checkpoint (pos_min = 822, pos_max = 822, n_tokens = 823, size = 62.813 MiB)",
        "0.13.880.826 I slot launch_slot_: id  2 | task 0 | processing task, is_child = 0",
        "0.14.154.412 I slot get_availabl: id  2 | task -1 | selected slot by LCP similarity, f_sim_best = 1.000 (> 0.100 thold), f_keep = 0.611",
        "0.13.794.872 I srv    load_model: initializing, n_slots = 3, n_ctx_slot = 65536, kv_unified = 'false'",
        "<addr> I srv  llama_server: listening on http://127.0.0.1:8130",
        "0.00.090.065 I srv  init_listene: The UI is disabled",
        "5.03.788.009 I srv  handle_sleep: server is entering sleeping state",
        "5.41.141.957 I srv  save_slot_ch: appended 1 context checkpoint(s) (62.813 MiB)",
        "0.44.967.058 I srv    operator(): operator(): cleaning up before exit...",
        "0.15.600.502 W srv    operator(): unauthorized: Invalid API Key",
        "0.12.749.580 I cmn          init: llama threadpool init, n_threads = 4",
        "0.00.089.953 I cmn  common_param: common_params_print_info: verbosity = 3 (adjust with the `-lv N` CLI arg)",
        "5.03.787.563 I que    start_loop: entering sleeping state",
        "0.12.851.676 W load_hparams: more info: https://github.com/ggml-org/llama.cpp/issues/16842",
    ];

    #[test]
    fn every_real_family_line_is_kept() {
        for line in REAL_LINES {
            assert!(is_safe_engine_line(line), "withheld: {line}");
        }
    }

    #[test]
    fn a_line_from_an_unnamed_family_is_withheld() {
        assert!(!is_safe_engine_line("0.14.154.000 I slot render: marco's prompt text"));
        assert!(!is_safe_engine_line("srv send_error: task id = 7, error: arbitrary text"));
    }

    /// The restore line names the chat's file. Its path must never leave.
    #[test]
    fn the_slot_restore_line_with_its_path_is_withheld() {
        let line = "0.04.227.343 I srv  load_slot_ch: restored 1 context checkpoint(s) from '~/Library/Application Support/ai.kalsa.brain/slots/CONVERSATION.bin'";
        assert!(!is_safe_engine_line(line));
    }

    /// The assertion text is what the crash reason and the telemetry signature read.
    #[test]
    fn a_quoted_assert_line_is_a_failure_line() {
        let line = "/src/llama-context.cpp:1504: GGML_ASSERT(cparams.n_ubatch >= n_tokens && \"encoder requires n_ubatch >= n_tokens\") failed";
        assert!(is_failure_line(line));
        assert!(is_safe_engine_line(line));
    }

    #[test]
    fn a_segmentation_fault_line_is_a_failure_line() {
        assert!(is_failure_line("segmentation fault (core dumped)"));
        assert!(is_safe_engine_line("segmentation fault (core dumped)"));
    }

    #[test]
    fn an_out_of_memory_word_in_any_case_is_recognised() {
        assert!(is_out_of_memory_line("ggml_backend_cuda: the Out Of Memory case"));
        assert!(is_out_of_memory_line("ggml_vulkan: VK_ERROR_OUT_OF_DEVICE_MEMORY"));
        assert!(!is_out_of_memory_line("ggml_backend_cuda: plain text"));
    }

    /// A prompt echoed under a request tag, or one of the request marks, never
    /// reads as a backend's death.
    #[test]
    fn a_request_line_is_never_out_of_memory() {
        assert!(!is_out_of_memory_line("slot render: marco asks about out of memory"));
        assert!(!is_out_of_memory_line("srv send_error: task id = 7, error: out of memory"));
        assert!(!is_out_of_memory_line("common_chat_parse: unparsed json output: out of memory"));
    }

    #[test]
    fn a_backend_out_of_memory_line_is_withheld_and_still_names_the_death() {
        let line = "ggml_backend_cuda_buffer_type_alloc_buffer: allocating 512.00 MiB on device 0: cudaMalloc failed: out of memory";
        assert!(!is_safe_engine_line(line));
        assert!(is_out_of_memory_line(line));
    }
}
