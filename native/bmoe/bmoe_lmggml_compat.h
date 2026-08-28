// llama.rn renames every ggml/gguf symbol with an `lm_` prefix so its .so can coexist
// with another ggml in the same process. The streaming engine is vendored verbatim from
// kalsa-engine, which is written against upstream names, so this header maps one onto the
// other. It is force-included (`-include`) ahead of every bmoe translation unit, which is
// what makes the vendored sources a byte-for-byte copy: the diff against the engine stays
// empty, so a re-vendor is a plain `cp` and the two copies cannot drift silently.
//
// Preprocessor defines replace whole tokens only, so `ggml_fp16_t` and `ggml_fp16_to_fp32`
// stay distinct and nothing inside a string literal is touched. The `#include "ggml.h"`
// lines in the vendored sources resolve to llama.rn's own headers, which carry the same
// file names.
#pragma once

// ── types and enum constants ──────────────────────────────────────────────────
#define ggml_tensor              lm_ggml_tensor
#define ggml_backend_buffer_t    lm_ggml_backend_buffer_t
#define ggml_fp16_t              lm_ggml_fp16_t
#define gguf_context             lm_gguf_context
#define gguf_init_params         lm_gguf_init_params

#define GGML_MAX_SRC             LM_GGML_MAX_SRC
#define GGML_OP_NONE             LM_GGML_OP_NONE
#define GGML_TYPE_F16            LM_GGML_TYPE_F16
#define GGML_TYPE_F32            LM_GGML_TYPE_F32
#define GGML_TYPE_I32            LM_GGML_TYPE_I32

#define GGUF_TYPE_INT8           LM_GGUF_TYPE_INT8
#define GGUF_TYPE_INT16          LM_GGUF_TYPE_INT16
#define GGUF_TYPE_INT32          LM_GGUF_TYPE_INT32
#define GGUF_TYPE_INT64          LM_GGUF_TYPE_INT64
#define GGUF_TYPE_UINT8          LM_GGUF_TYPE_UINT8
#define GGUF_TYPE_UINT16         LM_GGUF_TYPE_UINT16
#define GGUF_TYPE_UINT32         LM_GGUF_TYPE_UINT32
#define GGUF_TYPE_UINT64         LM_GGUF_TYPE_UINT64
#define GGUF_TYPE_STRING         LM_GGUF_TYPE_STRING

// ── functions ─────────────────────────────────────────────────────────────────
#define ggml_backend_buffer_is_host lm_ggml_backend_buffer_is_host
#define ggml_backend_tensor_get     lm_ggml_backend_tensor_get
#define ggml_backend_tensor_set     lm_ggml_backend_tensor_set
#define ggml_fp16_to_fp32           lm_ggml_fp16_to_fp32
#define ggml_is_contiguous          lm_ggml_is_contiguous
#define ggml_nbytes                 lm_ggml_nbytes
#define ggml_op_name                lm_ggml_op_name

#define gguf_find_key            lm_gguf_find_key
#define gguf_free                lm_gguf_free
#define gguf_get_data_offset     lm_gguf_get_data_offset
#define gguf_get_kv_type         lm_gguf_get_kv_type
#define gguf_get_n_tensors       lm_gguf_get_n_tensors
#define gguf_get_tensor_name     lm_gguf_get_tensor_name
#define gguf_get_tensor_offset   lm_gguf_get_tensor_offset
#define gguf_get_tensor_size     lm_gguf_get_tensor_size
#define gguf_get_val_i8          lm_gguf_get_val_i8
#define gguf_get_val_i16         lm_gguf_get_val_i16
#define gguf_get_val_i32         lm_gguf_get_val_i32
#define gguf_get_val_i64         lm_gguf_get_val_i64
#define gguf_get_val_str         lm_gguf_get_val_str
#define gguf_get_val_u8          lm_gguf_get_val_u8
#define gguf_get_val_u16         lm_gguf_get_val_u16
#define gguf_get_val_u32         lm_gguf_get_val_u32
#define gguf_get_val_u64         lm_gguf_get_val_u64
#define gguf_init_from_file      lm_gguf_init_from_file

// The `--overlap` wait point. Not upstream: added to llama.rn's CPU backend by
// patches/llama.rn+0.12.8.patch, under the lm_ prefix like everything around it.
#define ggml_cpu_expert_ready_hook_t   lm_ggml_cpu_expert_ready_hook_t
#define ggml_cpu_set_expert_ready_hook lm_ggml_cpu_set_expert_ready_hook
