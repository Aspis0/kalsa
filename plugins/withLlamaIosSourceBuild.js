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
 * A second injection goes inside the existing post_install hook: it drops the
 * x86_64 simulator slice (EXCLUDED_ARCHS) for every pod target and for the app
 * target, because the from-source build compiles arch-specific engine sources
 * into that slice where they cannot link. The WHY lives in the injected
 * comment, next to the code it explains.
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

const ARCH_MARKER = "# KALSA_EXCLUDED_ARCHS_X86_64";
// CocoaPods rejects a second `post_install` hook, so the arch exclusion has to
// go inside the one the template already defines.
const POST_INSTALL_ANCHOR = "  post_install do |installer|\n";
const ARCH_INJECTION = [
  `    ${ARCH_MARKER}`,
  "    # WHY: building from source runs the podspec's ggml-cpu/**/*.{h,c,cpp}",
  "    # glob for every slice, so arch/arm/quants.c is also compiled into the",
  "    # x86_64 simulator slice, where its non-NEON fallbacks leave dangling",
  "    # `_generic` references at link. Every supported dev Mac is Apple Silicon,",
  "    # which runs the arm64 simulator natively, so that slice is dead weight",
  "    # (~half the pod build). SDK-scoped: device builds keep x86_64.",
  "    excluded_archs_key = 'EXCLUDED_ARCHS[sdk=iphonesimulator*]'",
  "    app_targets = installer.aggregate_targets.flat_map do |aggregate_target|",
  "      aggregate_target.user_project ? aggregate_target.user_project.targets : []",
  "    end",
  "    (installer.pods_project.targets + app_targets).each do |target|",
  "      target.build_configurations.each do |build_config|",
  "        build_settings = build_config.build_settings",
  "        build_settings[excluded_archs_key] = Array(build_settings[excluded_archs_key]) | ['x86_64']",
  "      end",
  "    end",
].join("\n");

const withLlamaIosSourceBuild = (config) =>
  withPodfile(config, (cfg) => {
    let { contents } = cfg.modResults;
    if (!contents.includes(MARKER)) {
      // Top of the Podfile: before `target` and any pod resolution.
      contents = `${INJECTION}\n\n${contents}`;
    }
    if (!contents.includes(ARCH_MARKER)) {
      const anchor = contents.indexOf(POST_INSTALL_ANCHOR);
      if (anchor === -1) {
        throw new Error(
          "withLlamaIosSourceBuild: no `post_install do |installer|` hook in the " +
            "Podfile; cannot inject the x86_64 simulator exclusion"
        );
      }
      const insertAt = anchor + POST_INSTALL_ANCHOR.length;
      contents = `${contents.slice(0, insertAt)}${ARCH_INJECTION}\n${contents.slice(insertAt)}`;
    }
    cfg.modResults.contents = contents;
    return cfg;
  });

module.exports = withLlamaIosSourceBuild;
