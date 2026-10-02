/**
 * Make `pod install` compile the llama.rn fork from source on iOS.
 *
 * The fork ships no ios/rnllama.xcframework in its git tree — the podspec's
 * prebuilt branch points at a stub — so the pod MUST take its
 * RNLLAMA_BUILD_FROM_SOURCE branch (llama-rn.podspec evaluates the env var
 * during resolution). That branch compiles
 * vendor/llama.cpp/ggml/src/ggml-metal/*.{h,m,cpp,s}, and with
 * GGML_METAL_EMBED_LIBRARY=1 the .s files are link-time requirements that
 * upstream gitignores; the fork regenerates them only in its own
 * scripts/bootstrap.sh, which an npm git dependency never ships.
 *
 * The injected block therefore runs scripts/gen-metal-embed.js at Podfile
 * evaluation time (before pods resolve), failing the pod install loudly on a
 * nonzero exit, and then verifies the FULL embed set the engine's
 * GGML_METAL_LIBS table demands — a partial tree left by an interrupted run
 * must not sail through to a linker failure.
 *
 * Generation lives here, on the iOS path only. A root package.json
 * postinstall would also run on Android CI and write the .s files into the
 * installed binding, where scripts/assert-engine-provenance.sh counts every
 * extra file as divergence (it must stay able to prove Android's install
 * pristine). Consequence, accepted and documented in that script's header:
 * on an iOS dev machine the installed tree differs from the pristine fork by
 * exactly the generated embeds, so the gate reports DIVERGENT there.
 *
 * Android's half of "always build from source" lives in withLlamaFromSource.
 */
const { withPodfile } = require("expo/config-plugins");

const MARKER = "# KALSA_LLAMA_FROM_SOURCE_IOS";
// Relative to the Podfile's directory (ios/).
const METAL_DIR =
  "../node_modules/llama.rn/vendor/llama.cpp/ggml/src/ggml-metal";

// The kind scan mirrors scripts/gen-metal-embed.js metalLibKinds(): the
// engine's own X-macro table (GGML_METAL_LIBS in ggml-metal-device.m) is the
// authoritative list, not a directory glob.
const INJECTION = [
  MARKER,
  "ENV['RNLLAMA_BUILD_FROM_SOURCE'] = '1'",
  "kalsa_root = File.expand_path('..', __dir__)",
  "unless system('node', File.join(kalsa_root, 'scripts', 'gen-metal-embed.js'))",
  '  raise "Kalsa: node scripts/gen-metal-embed.js failed (#{$?}) - cannot build the llama.rn Metal embeds"',
  "end",
  `metal_dir = File.expand_path('${METAL_DIR}', __dir__)`,
  "device_source = File.read(File.join(metal_dir, 'ggml-metal-device.m'))",
  "kinds = device_source.scan(/^\\s*X\\(\\s*[A-Z0-9_]+\\s*,\\s*([a-z0-9_]+)\\s*\\)/).flatten",
  "raise 'Kalsa: no GGML_METAL_LIBS entries found in ' + metal_dir if kinds.empty?",
  "missing = kinds.reject { |kind| File.exist?(File.join(metal_dir, 'ggml-metal-embed-' + kind + '.s')) }",
  "unless missing.empty?",
  "  raise 'Kalsa: Metal embed assembly missing for ' + missing.join(', ') + ' in ' + metal_dir",
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
