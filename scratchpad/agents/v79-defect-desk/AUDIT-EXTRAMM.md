# Hostile Audit — 153fdbafd `GGML_TEST_EXTRA_MM`

**Commit:** `153fdbafd` — tests: GGML_TEST_EXTRA_MM appends parameterized MUL_MAT cases
**File:** `tests/test-backend-ops.cpp` (42 lines added, 0 removed)
**Reviewer posture:** Hostile. Every claim backed by exact line quote. Assume the env var is the paid-device lifeline.

---

## 1. Parser Correctness (sscanf + guards)

**Code under audit (lines 9923–9937):**
```
const char * extra_mm_env = getenv("GGML_TEST_EXTRA_MM");
if (extra_mm_env && extra_mm_env[0] != '\0') {
    const size_t extra_mm_len = strlen(extra_mm_env);
    if (extra_mm_env[0] == ';' || extra_mm_env[extra_mm_len - 1] == ';' || strstr(extra_mm_env, ";;")) {
        fprintf(stderr, "malformed GGML_TEST_EXTRA_MM entry list: %s\n", extra_mm_env);
        exit(1);
    }

    std::vector<char> extra_mm_copy(extra_mm_env, extra_mm_env + extra_mm_len + 1);
    for (char * entry = strtok(extra_mm_copy.data(), ";"); entry != nullptr; entry = strtok(nullptr, ";")) {
        char type_name[64];
        long long m, n, k;
        int consumed = 0;

        if (sscanf(entry, "%63[^:]:%lld,%lld,%lld%n", type_name, &m, &n, &k, &consumed) < 3 || entry[consumed] != '\0' || m <= 0 || n <= 0 || k <= 0) {
            fprintf(stderr, "malformed GGML_TEST_EXTRA_MM entry: %s\n", entry);
            exit(1);
        }
```

### 1.1 sscanf format string

Format: `%63[^:]:%lld,%lld,%lld%n` — four specifiers, three conversions + `%n`.

| Input class | sscanf returns | Consumed | Guard result | Verdict |
|---|---|---|---|---|
| `q4_0:64,32,256` | 4 (3 conv + `%n`) | 14 | `entry[14]=='\0'` → PASS | OK |
| `q4_0:64,32,256extra` | 4 | 14 | `entry[14]=='e'` → exit(1) | OK |
| `q4_0:64,32,256 ` | 4 | 14 | `entry[14]==' '` → exit(1) | OK |
| `q4_0:64,32` | 2 | 0 | `< 3` → exit(1) | OK |
| `q4_0:64` | 1 | 0 | `< 3` → exit(1) | OK |
| `q4_0:` | 1 | 0 | `< 3` → exit(1) | OK |
| `q4_0` (no colon) | 1 | 0 | `< 3` → exit(1) | OK |
| `:64,32,256` (no type) | 0 | 0 | `< 3` → exit(1) | OK |
| `64,32,256` (no colon/type) | 0 | 0 | `< 3` → exit(1) | OK |
| `q4_0:abc,32,256` | 1 | 0 | `< 3` → exit(1) | OK |
| `q4_0:64,32,abc` | 2 | 0 | `< 3` → exit(1) | OK |
| `q4_0:64,32,256,` (trailing comma) | 4 | 14 | `entry[14]==','` → exit(1) | OK |
| `q4_0:1,2,3,4` (extra dims) | 4 | 7 | `entry[7]==','` → exit(1) | OK |
| `q4_0:9999999999999999999999,32,256` (LL overflow) | 2 | 0 | `< 3` → exit(1) | OK |
| `q4_0:-1,32,256` (negative) | 4 | 8 | `m<=0` → exit(1) | OK |
| `q4_0:0,32,256` (zero) | 4 | 6 | `m<=0` → exit(1) | OK |
| Empty string `""` | 0 | 0 | `< 3` → exit(1) | OK |

**1.1.1 `%n` position sanity.** For `"q4_0:64,32,256"`, sscanf reads 14 bytes: `q4_0:64,32,256` (4+1+2+1+2+1+3=14). `%n` writes 14. `entry[14]` is the null terminator. Correct.

**1.1.2 `%n` with `< 3` short-circuit.** When sscanf returns < 3, `%n` was never reached; `consumed` stays at 0. The short-circuit on `< 3` means `entry[consumed]` is never evaluated. **CONFIRMED** — no UB from reading uninitialized `consumed`.

