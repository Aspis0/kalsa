# GGML_TEST_EXTRA_MM

Commit: `153fdbafd`

Mirrored constructor: `tests/test-backend-ops.cpp:9007`

Verification:

- CPU-only configure: exit 0. `test-backend-ops` target build: exit 0.
- Smoke A: two `q4_0:64,32,256` cases found; 1,146/1,146 passed; test exit 0.
- Smoke B: env unset; stock 1,144/1,144 passed; test exit 0.
- Smoke C: `unknown ggml type 'bogus' in GGML_TEST_EXTRA_MM`; test exit 1.

Diff:

```diff
diff --git a/tests/test-backend-ops.cpp b/tests/test-backend-ops.cpp
index b9ef74c0c..068df605a 100644
--- a/tests/test-backend-ops.cpp
+++ b/tests/test-backend-ops.cpp
@@ -9920,6 +9920,42 @@ static std::vector<std::unique_ptr<test_case>> make_test_cases_eval() {
     test_cases.emplace_back(new test_falcon(2));
 #endif
 
+    const char * extra_mm_env = getenv("GGML_TEST_EXTRA_MM");
+    if (extra_mm_env && extra_mm_env[0] != '\0') {
+        const size_t extra_mm_len = strlen(extra_mm_env);
+        if (extra_mm_env[0] == ';' || extra_mm_env[extra_mm_len - 1] == ';' || strstr(extra_mm_env, ";;")) {
+            fprintf(stderr, "malformed GGML_TEST_EXTRA_MM entry list: %s\n", extra_mm_env);
+            exit(1);
+        }
+
+        std::vector<char> extra_mm_copy(extra_mm_env, extra_mm_env + extra_mm_len + 1);
+        for (char * entry = strtok(extra_mm_copy.data(), ";"); entry != nullptr; entry = strtok(nullptr, ";")) {
+            char type_name[64];
+            long long m, n, k;
+            int consumed = 0;
+
+            if (sscanf(entry, "%63[^:]:%lld,%lld,%lld%n", type_name, &m, &n, &k, &consumed) < 3 || entry[consumed] != '\0' || m <= 0 || n <= 0 || k <= 0) {
+                fprintf(stderr, "malformed GGML_TEST_EXTRA_MM entry: %s\n", entry);
+                exit(1);
+            }
+
+            ggml_type type = GGML_TYPE_COUNT;
+            for (int i = 0; i < GGML_TYPE_COUNT; i++) {
+                const char * tname = ggml_type_name((ggml_type) i);
+                if (tname && strcmp(type_name, tname) == 0) {
+                    type = (ggml_type) i;
+                    break;
+                }
+            }
+            if (type == GGML_TYPE_COUNT) {
+                fprintf(stderr, "unknown ggml type '%s' in GGML_TEST_EXTRA_MM\n", type_name);
+                exit(1);
+            }
+
+            test_cases.emplace_back(new test_mul_mat(type, GGML_TYPE_F32, m, n, k, {1, 1}, {1, 1}));
+        }
+    }
+
     return test_cases;
 }
 #ifdef _MSC_VER
