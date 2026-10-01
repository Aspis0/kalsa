/**
 * Make `pod install` compile the llama.rn fork from source on iOS.
 *
 * The fork ships no ios/rnllama.xcframework in its git tree — the podspec's
 * prebuilt branch points at a stub — so the pod MUST take its
 * RNLLAMA_BUILD_FROM_SOURCE branch (llama-rn.podspec evaluates the env var
 * during resolution). That branch compiles
 * vendor/llama.cpp/ggml/src/ggml-metal/*.{h,m,cpp,s}, and with
 * GGML_METAL_EMBED_LIBRARY=1 the .s files are link-time requirements that
 * upstream gitignores; scripts/gen-metal-embed.js (package.json postinstall)
 * produces them. This plugin injects the env into the generated Podfile —
 * so it is set before CocoaPods resolves the podspec — and fails loudly when
 * the embeds are missing instead of letting the build die in the linker.
 *
 * Android's half of "always build from source" lives in withLlamaFromSource.
 */
const { withPodfile } = require("expo/config-plugins");

const MARKER = "# KALSA_LLAMA_FROM_SOURCE_IOS";
// Relative to the Podfile's directory (ios/).
const METAL_DIR =
  "../node_modules/llama.rn/vendor/llama.cpp/ggml/src/ggml-metal";

const INJECTION = [
  MARKER,
  "ENV['RNLLAMA_BUILD_FROM_SOURCE'] = '1'",
  `metal_dir = File.expand_path('${METAL_DIR}', __dir__)`,
  "unless Dir[File.join(metal_dir, 'ggml-metal-embed-*.s')].any?",
  "  raise 'Kalsa: llama.rn Metal embed assembly is missing in ' + metal_dir + " +
    "' — run npm install so scripts/gen-metal-embed.js can generate it'",
  "end",
].join("\n");

const withLlamaIosSourceBuild = (config) =>
  withPodfile(config, (cfg) => {
    if (cfg.modResults.contents.includes(MARKER)) {
      return cfg;
    }
    // Top of the Podfile: before `target` and any pod resolution.
    cfg.modResults.contents = `${INJECTION}\n\n${cfg.modResults.contents}`;
    return cfg;
  });

module.exports = withLlamaIosSourceBuild;
