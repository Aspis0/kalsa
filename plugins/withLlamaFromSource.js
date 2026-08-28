/**
 * Build llama.rn's native layer FROM SOURCE by default.
 *
 * WHY THIS EXISTS: llama.rn ships PREBUILT jniLibs (downloaded by its npm
 * postinstall as llama-rn-android-jni-libs.tar.gz) and its android/build.gradle
 * reads `rnllamaBuildFromSource` (default "false") to decide whether to compile
 * cpp/ instead. With prebuilt, every patch under patches/llama.rn+*.patch is
 * applied to source files that are NEVER COMPILED — the app keeps running the
 * upstream binary. That silently invalidated native patches and diagnostics
 * (2026-08-09): DFlash loader gate, restored-session checkpoint, KVDIAG,
 * set_best_cores, and n_threads_batch all had zero effect for the same reason.
 *
 * POLICY (source-build default): compile cpp/ into every build so ALL Kalsa
 * native patches take effect. Explicit opt-out with KALSA_LLAMA_FROM_SOURCE=0
 * restores the prebuilt-JNI path for faster local iteration. The marker assert
 * (scripts/native/assert-native-patch.sh, runtime check in AppShell) catches regressions
 * where the binary lacks "kalsa-native-patches".
 *
 *   undefined / "1" / anything else → rnllamaBuildFromSource=true (source)
 *   "0"                            → leave gradle default (prebuilt)
 */
const { withGradleProperties } = require("expo/config-plugins");

const PROPERTY = "rnllamaBuildFromSource";

const withLlamaFromSource = (config) => {
  // Opt-out only: explicit "0" keeps prebuilt jniLibs. All other values
  // (unset, "1", empty) compile from source so patches/ take effect.
  // IMPORTANT: still run withGradleProperties so an existing
  // rnllamaBuildFromSource=true from a prior prebuild is REMOVED. Returning
  // config untouched leaves the property in an already-generated Android
  // project (incremental prebuilds stay source-build). Clean regeneration
  // (rm -rf android) also works; this path covers incremental prebuilds.
  if (process.env.KALSA_LLAMA_FROM_SOURCE === "0") {
    return withGradleProperties(config, (cfg) => {
      cfg.modResults = cfg.modResults.filter(
        (item) => !(item.type === "property" && item.key === PROPERTY),
      );
      return cfg;
    });
  }

  return withGradleProperties(config, (cfg) => {
    const existing = cfg.modResults.find(
      (item) => item.type === "property" && item.key === PROPERTY,
    );
    if (existing) {
      existing.value = "true";
      return cfg;
    }
    cfg.modResults.push({
      type: "comment",
      value: "Kalsa: compile llama.rn cpp/ so patches/llama.rn+*.patch take effect",
    });
    cfg.modResults.push({ type: "property", key: PROPERTY, value: "true" });
    return cfg;
  });
};

module.exports = withLlamaFromSource;