**1.1.3 Overlong type name (>63 chars).** `%63[^:]` reads exactly 63 chars into `type_name[64]`, null-terminates at index 63. The 64th char (index 63) is the null. No overflow. sscanf then expects `:` but finds the 64th non-colon character; format match fails, returns 1, `< 3` triggers exit(1). **CONFIRMED safe.**

**1.1.4 `type_name[64]` never receives unterminated string.** The `%63[^:]` specifier guarantees at most 63 chars + '\0'. **CONFIRMED.**

### 1.2 Leading/trailing `;;` and lone `;` guards

```
if (extra_mm_env[0] == ';' || extra_mm_env[extra_mm_len - 1] == ';' || strstr(extra_mm_env, ";;"))
```

- **Line 9926:** `extra_mm_env[0] == ';'` catches leading `;`. The env var is non-empty (line 9924), so `extra_mm_len >= 1`. **CONFIRMED safe.**
- **Line 9926:** `extra_mm_env[extra_mm_len - 1] == ';'` — `extra_mm_len` is `strlen()`, so index `extra_mm_len - 1` is the last char. **CONFIRMED safe.**
- **Line 9926:** `strstr(extra_mm_env, ";;")` catches double semicolons. **CONFIRMED safe.**
- **Combined effect:** A lone `";"` hits both `extra_mm_env[0]` and `extra_mm_env[extra_mm_len - 1]`. Exits. **OK.**
- **Empty entries after split:** If env is `"a;;b"`, `strstr` catches it before strtok. If env is `"a;b;"`, trailing `;` guard catches it. **No empty entry can reach sscanf. CONFIRMED.**

### 1.3 `strtok` usage

**Line 9932:** `strtok(extra_mm_copy.data(), ";")` — operates on the private copy, not the `getenv` pointer. Subsequent calls use the internal static pointer on the same buffer. **No aliasing issue. CONFIRMED.**

**Thread safety:** `strtok` uses a process-global static pointer. **However**, this code runs inside `make_test_cases_eval()` which executes before parallel workers are spawned (the thread pool is created later in `main`). **PLAUSIBLE** — safe in current architecture; would become a latent bug if `make_test_cases_eval` were ever called concurrently. Severity: negligible for current use.

### 1.4 Unvalidated input classes

| Input | Behavior | Correct? |
|---|---|---|
| `"q4_0: 64,32,256"` (space after colon) | `%lld` skips leading whitespace per C99 §7.19.6.2, sscanf succeeds, numbers parse. **This is accepted.** | **PLAUSIBLE BUG** — Intentional? Spaces in the env var are unusual but not impossible. If a user copy-pastes `"q4_0: 64, 32, 256"`, it silently succeeds with the numbers parsed. Not harmful, but arguably unexpected. Severity: cosmetic. |
| `"  q4_0:64,32,256"` (leading space in type) | `%63[^:]` reads `"  q4_0"` (space is not `:`). sscanf succeeds, type lookup fails for `"  q4_0"`. `GGML_TYPE_COUNT` check → exit(1). | **OK** — rejected, though the error message says "unknown type" rather than "malformed entry". Cosmetic. |
| `"q4_0:64,32,256\t"` (trailing tab) | `%n` records position before the tab. `entry[consumed]` is `'\t'` ≠ `'\0'`. exit(1). | **CONFIRMED safe.** |
| `"q4_0:64,32,256\n"` (trailing newline) | Same as tab. exit(1). | **CONFIRMED safe.** |
| `NULL` (getenv returns NULL) | Line 9924: `extra_mm_env && ...` — NULL short-circuits. Block skipped entirely. | **CONFIRMED safe.** |
| `""` (empty string) | Line 9924: `extra_mm_env[0] != '\0'` fails. Block skipped. | **CONFIRMED safe.** |

---

## 2. Semantics — Constructor Argument Order

**Constructor signature (lines 4451–4453):**
```
test_mul_mat(ggml_type type_a = GGML_TYPE_F32, ggml_type type_b = GGML_TYPE_F32,
        int64_t m = 32, int64_t n = 32, int64_t k = 32,
```

**Stock call (line 9007):**
```
test_cases.emplace_back(new test_mul_mat(GGML_TYPE_Q4_0, GGML_TYPE_F32, 2880, 32, 2880, {1, 1}, {1, 1}));
```
→ `(type_a=Q4_0, type_b=F32, m=2880, n=32, k=2880, bs={1,1}, nr={1,1})`

