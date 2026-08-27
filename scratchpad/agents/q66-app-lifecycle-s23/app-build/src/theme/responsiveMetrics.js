function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function computeResponsiveMetrics(input = {}) {
  const height = Number(input.height) || 812;
  const width = Number(input.width) || 390;
  const insets = input.insets || {};
  const topInset = Math.max(0, Number(insets.top) || 0);
  const bottomInset = Math.max(0, Number(insets.bottom) || 0);
  const isCompactHeight = height < 720;
  const isCompactWidth = width < 380;
  const horizontalPadding = isCompactWidth ? 14 : 18;
  const bottomNavBottom = Math.max(8, bottomInset + 8);
  const bottomNavHeight = isCompactHeight ? 62 : 68;
  const contentBottomPadding = bottomNavBottom + bottomNavHeight + (isCompactHeight ? 24 : 34);
  const topContentPadding = Math.max(18, topInset + (isCompactHeight ? 10 : 14));
  const askAssistantBottom = contentBottomPadding + 8;
  const availableHeight = Math.max(320, height - topContentPadding - askAssistantBottom);
  const askAssistantMaxHeight = clamp(
    Math.round(availableHeight * (isCompactHeight ? 0.78 : 0.72)),
    isCompactHeight ? 340 : 390,
    isCompactHeight ? 430 : 520,
  );

  return {
    askAssistantBottom,
    askAssistantMaxHeight,
    availableHeight,
    bottomInset,
    bottomNavBottom,
    bottomNavHeight,
    contentBottomPadding,
    horizontalPadding,
    isCompactHeight,
    isCompactWidth,
    screenHeight: height,
    screenWidth: width,
    topContentPadding,
    topInset,
  };
}

const DEFAULT_RESPONSIVE_METRICS = computeResponsiveMetrics();

function useResponsiveMetrics() {
  const React = require("react");
  const { useWindowDimensions } = require("react-native");
  const { useSafeAreaInsets } = require("react-native-safe-area-context");
  const dimensions = useWindowDimensions();
  const insets = useSafeAreaInsets();
  return React.useMemo(
    () => computeResponsiveMetrics({ height: dimensions.height, width: dimensions.width, insets }),
    [dimensions.height, dimensions.width, insets.bottom, insets.top],
  );
}

module.exports = {
  DEFAULT_RESPONSIVE_METRICS,
  computeResponsiveMetrics,
  useResponsiveMetrics,
};
