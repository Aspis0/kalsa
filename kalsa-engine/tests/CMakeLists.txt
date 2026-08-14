# Byte-identity gates. The tiny synthetic models are generated at test time by
# scripts/make-tiny-moe.py (requires python3 with the gguf package); if it is
# unavailable the tests are skipped rather than failing the build. One model per expert
# layout the streamer supports: qwen3moe (split gate/up/down) and gemma4 (fused gate_up).

add_executable(bmoe_moe_gates moe_gates.cpp)
target_link_libraries(bmoe_moe_gates PRIVATE bmoe_core)

# Reasoning-parser wiring regression (issue #49). Needs no model — it drives the extracted
# bmoe::detail::build_parse_params directly — so it runs unconditionally, unlike the gates below.
add_executable(bmoe_chat_parse_test chat_parse_test.cpp)
target_link_libraries(bmoe_chat_parse_test PRIVATE bmoe_core)
target_include_directories(bmoe_chat_parse_test PRIVATE ${CMAKE_SOURCE_DIR}/core/src/engine)
target_compile_definitions(bmoe_chat_parse_test PRIVATE
    BMOE_QWEN3_TEMPLATE_PATH="${CMAKE_SOURCE_DIR}/third_party/llama.cpp/models/templates/Qwen3.5-4B.jinja")
add_test(NAME chat_parse COMMAND bmoe_chat_parse_test)

# Thinking-control tests (issue #82). Drives bmoe::detail::probe_think_control and the prefill
# against real vendored templates, so it needs no model and runs unconditionally.
add_executable(bmoe_think_control_test think_control_test.cpp)
target_link_libraries(bmoe_think_control_test PRIVATE bmoe_core)
target_include_directories(bmoe_think_control_test PRIVATE ${CMAKE_SOURCE_DIR}/core/src/engine)
set(_tmpl_dir "${CMAKE_SOURCE_DIR}/third_party/llama.cpp/models/templates")
target_compile_definitions(bmoe_think_control_test PRIVATE
    BMOE_TMPL_QWEN3="${_tmpl_dir}/Qwen3.5-4B.jinja"
    BMOE_TMPL_LFM25="${_tmpl_dir}/LFM2.5-8B-A1B.jinja"
    BMOE_TMPL_GPTOSS="${_tmpl_dir}/openai-gpt-oss-120b.jinja"
    BMOE_TMPL_LFM2="${_tmpl_dir}/LFM2-8B-A1B.jinja"
    BMOE_TMPL_LFM25_INSTRUCT="${_tmpl_dir}/LFM2.5-Instruct.jinja"
    BMOE_TMPL_GEMMA4="${_tmpl_dir}/google-gemma-4-31B-it.jinja")
add_test(NAME think_control COMMAND bmoe_think_control_test)

# validate() unit tests (issue #51 + the pre-existing rules). Pure config, no model — runs
# unconditionally, and makes good on config.h's "unit-tested" claim.
add_executable(bmoe_config_test config_test.cpp)
target_link_libraries(bmoe_config_test PRIVATE bmoe_core)
add_test(NAME config_validate COMMAND bmoe_config_test)

# The n-gram draft matcher. Pure policy over token ids (no llama.cpp, no model), so the drafting
# decision is covered exhaustively here; what it costs is a bench question, not a test.
add_executable(bmoe_ngram_test ngram_test.cpp)
target_link_libraries(bmoe_ngram_test PRIVATE bmoe_core)
add_test(NAME ngram_draft COMMAND bmoe_ngram_test)

# Kernel dispatcher table + contract constants. Pure policy, no model.
add_executable(bmoe_kernel_dispatch_test kernel_dispatch_test.cpp)
target_link_libraries(bmoe_kernel_dispatch_test PRIVATE bmoe_core)
add_test(NAME kernel_dispatch COMMAND bmoe_kernel_dispatch_test)

# S3b microbench (copied from llama.cpp kalsa/kernel-s3-repack). Not a ctest: it is a
# timed matrix, invoked by tests/kernel_ci/run.py. Links the public ggml/llama API.
add_executable(test-s3-repack-bench test-s3-repack-bench.cpp)
target_link_libraries(test-s3-repack-bench PRIVATE llama)

find_program(PYTHON3 NAMES python3 python)