**New code call (line 9953):**
```
test_cases.emplace_back(new test_mul_mat(type, GGML_TYPE_F32, m, n, k, {1, 1}, {1, 1}));
```
→ `(type_a=type, type_b=F32, m=m, n=n, k=k, bs={1,1}, nr={1,1})`

**Verification of dims at line 9007:**
`build_graph` (line 4486): `a = ggml_new_tensor_4d(ctx, type_a, k, m, bs[0], bs[1])` — tensor A is `(k, m, ...)`. So in the constructor, `m` is TEST-space m (rows of output), `n` is TEST-space n (cols of output), `k` is the reduction dimension. The env var format `q4_0:2880,32,2880` maps to `m=2880, n=32, k=2880`. This matches the stock call at line 9007 exactly.

**The MUL_MAT header printf** doesn't print m/n/k separately — the `op_desc` returns `"MUL_MAT"` (line 4527), and `vars()` (line 4426) prints all fields via `VARS_TO_STR10`. The user's smoke test "q4_0:2880,32,2880 repeated 3x" matches stock dimensions.

**CONFIRMED** — argument order is correct. m/n/k match stock semantics.

**Duplicated entries:** Each `strtok` iteration creates a separate `new test_mul_mat(...)` and `emplace_back`s it. Distinct allocations, distinct cases. **CONFIRMED** — duplicates work correctly.

---

## 3. Placement — End of `make_test_cases_eval()`

**Lines 9920–9955:** The extra_mm block is placed after all stock `test_cases.emplace_back(...)` calls and before `return test_cases;` (line 9957).

**3.1 `-o op-name` filter.** The filter operates on the returned `test_cases` vector at line 10424: `filter_test_cases(test_cases, params_filter)`. This is called AFTER `make_test_cases_eval()` returns. The extra cases are in the vector. `op_desc()` returns `"MUL_MAT"` (line 4527), so `-o MUL_MAT` includes them. **CONFIRMED.**

**3.2 Backend-vs-CPU comparison.** Lines 10426–10500: `MODE_TEST` loop calls `test->eval(b, b_cpu, ...)` for every case in the filtered vector. The extra cases go through the same path. **CONFIRMED.**

**3.3 Perf mode isolation.** `make_test_cases_perf()` (line 9966) is a separate function. The env var is only read inside `make_test_cases_eval()` (line 9923). **CONFIRMED** — zero perf-mode leakage. Perf cases are unaffected.

**3.4 Unset env var = zero behavior change.** When `getenv` returns NULL (line 9924 short-circuits) or the env var is empty (line 9924 `extra_mm_env[0] != '\0'` fails), the entire block is skipped. `test_cases` is returned unmodified. **CONFIRMED** — stock behavior is preserved exactly.

---

## 4. Integer Widths

**Parser variables (line 9934):**
```
long long m, n, k;
```

**Constructor parameters (line 4453):**
```
int64_t m = 32, int64_t n = 32, int64_t k = 32,
```

**Line 9953 call:**
```
new test_mul_mat(type, GGML_TYPE_F32, m, n, k, {1, 1}, {1, 1})
```

`long long` is guaranteed ≥64 bits by C99. `int64_t` is exactly 64 bits. On all targeted platforms (LP64/LLP64), `long long` == `int64_t` == 64-bit. The `%lld` sscanf format reads `long long`. The constructor stores as `int64_t`.

**Narrowing conversion: `long long` → `int64_t`?** On LP64 macOS/Linux (where this test runs), both are 64-bit signed. **No narrowing.** On Windows LLP64, `long long` is 64-bit, `int64_t` is `long long`. **No narrowing.**

**CONFIRMED** — no narrowing risk on any realistic target.

**Loop variable (line 9941):**
```
for (int i = 0; i < GGML_TYPE_COUNT; i++)
```
`GGML_TYPE_COUNT = 43` (ggml/include/ggml.h:433). Fits in `int`. **OK.** Not a width issue.

**Hardcoded `type_b = GGML_TYPE_F32` (line 9953):** The second type is always F32 (the reference), matching stock at line 9007. The env var parser only exposes the quantized type (type_a). **Correct by design.**

---

## 5. Test Hygiene

**5.1 Memory.** Each `new test_mul_mat(...)` is pushed into `std::vector<std::unique_ptr<test_case>>`. Ownership transferred to the unique_ptr. When the vector is destroyed, all cases are freed. **No leak. CONFIRMED.**

