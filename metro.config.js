// Expo default Metro config.
//
// NOTE: a hand-rolled `buffer` shim used to be aliased here for whisper.rn
// (→ safe-buffer → require("buffer")). It exported a plain OBJECT as Buffer,
// so safe-buffer's module body — which unconditionally runs
// `SafeBuffer.prototype = Object.create(Buffer.prototype)` (safe-buffer:24) —
// threw "Object prototype may only be an Object or null" inside metroRequire.
// Result: a deterministic release-build crash the moment voice transcription
// started (device logcat 2026-08-08 21:09:35, reproduced under node in
// scripts/bufferShimHarness.mjs). The real `buffer` polyfill package is a
// dependency now; do not reintroduce the alias.
const { getDefaultConfig } = require("expo/metro-config");

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

module.exports = config;
