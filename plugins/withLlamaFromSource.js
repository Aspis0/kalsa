/**
 * Build llama.rn's native layer FROM SOURCE when KALSA_LLAMA_FROM_SOURCE=1.
 *
 * WHY THIS EXISTS: llama.rn ships PREBUILT jniLibs (downloaded by its npm
 * postinstall as llama-rn-android-jni-libs.tar.gz) and its android/build.gradle
 * reads `rnllamaBuildFromSource` (default "false") to decide whether to compile
 * cpp/ instead. With the default, every patch under patches/llama.rn+*.patch is
 * applied to source files that are NEVER COMPILED — the app keeps running the
 * upstream binary. That silently invalidated three native patches and two
 * diagnostics (2026-08-09): the DFlash loader gate, the restored-session
 * checkpoint, and the KVDIAG lines all had zero observable effect for the same
 * reason.
 *
 * Building from source costs a full llama.cpp compile per ABI, so it stays
 * opt-in: set KALSA_LLAMA_FROM_SOURCE=1 for runs that must exercise the
 * patches, and assert the marker afterwards (scripts/assert-native-patch.sh).
 */
const { withGradleProperties } = require("expo/config-plugins");

const PROPERTY = "rnllamaBuildFromSource";

const withLlamaFromSource = (config) => {
  if (process.env.KALSA_LLAMA_FROM_SOURCE !== "1") return config;

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
