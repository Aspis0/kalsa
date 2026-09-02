# LOT-D web research — 2026-09-02

All factual claims have an inline source URL. “Not found” means not found in the linked official/community materials checked on 2026-09-02.

## D1 — RyanCodrai/turbovec

### What it is

- **Language/basis:** A Rust vector index built on Google Research TurboQuant, with a PyO3/NumPy Python extension; the Python package is explicitly classified as **Alpha**, not pure Python. [Repo](https://github.com/RyanCodrai/turbovec) · [Rust manifest](https://raw.githubusercontent.com/RyanCodrai/turbovec/main/turbovec/Cargo.toml) · [Python manifest](https://raw.githubusercontent.com/RyanCodrai/turbovec/main/turbovec-python/pyproject.toml)
- **What it stores:** Compressed numeric embedding vectors plus index/id state; it does not provide a document/text/metadata store or an embedding model. [README](https://raw.githubusercontent.com/RyanCodrai/turbovec/main/README.md) · [API](https://raw.githubusercontent.com/RyanCodrai/turbovec/main/docs/api.md)
- **Index/compression:** A custom online approximate-nearest-neighbor index using TurboQuant scalar quantization at 2, 3, or 4 bits; a 1,536-dimension FP32 vector is documented as 6,144 bytes versus 384 bytes at 2-bit. [README](https://raw.githubusercontent.com/RyanCodrai/turbovec/main/README.md)
- **Index variants:** `TurboQuantIndex` uses positional slots; `IdMapIndex` adds stable external `uint64` IDs backed by an ID↔slot hash table. Files are `.tv` and `.tvim`. [API](https://raw.githubusercontent.com/RyanCodrai/turbovec/main/docs/api.md)
- **API:** Python/Rust APIs expose add/search/remove, stable-ID mapping, allowlist/bitmask filtering, `sync`, file/bytes serialization, and load; Python input is 2-D float32 NumPy arrays. [API](https://raw.githubusercontent.com/RyanCodrai/turbovec/main/docs/api.md) · [README](https://raw.githubusercontent.com/RyanCodrai/turbovec/main/README.md)
- **License:** MIT for the Rust crate and Python package. [Rust manifest](https://raw.githubusercontent.com/RyanCodrai/turbovec/main/turbovec/Cargo.toml) · [Python manifest](https://raw.githubusercontent.com/RyanCodrai/turbovec/main/turbovec-python/pyproject.toml) · [LICENSE](https://github.com/RyanCodrai/turbovec/blob/main/LICENSE)

### Maturity and mobile embedding

- **Snapshot metrics:** GitHub showed 16.6k stars and 362 commits on 2026-09-02. [Repo](https://github.com/RyanCodrai/turbovec)
- **Latest code/release state:** `v1.0.0`/`py-v1.0.0` tags and PyPI `1.0.0` are dated 2026-08-18; GitHub’s Releases page has no release objects. [Tags](https://github.com/RyanCodrai/turbovec/tags) · [Commits](https://github.com/RyanCodrai/turbovec/commits/main) · [PyPI](https://pypi.org/project/turbovec/1.0.0/) · [Releases](https://github.com/RyanCodrai/turbovec/releases)
- **Android/iOS:** The core is native Rust and documents ARM NEON kernels plus aarch64 builds, so custom Android/iOS cross-compilation and Rust/C/FFI integration are technically plausible. The repository does not ship Android/iOS SDKs, AAR/XCFramework artifacts, React Native bindings, or documented mobile integration. [README](https://raw.githubusercontent.com/RyanCodrai/turbovec/main/README.md) · [Rust manifest](https://raw.githubusercontent.com/RyanCodrai/turbovec/main/turbovec/Cargo.toml)
- **Python caveat:** The Python route requires CPython, NumPy, and a compiled PyO3 extension; it is not a drop-in path inside a React Native JavaScript runtime. [Python manifest](https://raw.githubusercontent.com/RyanCodrai/turbovec/main/turbovec-python/pyproject.toml)

### Relation to a local chat-memory store

- Factually, TurboVec can represent the **ANN/vector-index layer** of a local memory system: stable IDs and filtering can point to records held elsewhere. It does not itself hold chat messages, metadata, timestamps, provenance, or full-text search state. [API](https://raw.githubusercontent.com/RyanCodrai/turbovec/main/docs/api.md) · [README](https://raw.githubusercontent.com/RyanCodrai/turbovec/main/README.md)
- Therefore “replace” would mean replacing only an existing vector-index component; a complete chat-memory store would still need a sidecar/local database and ID mapping. This is a data-model fact, not a recommendation. [API](https://raw.githubusercontent.com/RyanCodrai/turbovec/main/docs/api.md)

### Alternatives: mobile-relevant facts

| Thing | Facts relevant to an embedded mobile design | Source |
|---|---|---|
| `sqlite-vec` | Pre-v1 SQLite extension written in dependency-free C; `vec0` virtual tables store/query float, int8, and binary vectors. It is a SQLite extension, not a Python-only package. | [GitHub](https://github.com/asg017/sqlite-vec) |
| LanceDB | Embedded/in-process Rust database with Lance tables for data, metadata, and embeddings; official clients documented for Python, TypeScript, and Rust. No official Android/iOS client or mobile artifact was found in its docs. | [Docs](https://docs.lancedb.com/) · [Quickstart](https://docs.lancedb.com/quickstart) |
| `hnswlib` | Header-only C++ approximate-NN library with Python bindings; supports insertion and updates and uses HNSW graphs. Android/iOS use would require a native build/wrapper; no official mobile package was found in the repo. | [GitHub](https://github.com/nmslib/hnswlib) |
| FAISS upstream | C++ library with Python/NumPy wrappers and a C API; MIT licensed. Upstream is not an official mobile SDK. | [GitHub](https://github.com/facebookresearch/faiss) · [C API install](https://github.com/facebookresearch/faiss/blob/main/c_api/INSTALL.md) |
| `faiss-mobile` | Community packaging/build project producing iOS-family XCFrameworks and Android AAR/JNI artifacts; it is a mobile distribution of FAISS, not the upstream FAISS project. | [GitHub](https://github.com/DeveloperMindset-com/faiss-mobile) |

## D2 — `intfloat/multilingual-e5-small`

### Model, files, and license

- **Model:** 117.6M/118M-parameter multilingual encoder, 384-dimensional output, 12 layers, maximum 512 tokens; the model card says it covers 94 languages, uses `query:`/`passage:` prefixes, and mean pooling. [Model card](https://huggingface.co/intfloat/multilingual-e5-small) · [Model paper/table](https://neurips2024-enlsp.github.io/papers/paper_83.pdf) · [GGUF metadata](https://huggingface.co/cstr/multilingual-e5-small-GGUF/blob/main/README.md)
- **License:** MIT. [Model card](https://huggingface.co/intfloat/multilingual-e5-small)
- **Weight-size arithmetic:** 118M parameters imply approximately 236 MB at fp16 and 118 MB at 8-bit weights before runtime/tokenizer overhead; a community GGUF conversion reports F16 **236 MiB** and Q8_0 **126 MiB**. [GGUF conversion](https://huggingface.co/cstr/multilingual-e5-small-GGUF/blob/main/README.md)
- **ONNX availability:** The upstream model repository contains `model.onnx` **470 MB**, `model_O4.onnx` **235 MB**, and `model_qint8_avx512_vnni.onnx` **118 MB**. The qint8 AVX-512/VNNI artifact is x86-oriented, not an Android ARM artifact. [ONNX tree](https://huggingface.co/intfloat/multilingual-e5-small/tree/main/onnx)

### GGUF and llama.cpp embeddings

- **GGUF:** Community GGUF conversions exist, including F16/Q8_0/Q4 variants; they are not upstream `intfloat` releases. [Community GGUF](https://huggingface.co/cstr/multilingual-e5-small-GGUF/blob/main/README.md) · [Second conversion/usage notes](https://huggingface.co/TwinSunsLLC/multilingual-e5-small-gguf)
- **llama.cpp support:** Official llama.cpp supports BERT-family embedding models and exposes `llama-embedding` with pooling; official CI/examples exercise BGE-small embedding models. [Supported models](https://github.com/ggml-org/llama.cpp) · [Embedding example](https://github.com/ggml-org/llama.cpp/blob/master/examples/embedding/README.md) · [CI BGE test](https://github.com/ggml-org/llama.cpp/blob/master/ci/run.sh)
- **E5-specific caveat:** `multilingual-e5-small` is XLM-R-derived. A llama.cpp issue records that native `XLMRobertaModel` support was requested and was not supported at that time; community conversion notes say the HF config may need to be rewritten from `BertModel` to `XLMRobertaModel` before conversion. Thus “BERT-family works” does not establish that every upstream E5 checkpoint converts/runs unmodified; validate the exact GGUF and tokenizer with the target llama.cpp revision. [llama.cpp issue](https://github.com/ggml-org/llama.cpp/issues/8789) · [Conversion notes](https://huggingface.co/TwinSunsLLC/multilingual-e5-small-gguf)
- **Embedding mode:** llama.cpp’s embedding example uses `--pooling mean`; E5’s model card also specifies mean pooling, so pooling/configuration must be checked rather than assuming generative-LM defaults. [llama.cpp embedding README](https://github.com/ggml-org/llama.cpp/blob/master/examples/embedding/README.md) · [E5 model card](https://huggingface.co/intfloat/multilingual-e5-small)

### Mobile latency

- **Published benchmark status:** No published benchmark was found for this exact model on mid-range Android phones for 100–500-token passages. The available official runtime guidance says device/delegate performance varies and recommends benchmarking on the target device. [LiteRT delegate/performance guidance](https://github.com/google-ai-edge/LiteRT/blob/main/tflite/g3doc/performance/delegates.md)
- **Defensible latency class:** No source-supported millisecond number should be claimed. Given the documented 118M-parameter/236-MiB-fp16 footprint, it is a substantially heavier encoder than the tiny classifiers below; actual 100–500-token latency depends on ARM backend, quantization, threads, tokenizer, and thermal state. This is an inference from the model size and the absence of a target-phone benchmark. [Model card](https://huggingface.co/intfloat/multilingual-e5-small) · [GGUF sizes](https://huggingface.co/cstr/multilingual-e5-small-GGUF/blob/main/README.md) · [LiteRT performance guidance](https://github.com/google-ai-edge/LiteRT/blob/main/tflite/g3doc/performance/delegates.md)

## D3 — tiny on-device safety/topic classifiers

### Candidates and limits

| Model | Size | License | Languages / coverage | Runtime/artifact | Maturity/fit facts |
|---|---:|---|---|---|---|
| `gravitee-io/bert-tiny-toxicity` | **4.39M params**; ONNX **17.6 MB**; quant ONNX **29 MB** | OpenRAIL++ | Model metadata says 14 languages; toxicity/not-toxicity, with evaluation showing materially weaker scores for several low-resource languages. | ONNX Runtime/Optimum; no TFLite artifact shown. | Genuine `<50 MB` multilingual toxicity option, but it is a toxicity classifier, not a general dangerous/illegal-topic policy model. [Model](https://huggingface.co/gravitee-io/bert-tiny-toxicity) · [Files](https://huggingface.co/gravitee-io/bert-tiny-toxicity/tree/main) |
| `minuva/MiniLMv2-toxic-jigsaw-lite-onnx` | **23M params**; optimized quantized ONNX **22.9 MB** | Apache-2.0 | English; toxicity and severe-toxicity labels. | ONNX Runtime/Optimum; no TFLite artifact shown. | Good size/license fit for English input filtering, but not multilingual and not a broad illegal-topic classifier. [Model](https://huggingface.co/minuva/MiniLMv2-toxic-jigsaw-lite-onnx) · [Files](https://huggingface.co/minuva/MiniLMv2-toxic-jigsaw-lite-onnx/tree/main) |
| `cointegrated/rubert-tiny-toxicity` | **11.8M params**; safetensors **47.2 MB**; full repo ~95 MB with duplicate weights | MIT | Russian; multilabel insult/obscenity/threat/dangerous-style toxicity categories. | PyTorch/Transformers model card; no ONNX/TFLite artifact shown. | Borderline `<50 MB` for one weight file, Russian-only, and “dangerous” is not a comprehensive illegal-content taxonomy. [Model](https://huggingface.co/cointegrated/rubert-tiny-toxicity) |
| `gravitee-io/distilbert-multilingual-toxicity-classifier` | ~0.1B params; quantized ONNX **136 MB** | OpenRAIL++ | Multilingual 14-language toxicity classifier. | ONNX Runtime/Optimum. | More multilingual capacity, but fails the `<50 MB` requirement. [Model/files](https://huggingface.co/gravitee-io/distilbert-multilingual-toxicity-classifier) · [Files](https://huggingface.co/gravitee-io/distilbert-multilingual-toxicity-classifier/tree/main) |

- **Detoxify:** the official package’s multilingual model is XLM-R base, not tiny; the multilingual checkpoint repository is about **1.12 GB** and Apache-2.0, with Python/PyTorch/Transformers usage. [Detoxify README](https://github.com/unitaryai/detoxify/blob/master/README.md) · [Checkpoint](https://huggingface.co/unitary/multilingual-toxic-xlm-roberta/tree/main)
- **Llama Guard:** `Llama-Guard-3-1B` covers 13 safety categories including violent/nonviolent crimes, weapons, hate, self-harm, and sexual content; it supports eight listed languages, but is a ~1.1B-parameter causal LM, not a `<50 MB` ONNX/TFLite classifier. [Model card](https://huggingface.co/meta-llama/Llama-Guard-3-1B)
- **Google:** ShieldGemma provides safety classifiers for sexually explicit, dangerous, hate, and harassment content, but public variants are 2B/9B/27B-class and English; no official Google pretrained `<50 MB` safety classifier was found. LiteRT is a runtime/conversion stack, not such a model. [ShieldGemma](https://huggingface.co/google/shieldgemma-2b) · [ShieldGemma collection](https://huggingface.co/collections/google/shieldgemma-release) · [LiteRT](https://github.com/google-ai-edge/LiteRT)
- **Bottom line on multilinguality:** Under 50 MB, the clearest off-the-shelf multilingual option found is tiny toxicity detection, with uneven language quality; broad dangerous/illegal input-topic coverage remains represented by much larger models or requires a product-specific classifier. [BERT-tiny evaluation/model card](https://huggingface.co/gravitee-io/bert-tiny-toxicity) · [Llama Guard taxonomy](https://huggingface.co/meta-llama/Llama-Guard-3-1B)

## Six-line summary

| Thing | What it is | Size | License | On-device runtime | Maturity |
|---|---|---:|---|---|---|
| TurboVec | Rust TurboQuant ANN vector index; no text/metadata store | 2–4-bit vectors | MIT | Native Rust/FFI plausible; no mobile package | v1.0 tag/PyPI, Python marked Alpha; 16.6k stars/362 commits [repo](https://github.com/RyanCodrai/turbovec) |
| sqlite-vec | Dependency-free C SQLite vector extension | Float/int8/binary vectors | MIT | SQLite native extension | Pre-v1 [repo](https://github.com/asg017/sqlite-vec) |
| multilingual-e5-small | 118M-param, 384-dim multilingual embedding encoder | F16 236 MiB; Q8 GGUF 126 MiB; ONNX 118–470 MB | MIT | ONNX Runtime or validated llama.cpp GGUF | Established HF checkpoint; XLM-R conversion caveat [model](https://huggingface.co/intfloat/multilingual-e5-small) |
| BERT-tiny toxicity | Tiny multilingual toxicity classifier | 17.6 MB ONNX; 29 MB quant ONNX | OpenRAIL++ | ONNX Runtime | Off-the-shelf, but uneven multilingual evaluation [model](https://huggingface.co/gravitee-io/bert-tiny-toxicity) |
| MiniLMv2 toxic Jigsaw | Tiny English toxicity classifier | 22.9 MB quant ONNX | Apache-2.0 | ONNX Runtime | Off-the-shelf, English-only [model](https://huggingface.co/minuva/MiniLMv2-toxic-jigsaw-lite-onnx) |
| Llama Guard / ShieldGemma | Broad safety policy models | ~1B / 2B+ class; far above 50 MB | Llama/Gemma terms | llama.cpp/Transformers or LiteRT conversion work; no tiny official artifact | Broad taxonomy, but not tiny/mobile-ready [Llama Guard](https://huggingface.co/meta-llama/Llama-Guard-3-1B) · [ShieldGemma](https://huggingface.co/google/shieldgemma-2b) |
