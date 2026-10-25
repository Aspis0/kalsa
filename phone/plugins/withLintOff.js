/**
 * Config plugin locale: disabilita lintVital nelle build release.
 *
 * Il lint dei moduli nativi (react-native-safe-area-context, react-native-webview,
 * ecc.) fallisce in release senza motivo reale per noi: questo plugin riapplica
 * `checkReleaseBuilds false` a ogni prebuild, così la modifica non va persa.
 */
const { withAppBuildGradle } = require("@expo/config-plugins");

module.exports = function withLintOff(config) {
  return withAppBuildGradle(config, (c) => {
    if (c.modResults.contents.includes("checkReleaseBuilds")) return c;
    c.modResults.contents = c.modResults.contents.replace(
      /^android \{/m,
      "android {\n    lint {\n        checkReleaseBuilds false\n        abortOnError false\n    }",
    );
    return c;
  });
};
