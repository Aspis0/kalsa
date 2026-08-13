/**
 * Android share-in: ACTION_SEND / SEND_MULTIPLE extras are not visible to
 * React Native Linking. Rewrite those intents to kalsa://share?text= or
 * kalsa://share?file= before RN reads getInitialURL / url events.
 *
 * Manifest filters are also declared in app.config.js android.intentFilters.
 * This plugin patches MainActivity (onCreate + onNewIntent) and fills in
 * filters if Expo's intentFilters merge missed SEND.
 */

const {
  withAndroidManifest,
  withMainActivity,
  AndroidConfig,
} = require("@expo/config-plugins");

const METHOD = "rewriteShareIntent";

const KOTLIN_IMPORTS = [
  "import android.content.Intent",
  "import android.net.Uri",
];

const KOTLIN_ON_NEW_INTENT = `
  override fun onNewIntent(intent: Intent) {
    ${METHOD}(intent)
    super.onNewIntent(intent)
    setIntent(intent)
  }
`;

const KOTLIN_HELPERS = `
  private fun ${METHOD}(intent: Intent?) {
    if (intent == null) return
    val action = intent.action ?: return
    val isSend = action == Intent.ACTION_SEND
    val isSendMultiple = action == Intent.ACTION_SEND_MULTIPLE
    if (!isSend && !isSendMultiple) return

    val mime = (intent.type ?: "").lowercase()
    val isPdf = mime == "application/pdf" || mime.endsWith("/pdf")
    val isText = mime == "text/plain" || mime.startsWith("text/")
    var shareUri: Uri? = null

    if (isPdf) {
      val stream = firstShareStream(intent, isSendMultiple)
      if (stream != null) {
        val copied = copyShareUriToCache(stream)
        if (copied != null) {
          shareUri = Uri.parse("kalsa://share?file=" + Uri.encode(copied) + "&t=" + System.currentTimeMillis())
        }
      }
    }

    if (shareUri == null) {
      val text = firstShareText(intent)
      if (!text.isNullOrEmpty()) {
        val clipped = if (text.length > 20000) text.substring(0, 20000) else text
        shareUri = Uri.parse("kalsa://share?text=" + Uri.encode(clipped) + "&t=" + System.currentTimeMillis())
      } else {
        val stream = firstShareStream(intent, isSendMultiple)
        if (stream != null) {
          val copied = copyShareUriToCache(stream)
          if (copied != null) {
            shareUri = Uri.parse("kalsa://share?file=" + Uri.encode(copied) + "&t=" + System.currentTimeMillis())
          }
        }
      }
    }

    if (shareUri == null) return
    if (isText && shareUri.toString().contains("file=") && !isPdf) {
      // text/* without EXTRA_TEXT: still a file share (e.g. .txt)
    }
    intent.action = Intent.ACTION_VIEW
    intent.data = shareUri
    intent.addCategory(Intent.CATEGORY_BROWSABLE)
  }

  private fun firstShareText(intent: Intent): String? {
    val extra = intent.getStringExtra(Intent.EXTRA_TEXT)
    if (!extra.isNullOrEmpty()) return extra
    val seq = intent.getCharSequenceExtra(Intent.EXTRA_TEXT)
    return seq?.toString()
  }

  private fun firstShareStream(intent: Intent, multiple: Boolean): Uri? {
    if (multiple) {
      val list =
        if (android.os.Build.VERSION.SDK_INT >= 33)
          intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM, Uri::class.java)
        else {
          @Suppress("DEPRECATION")
          intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM)
        }
      return list?.firstOrNull()
    }
    return if (android.os.Build.VERSION.SDK_INT >= 33)
      intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri::class.java)
    else {
      @Suppress("DEPRECATION")
      intent.getParcelableExtra(Intent.EXTRA_STREAM)
    }
  }

  private fun copyShareUriToCache(uri: Uri): String? {
    return try {
      val dir = java.io.File(cacheDir, "share-in")
      if (!dir.exists() && !dir.mkdirs()) return null
      var ext = "bin"
      val last = uri.lastPathSegment
      if (last != null) {
        val dot = last.lastIndexOf('.')
        if (dot >= 0 && dot < last.length - 1) {
          val raw = last.substring(dot + 1).lowercase()
          if (raw.matches(Regex("[a-z0-9]{1,8}"))) ext = raw
        }
      }
      if (ext == "bin") {
        val t = contentResolver.getType(uri) ?: ""
        if (t == "application/pdf") ext = "pdf"
        else if (t.startsWith("text/")) ext = "txt"
      }
      val dest = java.io.File(dir, "share-" + System.currentTimeMillis() + "." + ext)
      contentResolver.openInputStream(uri)?.use { input ->
        dest.outputStream().use { output ->
          val buf = ByteArray(64 * 1024)
          var total = 0L
          val max = 50L * 1024L * 1024L
          while (true) {
            val n = input.read(buf)
            if (n <= 0) break
            total += n.toLong()
            if (total > max) {
              dest.delete()
              return null
            }
            output.write(buf, 0, n)
          }
        }
      } ?: return null
      if (!dest.exists() || dest.length() <= 0L) {
        dest.delete()
        return null
      }
      dest.absolutePath
    } catch (_: Exception) {
      null
    }
  }
`;