if(PYTHON3)
    # arch → (fixture id, gguf filename). Each gets a generate fixture + a gate run.
    foreach(spec "qwen3moe" "gemma4")
        set(_model "${CMAKE_CURRENT_BINARY_DIR}/tiny-moe-${spec}.gguf")
        set(_fixture "TINY_MOE_MODEL_${spec}")

        add_test(
            NAME moe_make_tiny_model_${spec}
            COMMAND ${PYTHON3} ${CMAKE_SOURCE_DIR}/scripts/make-tiny-moe.py --arch ${spec} --out ${_model}
        )
        set_tests_properties(moe_make_tiny_model_${spec} PROPERTIES FIXTURES_SETUP ${_fixture})

        add_test(NAME moe_gates_${spec} COMMAND bmoe_moe_gates ${_model})
        set_tests_properties(moe_gates_${spec} PROPERTIES FIXTURES_REQUIRED ${_fixture})
    endforeach()

    # The same qwen3moe fixture, written as a 4-shard split gguf (metadata-only first shard —
    # the layout large models actually ship in, since Hugging Face rejects files above 50 GB).
    # 51 tensors at 20 per shard is deterministic: -00001-of-00004 .. -00004-of-00004. The gate
    # binary gets the FIRST shard, exactly as a user would pass it; the streamer must resolve
    # every expert tensor to its (shard, offset) and produce byte-identical output.
    add_test(
        NAME moe_make_tiny_model_split
        COMMAND ${PYTHON3} ${CMAKE_SOURCE_DIR}/scripts/make-tiny-moe.py --arch qwen3moe
                --split-max-tensors 20 --out "${CMAKE_CURRENT_BINARY_DIR}/tiny-moe-split.gguf"
    )
    set_tests_properties(moe_make_tiny_model_split PROPERTIES FIXTURES_SETUP TINY_MOE_MODEL_split)

    add_test(NAME moe_gates_split
             COMMAND bmoe_moe_gates "${CMAKE_CURRENT_BINARY_DIR}/tiny-moe-split-00001-of-00004.gguf")
    set_tests_properties(moe_gates_split PROPERTIES FIXTURES_REQUIRED TINY_MOE_MODEL_split)

    # CLI application of the dispatch table: user -t wins; no-flag applies the host row.
    # Host row is k=0/drop=0 so the output-changing warning must not fire.
    if(TARGET bmoe-cli)
        set(_tiny_qwen "${CMAKE_CURRENT_BINARY_DIR}/tiny-moe-qwen3moe.gguf")
        add_test(NAME kernel_dispatch_cli_user_threads
                 COMMAND bmoe-cli -m ${_tiny_qwen} -p hi -n 1 -t 8 --kernel-dispatch)
        set_tests_properties(kernel_dispatch_cli_user_threads PROPERTIES
            FIXTURES_REQUIRED TINY_MOE_MODEL_qwen3moe
            PASS_REGULAR_EXPRESSION "threads=8"
            FAIL_REGULAR_EXPRESSION "changes model output")
        add_test(NAME kernel_dispatch_cli_row_applies
                 COMMAND bmoe-cli -m ${_tiny_qwen} -p hi -n 1 --kernel-dispatch)
        set_tests_properties(kernel_dispatch_cli_row_applies PROPERTIES
            FIXTURES_REQUIRED TINY_MOE_MODEL_qwen3moe
            PASS_REGULAR_EXPRESSION "threads=4"
            FAIL_REGULAR_EXPRESSION "changes model output")
    endif()
else()
    message(WARNING "python3 not found: MoE gates will not run (models cannot be generated)")
endif()

# Windows: ggml.dll/llama.dll live in build/bin. Without this, a fresh-shell
# `ctest --test-dir build` exits 0xC0000135 (STATUS_DLL_NOT_FOUND).
if(WIN32)
    get_property(_bmoe_tests DIRECTORY PROPERTY TESTS)
    foreach(_t ${_bmoe_tests})
        if(CMAKE_VERSION VERSION_GREATER_EQUAL "3.22")
            set_property(TEST ${_t} APPEND PROPERTY
                ENVIRONMENT_MODIFICATION "PATH=path_list_prepend:${CMAKE_BINARY_DIR}/bin")
        else()
            string(REPLACE ";" "\\;" _bmoe_path_esc "$ENV{PATH}")
            set_property(TEST ${_t} APPEND PROPERTY
                ENVIRONMENT "PATH=${CMAKE_BINARY_DIR}/bin\\;${_bmoe_path_esc}")
        endif()
    endforeach()
endif()