**5.2 Global state mutation.** `getenv` is read-only. `strtok` modifies `extra_mm_copy` (a local stack-allocated vector's heap buffer). No globals are written. No `ggml_` initialization is called. **CONFIRMED — zero global state mutation.**

**5.3 Thread safety of strtok.** As noted in §1.3, `strtok` uses a static internal pointer. This is safe because `make_test_cases_eval()` runs single-threaded before the worker pool is created. If refactored to run concurrently, this would be a data race. **PLAUSIBLE latent hazard**, severity: none for current code.

---

## 6. Additional Findings

### 6.1 Error message quality for whitespace-padded type names

**Line 9948:**
```
fprintf(stderr, "unknown ggml type '%s' in GGML_TEST_EXTRA_MM\n", type_name);
```

If the user provides `"  q4_0:64,32,256"` (leading spaces), `type_name` is `"  q4_0"` and the error says "unknown ggml type '  q4_0'". The actual problem is leading whitespace in the type name, but the error blames the type lookup. **PLAUSIBLE UX defect.** A user staring at "unknown ggml type '  q4_0'" might not realize the spaces are the issue. Severity: cosmetic, but in a paid-device scenario where debugging speed matters, misleading errors waste time.

### 6.2 `strtok` silently ignores leading/trailing delimiters after guard

The leading/trailing `;` and `;;` guards on line 9926 are evaluated on the raw env var. But what about `"q4_0:64,32,256; ;q4_0:64,32,256"` (space around `;`)? The `;` is the delimiter, so `strtok` returns `"q4_0:64,32,256"`, then `" "`, then `"q4_0:64,32,256"`. The middle entry `" "` hits sscanf, `%63[^:]` reads `" "`, then expects `:` but finds `\0`. sscanf returns 1, `< 3` → exit(1). **Caught, but with a confusing "malformed entry: " message.** Acceptable.

### 6.3 No deduplication of entries

The env var allows `"q4_0:64,32,256;q4_0:64,32,256;q4_0:64,32,256"`, creating three identical test cases. This is intentional per the writer's note ("repeated 3x for a determinism probe"). **Not a bug. CONFIRMED intentional.**

### 6.4 `exit(1)` on any malformed entry — all-or-nothing semantics

A single bad entry kills the entire test suite. This is the correct behavior for a paid-device scenario: silent partial execution is worse than a hard stop. **CONFIRMED correct.**

---

## Summary

| # | Finding | Severity | Verdict |
|---|---|---|---|
| 1 | sscanf format + guards: all malformed inputs caught | — | **CONFIRMED** correct |
| 1a | `%n`/consumed short-circuit on `< 3`: no UB | — | **CONFIRMED** safe |
| 1b | Overlong type name: buffer overflow impossible | — | **CONFIRMED** safe |
| 1c | Leading whitespace in type name: accepted by sscanf, rejected at lookup with misleading error | cosmetic | **PLAUSIBLE** UX defect |
| 1d | Space after colon (`"q4_0: 64,32,256"`): silently accepted due to `%lld` whitespace skipping | cosmetic | **PLAUSIBLE** unexpected |
| 2 | Constructor arg order m,n,k matches stock line 9007 | — | **CONFIRMED** correct |
| 2a | Duplicated entries create independent cases | — | **CONFIRMED** correct |
| 3 | Placement: end of make_test_cases_eval(), -o filter applies, backend-vs-CPU comparison applies | — | **CONFIRMED** correct |
| 3a | Perf mode unaffected | — | **CONFIRMED** correct |
| 3b | Unset env var = zero behavior change | — | **CONFIRMED** correct |
| 4 | long long → int64_t: no narrowing on any target | — | **CONFIRMED** safe |
| 5 | Memory: unique_ptr owns all cases, no leak | — | **CONFIRMED** clean |
| 5a | Global state: no mutation | — | **CONFIRMED** clean |
| 5b | strtok thread safety: latent hazard if refactored, safe in current single-thread init | negligible | **PLAUSIBLE** latent |

**Zero CONFIRMED functional defects. Two PLAUSIBLE cosmetic issues. One PLAUSIBLE latent hazard.**

---

## Verdict

**APPLY.**

The code is correct for its stated purpose. The two cosmetic items (§1c misleading error for whitespace in type name, §1d space-after-colon acceptance) do not affect correctness or the paid-device determinism probe. The latent strtok thread-safety hazard (§5b) is a non-issue in the current call graph. No fix required for merge.