function ensureImport(src, line) {
  if (src.includes(line)) return src;
  const pkg = src.match(/^package[^\n]+\n/m);
  if (!pkg) return `${line}\n${src}`;
  const idx = pkg.index + pkg[0].length;
  return src.slice(0, idx) + line + "\n" + src.slice(idx);
}

function injectBeforeSuperOnCreate(src) {
  if (src.includes(`${METHOD}(intent)`)) return src;
  const re = /^[ \t]*super\.onCreate\s*\([^)]*\)\s*;?[ \t]*$/m;
  if (!re.test(src)) return src;
  return src.replace(re, (line) => {
    const indent = line.match(/^[ \t]*/)[0];
    return `${indent}${METHOD}(intent)\n${line}`;
  });
}

function insertBeforeLastBrace(src, block) {
  const i = src.lastIndexOf("}");
  if (i < 0) return src;
  const prefix = src.slice(0, i).replace(/\s*$/, "\n");
  return `${prefix}${block}\n${src.slice(i)}`;
}

function patchMainActivity(src) {
  for (const line of KOTLIN_IMPORTS) {
    src = ensureImport(src, line);
  }
  src = injectBeforeSuperOnCreate(src);
  if (!/override\s+fun\s+onNewIntent\s*\(/.test(src)) {
    src = insertBeforeLastBrace(src, KOTLIN_ON_NEW_INTENT);
  } else if (!src.includes(`${METHOD}(intent)`)) {
    src = src.replace(
      /override\s+fun\s+onNewIntent\s*\([^)]*\)\s*\{/,
      (block) => `${block}\n    ${METHOD}(intent)`,
    );
  }
  if (!src.includes(`private fun ${METHOD}`)) {
    src = insertBeforeLastBrace(src, KOTLIN_HELPERS);
  }
  return src;
}

function hasShareFilter(intentFilters, action, mime) {
  return (intentFilters || []).some((filter) => {
    const actions = filter.action || [];
    const data = filter.data || [];
    const hasAction = actions.some((a) => a.$?.["android:name"] === action);
    const hasMime = data.some((d) => d.$?.["android:mimeType"] === mime);
    return hasAction && hasMime;
  });
}

function addShareFilter(android, action, mime) {
  AndroidConfig.IntentFilters.addIntentFilter({
    android,
    action,
    data: [{ mimeType: mime }],
    category: ["android.intent.category.DEFAULT"],
  });
}

function withShareManifest(config) {
  return withAndroidManifest(config, (mod) => {
    try {
      const android = mod.modResults;
      const main = AndroidConfig.Manifest.getMainActivityOrThrow(android);
      const filters = main["intent-filter"] || [];
      const pairs = [
        ["android.intent.action.SEND", "text/plain"],
        ["android.intent.action.SEND", "application/pdf"],
        ["android.intent.action.SEND_MULTIPLE", "text/plain"],
        ["android.intent.action.SEND_MULTIPLE", "application/pdf"],
      ];
      for (const [action, mime] of pairs) {
        if (!hasShareFilter(filters, action, mime)) {
          try {
            addShareFilter(android, action, mime);
          } catch {
            // app.config.js android.intentFilters is the primary path.
          }
        }
      }
    } catch {
      // Keep prebuild alive; intentFilters in app.config still apply.
    }
    return mod;
  });
}

module.exports = function withAndroidShareIntent(config) {
  config = withShareManifest(config);
  config = withMainActivity(config, (mod) => {
    if (mod.modResults.language === "kt") {
      mod.modResults.contents = patchMainActivity(mod.modResults.contents);
    }
    return mod;
  });
  return config;
};
