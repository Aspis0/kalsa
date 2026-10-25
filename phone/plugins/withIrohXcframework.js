/**
 * Make `pod install` build the KalsaIroh XCFramework on iOS.
 *
 * The KalsaIroh pod (modules/kalsa-iroh/ios) vendors the Rust static
 * libraries and the uniffi Swift bindings from modules/kalsa-iroh/ios/
 * Generated/ — a build output that is never committed. The podspec only
 * points at it, so something must produce it before pods resolve: this
 * plugin injects that call at the top of the generated Podfile, failing
 * the pod install loudly on a nonzero exit (same seam as
 * plugins/withLlamaIosSourceBuild.js and scripts/gen-metal-embed.js).
 *
 * The script runs only on the iOS path (a Podfile exists only after an
 * iOS prebuild), so Linux CI — which builds the Android APK with the
 * unchanged cargo-ndk pipeline — never runs Rust for Apple targets.
 */
const { withPodfile } = require("expo/config-plugins");

const MARKER = "# KALSA_IROH_XCFRAMEWORK";

const INJECTION = [
  MARKER,
  "kalsa_root = File.expand_path('..', __dir__)",
  "unless system('bash', File.join(kalsa_root, 'scripts', 'gen-iroh-xcframework.sh'))",
  '  raise "Kalsa: scripts/gen-iroh-xcframework.sh failed (#{$?}) - cannot build the KalsaIroh XCFramework"',
  "end",
].join("\n");

const withIrohXcframework = (config) =>
  withPodfile(config, (cfg) => {
    let { contents } = cfg.modResults;
    if (!contents.includes(MARKER)) {
      // Top of the Podfile: before `target` and any pod resolution.
      contents = `${INJECTION}\n\n${contents}`;
    }
    cfg.modResults.contents = contents;
    return cfg;
  });

module.exports = withIrohXcframework;
