/**
 * Unlock display-matched UI refresh (scroll, gestures, keyboard, drawer,
 * composer chrome). Stream coalescer / 33ms token flush is untouched —
 * tokens stay ~30fps.
 *
 * WHY:
 * - Android OEMs often pin the window at 60Hz even on 90/120Hz panels.
 *   Samsung ignores preferredRefreshRate unless preferredDisplayModeId is
 *   also set. Pick the highest Display.Mode.refreshRate (never hardcode
 *   90/120) so 60-only panels stay 60. Re-apply on onResume: some OEMs
 *   reset the mode there.
 * - Apple: without CADisableMinimumFrameDurationOnPhone=true, Core
 *   Animation will not go above 60Hz on iPhone (iPad Pro does not need
 *   the key). See Reanimated #7984.
 */
const { withMainActivity, withInfoPlist } = require("@expo/config-plugins");

const METHOD = "applyHighestDisplayRefreshRate";
const PLIST_KEY = "CADisableMinimumFrameDurationOnPhone";

const KOTLIN_ON_RESUME = `
  override fun onResume() {
    super.onResume()
    ${METHOD}()
  }
`;

const KOTLIN_HELPER = `
  // Match the window to the panel's highest supported refresh rate.
  // Some OEMs reset preferredDisplayModeId on resume; re-apply here.
  private fun ${METHOD}() {
    val display = display ?: return
    val modes = display.supportedModes
    if (modes.isEmpty()) return
    var best = modes[0]
    for (mode in modes) {
      if (mode.refreshRate > best.refreshRate) best = mode
    }
    val params = window.attributes
    params.preferredDisplayModeId = best.modeId
    params.preferredRefreshRate = best.refreshRate
    window.attributes = params
    if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.R) {
      window.decorView.setFrameRate(
        best.refreshRate,
        android.view.Surface.FRAME_RATE_COMPATIBILITY_DEFAULT,
      )
    }
  }
`;

const JAVA_ON_RESUME = `
  @Override
  protected void onResume() {
    super.onResume();
    ${METHOD}();
  }
`;

const JAVA_HELPER = `
  // Match the window to the panel's highest supported refresh rate.
  // Some OEMs reset preferredDisplayModeId on resume; re-apply here.
  private void ${METHOD}() {
    android.view.Display display = getDisplay();
    if (display == null) {
      return;
    }
    android.view.Display.Mode[] modes = display.getSupportedModes();
    if (modes == null || modes.length == 0) {
      return;
    }
    android.view.Display.Mode best = modes[0];
    for (int i = 1; i < modes.length; i++) {
      if (modes[i].getRefreshRate() > best.getRefreshRate()) {
        best = modes[i];
      }
    }
    android.view.Window window = getWindow();
    android.view.WindowManager.LayoutParams params = window.getAttributes();
    params.preferredDisplayModeId = best.getModeId();
    params.preferredRefreshRate = best.getRefreshRate();
    window.setAttributes(params);
    if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.R) {
      window.getDecorView().setFrameRate(
        best.getRefreshRate(),
        android.view.Surface.FRAME_RATE_COMPATIBILITY_DEFAULT
      );
    }
  }
`;

function injectAfterSuper(src, method, stmt) {
  const re = new RegExp(
    `^[ \\t]*super\\.${method}\\s*\\([^)]*\\)\\s*;?[ \\t]*$`,
    "m",
  );
  if (!re.test(src)) return src;
  return src.replace(re, (line) => {
    const indent = line.match(/^[ \t]*/)[0];
    return `${line}\n${indent}${stmt}`;
  });
}

function hasOnResume(src, isKt) {
  return isKt
    ? /override\s+fun\s+onResume\s*\(/.test(src)
    : /void\s+onResume\s*\(/.test(src);
}

function insertBeforeLastBrace(src, block) {
  const i = src.lastIndexOf("}");
  if (i < 0) return src;
  const prefix = src.slice(0, i).replace(/\s*$/, "\n");
  return `${prefix}${block}\n${src.slice(i)}`;
}

function patchMainActivity(src, language) {
  if (src.includes(METHOD)) return src;
  const isKt = language === "kt";
  const call = isKt ? `${METHOD}()` : `${METHOD}();`;

  src = injectAfterSuper(src, "onCreate", call);

  if (hasOnResume(src, isKt)) {
    src = injectAfterSuper(src, "onResume", call);
  } else {
    src = insertBeforeLastBrace(src, isKt ? KOTLIN_ON_RESUME : JAVA_ON_RESUME);
  }

  return insertBeforeLastBrace(src, isKt ? KOTLIN_HELPER : JAVA_HELPER);
}

module.exports = function withDisplayRefreshRate(config) {
  config = withMainActivity(config, (c) => {
    c.modResults.contents = patchMainActivity(
      c.modResults.contents,
      c.modResults.language,
    );
    return c;
  });

  config = withInfoPlist(config, (c) => {
    c.modResults[PLIST_KEY] = true;
    return c;
  });

  return config;
};
