const fs = require("fs");
const path = require("path");
const {
  withDangerousMod,
  withMainApplication,
} = require("expo/config-plugins");

const PACKAGE = "com.kalsa.app";
const IMPORT = `import ${PACKAGE}.GovernorBatteryPackage`;
const REGISTER = "add(GovernorBatteryPackage())";

function withGovernorBattery(config) {
  config = withDangerousMod(config, ["android", async (modConfig) => {
    const source = path.join(
      modConfig.modRequest.projectRoot,
      "native",
      "GovernorBatteryModule.kt",
    );
    const destination = path.join(
      modConfig.modRequest.platformProjectRoot,
      "app/src/main/java/com/kalsa/app/GovernorBatteryModule.kt",
    );
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(source, destination);
    return modConfig;
  }]);

  return withMainApplication(config, (modConfig) => {
    let contents = modConfig.modResults.contents;
    if (!contents.includes(IMPORT)) {
      contents = contents.replace(
        /^package [^\n]+\n/m,
        (line) => `${line}\n${IMPORT}\n`,
      );
    }
    if (!contents.includes(REGISTER)) {
      contents = contents.replace(
        /PackageList\(this\)\.packages\.apply \{/,
        (line) => `${line}\n          ${REGISTER}`,
      );
    }
    modConfig.modResults.contents = contents;
    return modConfig;
  });
}

module.exports = withGovernorBattery;
