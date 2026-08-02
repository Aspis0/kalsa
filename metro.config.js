// Expo default Metro config + Node built-in shims required by whisper.rn.
// whisper.rn → safe-buffer does require("buffer"); RN has no Node core modules.
const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

const bufferShim = path.resolve(__dirname, "src/shims/buffer.js");

const previousResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === "buffer") {
    return { type: "sourceFile", filePath: bufferShim };
  }
  if (previousResolveRequest) {
    return previousResolveRequest(context, moduleName, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
