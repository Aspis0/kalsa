/**
 * Compile llama.rn's native layer from source — the only option.
 *
 * The llama.rn fork ships no prebuilt jniLibs: its android/build.gradle reads
 * `rnllamaBuildFromSource` (default "false"), and on "false" CMake skips the
 * cpp/ build entirely and gradle still succeeds — producing an APK that has
 * no engine at all. So KALSA_LLAMA_FROM_SOURCE=0 is a hard error, and every
 * other value (unset, "1", anything else) sets rnllamaBuildFromSource=true.
 */
const { withGradleProperties } = require("expo/config-plugins");

const PROPERTY = "rnllamaBuildFromSource";

const withLlamaFromSource = (config) => {
  if (process.env.KALSA_LLAMA_FROM_SOURCE === "0") {
    throw new Error(
      "withLlamaFromSource: KALSA_LLAMA_FROM_SOURCE=0 is not supported: " +
        "the llama.rn fork ships no prebuilt jniLibs; the engine is always compiled from source",
    );
  }

  // Idempotent: reuse the existing property so incremental prebuilds keep a
  // single rnllamaBuildFromSource=true instead of accumulating duplicates.
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
      value: "Kalsa: always compile the llama.rn fork's cpp/ from source (the fork ships no prebuilt jniLibs)",
    });
    cfg.modResults.push({ type: "property", key: PROPERTY, value: "true" });
    return cfg;
  });
};

module.exports = withLlamaFromSource;
