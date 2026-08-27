module.exports = function (api) {
  api.cache(true);
  return {
    presets: ["babel-preset-expo"],
    // react-native-worklets/plugin MUST stay last (reanimated v4 requirement).
    plugins: ["react-native-worklets/plugin"],
  };
};
