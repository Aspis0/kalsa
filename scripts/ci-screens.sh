#!/usr/bin/env bash
# Visual regression capture for Kalsa on a KVM-accelerated emulator.
# Seeds AsyncStorage (no inference), restarts the app, and screenshots many
# states so a reviewer can look at all of them at once.
#
# Evidence (NN_slug.png + .txt, RESULT.txt) lands in ./e2e-out.
# Never exits non-zero for a missing/failed screen — only fatal setup dies.
set -uo pipefail
OUT="e2e-out"; mkdir -p "$OUT" "$OUT/seeds"
PKG=com.kalsa.app
# Default LFM2.5-2.6b (not the 4B) is intentional: lighter screens CI uses the
# smaller model so emulator captures stay fast and cheap (no inference runs).
MODEL_DIR="${MODEL_DIR:-lfm2.5-2.6b}"
MODEL_FILE="${MODEL_FILE:-LFM2.5-2.6B-QAD-Q4_0.gguf}"
# Must match ModelRegistry sizeBytes for the default model — isModelBundleDownloaded
# requires exact byte length, not just file presence.
MODEL_SIZE_BYTES="${MODEL_SIZE_BYTES:-1593894944}"
APK_PATH="${APK_PATH:-android/app/build/outputs/apk/release/app-release.apk}"

# shellcheck source=ci-lib.sh
source "$(dirname "$0")/ci-lib.sh"

# ── Result bookkeeping (capture tool, not a gate) ───────────────────────────
: > "$OUT/RESULT.txt"
# Model-ready UI: harness sparse-pads the GGUF to registry sizeBytes so
# isModelBundleDownloaded is true. Content is not a real model (no inference).
printf 'NOTE  model file is size-padded for UI coherence (no inference in screens)\n' >> "$OUT/RESULT.txt"
record() {
  # record OK|FAILED name "note"
  local status="$1" name="$2" note="$3"
  printf '%s  %s — %s\n' "$status" "$name" "$note" | tee -a "$OUT/RESULT.txt"
}

# Capture screenshot + ui_texts; verify optional marker substring in ui dump.
# Always writes NN_slug.png / .txt even on failure.
capture() {
  local name="$1" marker="${2:-}" note="${3:-}"
  # Bounded retry: a cold start on a shared runner is sometimes slower than the
  # fixed sleeps, and a single missed marker used to be recorded as FAILED with
  # no second look. Still fails after the last attempt — this hides flakiness,
  # not real breakage.
  local attempts=3 i=1
  while [ "$i" -le "$attempts" ]; do
    sleep 2
    shot "$name"
    ui_texts > "$OUT/${name}.txt" 2>/dev/null || true
    if [ -z "$marker" ]; then
      record OK "$name" "${note:-captured (no marker)}"
      return 0
    fi
    if grep -qF "$marker" "$OUT/${name}.txt" 2>/dev/null; then
      if [ "$i" -eq 1 ]; then
        record OK "$name" "${note:-marker ok}"
      else
        record OK "$name" "${note:-marker ok} (attempt $i)"
      fi
      return 0
    fi
    log "  marker not found for $name (attempt $i/$attempts)"
    i=$((i + 1))
    [ "$i" -le "$attempts" ] && sleep 6
  done
  record FAILED "$name" "${note:-marker missing}: expected «${marker}» after $attempts attempts"
  return 0
}


# ── Device helpers ──────────────────────────────────────────────────────────
restart_app() {
  local wait_s="${1:-20}"
  adb shell am force-stop "$PKG" >/dev/null 2>&1 || true
  sleep 2
  adb shell am start -n "$PKG/.MainActivity" >/dev/null 2>&1 || true
  sleep "$wait_s"
}

press_back() {
  adb shell input keyevent 4
  sleep 2
}

# Screen geometry (w h) for swipes; defaults if wm size is unreadable.
screen_wh() {
  local size
  size=$(adb shell wm size 2>/dev/null | tr -d '\r' | grep -oE '[0-9]+x[0-9]+' | tail -1)
  if [ -z "$size" ]; then
    echo "1080 2400"
    return
  fi
  echo "${size%x*} ${size#*x}"
}

# Scroll content down (finger moves up).
swipe_up() {
  local w h
  read -r w h <<< "$(screen_wh)"
  adb shell input swipe $((w / 2)) $((h * 7 / 10)) $((w / 2)) $((h * 3 / 10)) 350
  sleep 1
}

# Long-press a node by content-desc OR text (same lookup as tap_node).
long_press_node() {
  local needle="$1" duration_ms="${2:-1200}"
  local b n x1 y1 x2 y2 cx cy
  b=$(dump_ui | tr '>' '\n' \
      | grep -E "content-desc=\"$needle\"|text=\"$needle\"" \
      | grep -o 'bounds="\[[0-9]*,[0-9]*\]\[[0-9]*,[0-9]*\]"' | head -1)
  if [ -z "$b" ]; then
    log "node '$needle' NOT FOUND for long-press"
    return 1
  fi
  n=$(echo "$b" | grep -o '[0-9]\+' | tr '\n' ' ')
  read -r x1 y1 x2 y2 <<< "$n"
  cx=$(( (x1 + x2) / 2 ))
  cy=$(( (y1 + y2) / 2 ))
  log "long-press '$needle' at ${cx},${cy} (${duration_ms}ms)"
  adb shell input swipe "$cx" "$cy" "$cx" "$cy" "$duration_ms"
}

# ── AsyncStorage seeding via sqlite (force-stop first; app reads on mount) ──
# Complex JSON goes through a host-side SQL file + adb push to avoid shell
# quoting hell. Single-quote SQL escaping: ' → ''.
seed_kv() {
  local key="$1" value="$2"
  local esc
  esc=$(printf '%s' "$value" | sed "s/'/''/g")
  sql "INSERT OR REPLACE INTO catalystLocalStorage (key,value) VALUES ('$key','$esc');"
}

seed_kv_file() {
  local key="$1" file="$2"
  local sql_file="$OUT/_seed.sql"
  # node is available on the CI runner (and locally for dry verification).
  # Escape single quotes for SQL (' → '') without fighting bash quote nesting.
  node -e 'const fs=require("fs");const key=process.argv[1];const val=fs.readFileSync(process.argv[2],"utf8");const esc=val.replace(/\x27/g,"\x27\x27");fs.writeFileSync(process.argv[3],"INSERT OR REPLACE INTO catalystLocalStorage (key,value) VALUES (\x27"+key+"\x27,\x27"+esc+"\x27);\n");' \
    "$key" "$file" "$sql_file"
  adb push "$sql_file" /data/local/tmp/kalsa_seed.sql >/dev/null 2>&1
  adb shell "sqlite3 $DB < /data/local/tmp/kalsa_seed.sql" 2>&1 | tr -d '\r' || true
}

clear_messages() {
  sql "DELETE FROM catalystLocalStorage WHERE key='kalsa.messages.v1';" || true
}

# Force-stop → seed messages (or clear) → optional extra kv → restart.
# Usage: seed_chat <json_file|CLEAR> [extra key=value pairs as "key:value"]
seed_chat() {
  local src="$1"
  shift || true
  adb shell am force-stop "$PKG" >/dev/null 2>&1 || true
  sleep 2
  if [ "$src" = "CLEAR" ]; then
    clear_messages
  else
    seed_kv_file "kalsa.messages.v1" "$src"
  fi
  local pair k v
  for pair in "$@"; do
    k="${pair%%:*}"
    v="${pair#*:}"
    seed_kv "$k" "$v"
  done
  adb shell am start -n "$PKG/.MainActivity" >/dev/null 2>&1 || true
  sleep 20
}

set_base_prefs() {
  # Model id keeps Settings from looking totally empty; no inference is run.
  seed_kv "kalsa.model.id" "$MODEL_DIR"
  seed_kv "aspis-bio.theme" "light"
  seed_kv "kalsa.fontScale" "m"
}

# ── Seed JSON payloads (written under $OUT/seeds for offline verification) ──
write_seeds() {
  log "writing seed JSON under $OUT/seeds"

  # 07 / 21 — markdown kitchen sink
  cat > "$OUT/seeds/markdown.json" <<'JSON'
[
  {
    "id": "md-user-1",
    "role": "user",
    "text": "Show me every markdown construct.",
    "createdAt": 1700000001000
  },
  {
    "id": "md-asst-1",
    "role": "assistant",
    "text": "# Heading One\n## Heading Two\n### Heading Three\n\nA paragraph with **bold**, *italic* and `inline code`.\n\n- Unordered alpha\n- Unordered beta\n\n1. Ordered one\n2. Ordered two\n3. Ordered three\n4. Ordered four\n  - Nested under four\n\n> A blockquote about visual regression.\n\n---\n\nSee [the docs](https://example.com/path?q=1&x=two) for details.\n\nIdentifier _snake_case_name_ must render literally.\n\nMD_MARKDOWN_MARKER",
    "createdAt": 1700000002000
  }
]
JSON

  # 08 — fenced code block with a long line (horizontal scroll)
  cat > "$OUT/seeds/codeblock.json" <<'JSON'
[
  {
    "id": "cb-user-1",
    "role": "user",
    "text": "Show me a long code block.",
    "createdAt": 1700000001000
  },
  {
    "id": "cb-asst-1",
    "role": "assistant",
    "text": "Here is a fenced Python block with a deliberately long line:\n\n```python\ndef very_long_identifier_that_forces_horizontal_scroll_in_the_code_block_renderer_ABCDEFGHIJKLMNOPQRSTUVWXYZ_0123456789_end():\n    return \"CODEBLOCK_MARKER\"\n```\n\nCODEBLOCK_MARKER",
    "createdAt": 1700000002000
  }
]
JSON

  # 09 — web-search sources cards
  cat > "$OUT/seeds/sources.json" <<'JSON'
[
  {
    "id": "src-user-1",
    "role": "user",
    "text": "Search for something.",
    "createdAt": 1700000001000
  },
  {
    "id": "src-asst-1",
    "role": "assistant",
    "text": "Alpha reports one thing [1] and Beta another [3]. A number with no source [9] must stay literal, and [a link](https://example.com/x) must stay a link. SOURCES_MARKER",
    "createdAt": 1700000002000,
    "sources": [
      {
        "id": "s1",
        "title": "Example Source Alpha",
        "url": "https://example.com/a?q=1",
        "authors": "Ada Lovelace",
        "provider": "brave"
      },
      {
        "id": "s2",
        "title": "Example Source Beta",
        "url": "https://example.org/b",
        "doi": "10.1000/xyz",
        "provider": "exa-mcp"
      },
      {
        "id": "s3",
        "title": "SOURCES_MARKER card",
        "url": "https://example.net/c",
        "provider": "tavily"
      }
    ]
  }
]
JSON

  # 10 — 45 messages trip LONG_CHAT_MESSAGE_THRESHOLD (40)
  node -e '
    const msgs = [];
    const base = 1700000000000;
    for (let i = 0; i < 45; i++) {
      const user = i % 2 === 0;
      msgs.push({
        id: "long-" + i,
        role: user ? "user" : "assistant",
        text: user
          ? ("User turn " + i + " — filler about local inference and privacy.")
          : ("Assistant turn " + i + " — filler reply about on-device models."),
        createdAt: base + i * 1000,
      });
    }
    // Last message is assistant (index 43 is odd); stamp a marker there.
    msgs[43].text = "Assistant turn 43 — LONG_CHAT_MARKER end of long conversation.";
    process.stdout.write(JSON.stringify(msgs, null, 0));
  ' > "$OUT/seeds/long.json"

  # 12 — short chat for long-press menu
  cat > "$OUT/seeds/menu.json" <<'JSON'
[
  {
    "id": "menu-user-1",
    "role": "user",
    "text": "Hello for message menu.",
    "createdAt": 1700000001000
  },
  {
    "id": "menu-asst-1",
    "role": "assistant",
    "text": "MENU_MARKER reply ready for long-press copy or translate.",
    "createdAt": 1700000002000
  }
]
JSON

  # 14 / 15 / 23 — quiz miniapp card + open
  cat > "$OUT/seeds/miniapp.json" <<'JSON'
[
  {
    "id": "quiz-user-1",
    "role": "user",
    "text": "Make me a short quiz.",
    "createdAt": 1700000001000
  },
  {
    "id": "quiz-asst-1",
    "role": "assistant",
    "text": "Here is a quick quiz. QUIZ_MARKER",
    "createdAt": 1700000002000,
    "miniapp": {
      "schema": "miniapp_v1",
      "kind": "quiz",
      "title": "CI Quiz Marker",
      "blocks": [
        {
          "type": "quiz",
          "question": "What is 2 + 2? QUIZ_MARKER",
          "options": ["3", "4", "5", "22"],
          "answerIndex": 1,
          "explanation": "Basic arithmetic."
        }
      ]
    }
  }
]
JSON

  # 16 — font xl uses markdown seed so chat body is visible at large type
  cp "$OUT/seeds/markdown.json" "$OUT/seeds/font_xl.json"

  # 17 — short chat (3 msgs) with enough vision attachments to trip the
  # long-chat token estimate (pageCount/image slots × ESTIMATED_TOKENS_PER_IMAGE).
  # pageCount is the only PDF metadata sanitizeHistoryMessages keeps.
  cat > "$OUT/seeds/attachments_long.json" <<'JSON'
[
  {
    "id": "att-long-user-1",
    "role": "user",
    "text": "Please review these PDF pages and figures. ATTACH_LONG_MARKER",
    "createdAt": 1700000002000,
    "attachments": [
      {
        "id": "att-pdf-1",
        "kind": "pdf",
        "name": "paper-1.pdf",
        "uri": "",
        "pageCount": 5
      },
      {
        "id": "att-img-1a",
        "kind": "image",
        "name": "fig1a.png",
        "uri": ""
      },
      {
        "id": "att-img-1b",
        "kind": "image",
        "name": "fig1b.png",
        "uri": ""
      }
    ]
  },
  {
    "id": "att-long-asst-1",
    "role": "assistant",
    "text": "Reviewed batch 1: the figures show the expected trend.",
    "createdAt": 1700000003000
  },
  {
    "id": "att-long-user-2",
    "role": "user",
    "text": "More pages and figures, batch 2.",
    "createdAt": 1700000004000,
    "attachments": [
      {
        "id": "att-pdf-2",
        "kind": "pdf",
        "name": "paper-2.pdf",
        "uri": "",
        "pageCount": 5
      },
      {
        "id": "att-img-2a",
        "kind": "image",
        "name": "fig2a.png",
        "uri": ""
      },
      {
        "id": "att-img-2b",
        "kind": "image",
        "name": "fig2b.png",
        "uri": ""
      }
    ]
  },
  {
    "id": "att-long-asst-2",
    "role": "assistant",
    "text": "Reviewed batch 2: the figures show the expected trend.",
    "createdAt": 1700000005000
  },
  {
    "id": "att-long-user-3",
    "role": "user",
    "text": "More pages and figures, batch 3.",
    "createdAt": 1700000006000,
    "attachments": [
      {
        "id": "att-pdf-3",
        "kind": "pdf",
        "name": "paper-3.pdf",
        "uri": "",
        "pageCount": 5
      },
      {
        "id": "att-img-3a",
        "kind": "image",
        "name": "fig3a.png",
        "uri": ""
      },
      {
        "id": "att-img-3b",
        "kind": "image",
        "name": "fig3b.png",
        "uri": ""
      }
    ]
  },
  {
    "id": "att-long-asst-3",
    "role": "assistant",
    "text": "Reviewed batch 3: the figures show the expected trend.",
    "createdAt": 1700000007000
  },
  {
    "id": "att-long-user-4",
    "role": "user",
    "text": "More pages and figures, batch 4.",
    "createdAt": 1700000008000,
    "attachments": [
      {
        "id": "att-pdf-4",
        "kind": "pdf",
        "name": "paper-4.pdf",
        "uri": "",
        "pageCount": 5
      },
      {
        "id": "att-img-4a",
        "kind": "image",
        "name": "fig4a.png",
        "uri": ""
      },
      {
        "id": "att-img-4b",
        "kind": "image",
        "name": "fig4b.png",
        "uri": ""
      }
    ]
  },
  {
    "id": "att-long-asst-4",
    "role": "assistant",
    "text": "Reviewed batch 4: the figures show the expected trend.",
    "createdAt": 1700000009000
  }
]
JSON
}

write_seeds

# Optional dry-run: write seeds only (used by local verification without adb).
if [ "${SCREENS_SEEDS_ONLY:-0}" = "1" ]; then
  log "SCREENS_SEEDS_ONLY=1 — seeds written, skipping device work"
  exit 0
fi

# ── Fatal setup only ────────────────────────────────────────────────────────
[ -f "$APK_PATH" ] || die "APK not found at $APK_PATH"
if [ ! -f model.gguf ]; then
  log "no model.gguf — writing tiny dummy for install_and_sideload (screens never load it)"
  printf 'DUMMY_NO_INFERENCE\n' > model.gguf
fi

install_and_sideload "$APK_PATH" "model.gguf" "$MODEL_DIR" "$MODEL_FILE"

# isModelBundleDownloaded (ModelDownloader.ts) requires the GGUF to exist at
# exact registry sizeBytes. A tiny dummy fails that check → header shows
# "Download 1.7 GB" and Settings shows Active + Not downloaded while chat is
# seeded. Sparse-pad on device so size matches without filling the disk;
# screens never run inference so zero-filled content is fine.
# Skip when the file is already the expected size (real model present).
MODEL_ON_DEVICE="/data/data/$PKG/files/models/$MODEL_DIR/$MODEL_FILE"
actual_size=$(adb shell "stat -c %s '$MODEL_ON_DEVICE' 2>/dev/null" | tr -d '\r' || echo 0)
if [ "$actual_size" != "$MODEL_SIZE_BYTES" ]; then
  log "pad model file to ${MODEL_SIZE_BYTES} bytes (was ${actual_size:-0}) for ready-state UI"
  adb shell "dd if=/dev/zero of='$MODEL_ON_DEVICE' bs=1 count=0 seek=${MODEL_SIZE_BYTES}" 2>&1 | tr -d '\r' || true
  uid_line=$(adb shell "stat -c %U /data/data/$PKG" | tr -d '\r')
  adb shell "chown -R $uid_line:$uid_line /data/data/$PKG/files/models" 2>/dev/null || true
  adb shell "ls -la /data/data/$PKG/files/models/$MODEL_DIR/" | tr -d '\r' || true
else
  log "model file already ${MODEL_SIZE_BYTES} bytes — leaving as-is"
fi

log "base prefs (light, medium font, model id)"
adb shell am force-stop "$PKG" >/dev/null 2>&1 || true
sleep 2
set_base_prefs
sql "SELECT key,substr(value,1,40) FROM catalystLocalStorage;" | tee "$OUT/prefs_base.txt" || true

log "screen size: $(adb shell wm size 2>/dev/null | tr -d '\r')"

# ═══════════════════════════════════════════════════════════════════════════
# Light theme captures
# ═══════════════════════════════════════════════════════════════════════════

# 01_home — empty / welcome
log "01_home"
seed_chat CLEAR
capture 01_home "What do you want to investigate today?" "empty welcome"

# 02_drawer — hamburger open
log "02_drawer"
if tap_node "Menu"; then
  sleep 2
  capture 02_drawer "Settings" "drawer open"
else
  capture 02_drawer "Settings" "Menu node not found"
fi
# Close drawer if open (tap outside / back)
press_back

# 03–05 settings scroll positions
log "03_settings_top"
if tap_node "Menu"; then
  sleep 2
  if tap_node "Settings"; then
    sleep 3
    capture 03_settings_top "Settings" "settings top"
    log "04_settings_mid"
    swipe_up
    swipe_up
    capture 04_settings_mid "Settings" "settings mid scroll"
    log "05_settings_bottom"
    swipe_up
    swipe_up
    swipe_up
    swipe_up
    capture 05_settings_bottom "Settings" "settings bottom scroll"

    # 06_help — Help is near the end of Settings
    log "06_help"
    if tap_node "Open Help"; then
      sleep 3
      capture 06_help "Help" "help screen"
      press_back
    else
      capture 06_help "Help" "Open Help not found"
    fi
    press_back
  else
    capture 03_settings_top "Settings" "Settings node not found"
    capture 04_settings_mid "Settings" "skipped — settings not opened"
    capture 05_settings_bottom "Settings" "skipped — settings not opened"
    capture 06_help "Help" "skipped — settings not opened"
  fi
else
  capture 03_settings_top "Settings" "Menu not found"
  capture 04_settings_mid "Settings" "skipped"
  capture 05_settings_bottom "Settings" "skipped"
  capture 06_help "Help" "skipped"
fi

# Ensure we are back on chat for seeded states
press_back
press_back

# 07_chat_markdown
log "07_chat_markdown"
seed_chat "$OUT/seeds/markdown.json"
capture 07_chat_markdown "MD_MARKDOWN_MARKER" "seeded markdown kitchen sink"

# 08_chat_codeblock
log "08_chat_codeblock"
seed_chat "$OUT/seeds/codeblock.json"
capture 08_chat_codeblock "CODEBLOCK_MARKER" "seeded fenced code block"

# 09_chat_sources
log "09_chat_sources"
seed_chat "$OUT/seeds/sources.json"
# Prefer source card title; fall back to body marker
if dump_ui | grep -qF "SOURCES_MARKER"; then
  capture 09_chat_sources "SOURCES_MARKER" "seeded sources cards"
else
  capture 09_chat_sources "Example Source Alpha" "seeded sources (title check)"
fi

# 10_chat_long — 45 messages → long-conversation nudge
log "10_chat_long"
seed_chat "$OUT/seeds/long.json"
capture 10_chat_long "This conversation is getting long" "long-chat nudge banner"

# 11_attach_sheet
log "11_attach_sheet"
seed_chat CLEAR
if tap_node "Add attachment"; then
  sleep 2
  capture 11_attach_sheet "Photo from library" "attachment sheet open"
  press_back
else
  capture 11_attach_sheet "Photo from library" "Add attachment not found"
fi

# 12_message_menu — long-press assistant bubble
log "12_message_menu"
seed_chat "$OUT/seeds/menu.json"
if long_press_node "Long press for copy or translate" 1400; then
  sleep 2
  capture 12_message_menu "Copy" "message action sheet"
  press_back
else
  # Fallback: long-press by marker text node
  if long_press_node "MENU_MARKER reply ready for long-press copy or translate." 1400; then
    sleep 2
    capture 12_message_menu "Copy" "message action sheet (text bounds)"
    press_back
  else
    capture 12_message_menu "Copy" "long-press target not found"
  fi
fi

# 13_composer_typed — text in composer, keyboard visible (no ESC)
log "13_composer_typed"
seed_chat CLEAR "kalsa.kbDebug:1"
if tap_node "Ask a question…"; then
  sleep 3
  type_text "ComposerTypedMarker"
  sleep 2
  # Retry once if IME swallowed keystrokes
  if ! dump_ui | grep -qF "ComposerTypedMarker"; then
    log "typed text not visible — retrying once"
    tap_editable || tap_node "Ask a question…" || true
    sleep 2
    type_text "ComposerTypedMarker"
    sleep 2
  fi
  capture 13_composer_typed "ComposerTypedMarker" "composer with text + keyboard"
  # 13b: geometric assert — composer bottom must sit above IME top.
  # uiautomator reports nodes even when visually covered by the keyboard.
  # IME-shown probes: field names vary by API level (mInputShown on older,
  # isInputViewShown / mVisibleBound on newer); fall back to the insets source.
  ime_shown=false
  if adb shell dumpsys input_method 2>/dev/null | tr -d '\r' \
      | grep -qE 'mInputShown=true|isInputViewShown=true|mIsInputViewShown=true'; then
    ime_shown=true
  elif adb shell dumpsys window displays 2>/dev/null | tr -d '\r' \
      | grep -iE 'InsetsSource.*ime' | grep -q 'visible=true'; then
    ime_shown=true
  fi
  if [ "$ime_shown" = true ]; then
    # IME top: InsetsSource ime frame=[l,t][r,b] or frame=[l,t-r,b] → second int.
    ime_top=$(adb shell dumpsys window displays 2>/dev/null | tr -d '\r' \
      | grep -i 'ime' \
      | grep -oE 'frame=\[[0-9]+,[0-9]+' \
      | head -1 \
      | grep -oE '[0-9]+' | sed -n '2p' || true)
    ime_note=""
    # Sanity floor: some dumps expose a zero/degenerate ime frame even with the
    # keyboard up — an ime top in the top fifth of the screen is not plausible.
    if [ -z "${ime_top:-}" ] || ! [ "$ime_top" -gt 200 ] 2>/dev/null; then
      read -r _ screen_h <<< "$(screen_wh)"
      ime_top=$((screen_h * 55 / 100))
      ime_note=" (ime top estimated)"
    fi
    # Composer bottom from app EditText / marker (not Gboard suggestion echo).
    # Marker text also appears in the IME suggestion strip — require package.
    composer_b=$(dump_ui | tr '>' '\n' \
      | grep 'package="com.kalsa.app"' \
      | grep -F "ComposerTypedMarker" \
      | grep -oE 'bounds="\[[0-9]+,[0-9]+\]\[[0-9]+,[0-9]+\]"' | head -1 \
      | grep -oE '[0-9]+' | sed -n '4p' || true)
    if [ -z "${composer_b:-}" ]; then
      composer_b=$(dump_ui | tr '>' '\n' \
        | grep 'package="com.kalsa.app"' \
        | grep -F 'class="android.widget.EditText"' \
        | grep -oE 'bounds="\[[0-9]+,[0-9]+\]\[[0-9]+,[0-9]+\]"' | head -1 \
        | grep -oE '[0-9]+' | sed -n '4p' || true)
    fi
    if [ -z "${composer_b:-}" ] || ! [ "$composer_b" -ge 0 ] 2>/dev/null; then
      record FAILED 13b_composer_above_ime "composer bounds not found (app-node)${ime_note}"
    elif [ "$composer_b" -le $((ime_top + 8)) ]; then
      record OK 13b_composer_above_ime "composer bottom ${composer_b} <= ime top ${ime_top} (app-node)${ime_note}"
    else
      record FAILED 13b_composer_above_ime "composer bottom ${composer_b} > ime top ${ime_top} — composer covered by keyboard (app-node)${ime_note}"
    fi
  else
    record FAILED 13b_composer_above_ime "IME not shown"
  fi
  # Dismiss IME for subsequent taps
  adb shell input keyevent 111
  sleep 1
else
  capture 13_composer_typed "ComposerTypedMarker" "composer not found"
fi
# Reset kb debug seed so later steps do not keep the overlay flag.
seed_kv "kalsa.kbDebug" "0"

# 14_miniapp_quiz — card visible in chat
log "14_miniapp_quiz"
seed_chat "$OUT/seeds/miniapp.json"
capture 14_miniapp_quiz "CI Quiz Marker" "quiz miniapp card in chat"

# 15_miniapp_open — open the card modal
log "15_miniapp_open"
if tap_node "Open tool"; then
  sleep 3
  capture 15_miniapp_open "What is 2 + 2" "miniapp modal open"
  press_back
else
  capture 15_miniapp_open "What is 2 + 2" "Open tool not found"
fi

# 16_font_xl
log "16_font_xl"
seed_chat "$OUT/seeds/font_xl.json" "kalsa.fontScale:xl"
capture 16_font_xl "MD_MARKDOWN_MARKER" "font scale xl"

# 17_chat_attachments_long — short history + heavy attachments → long-chat nudge
log "17_chat_attachments_long"
seed_chat "$OUT/seeds/attachments_long.json"
capture 17_chat_attachments_long "This conversation is getting long" "attachment-heavy long-chat nudge"

# ═══════════════════════════════════════════════════════════════════════════
# Dark theme captures
# ═══════════════════════════════════════════════════════════════════════════
log "switching to dark theme"
adb shell am force-stop "$PKG" >/dev/null 2>&1 || true
sleep 2
seed_kv "aspis-bio.theme" "dark"
seed_kv "kalsa.fontScale" "m"
clear_messages
adb shell am start -n "$PKG/.MainActivity" >/dev/null 2>&1 || true
sleep 20

# 20_dark_home
log "20_dark_home"
capture 20_dark_home "What do you want to investigate today?" "dark empty welcome"

# 21_dark_chat_markdown
log "21_dark_chat_markdown"
seed_chat "$OUT/seeds/markdown.json" "aspis-bio.theme:dark"
capture 21_dark_chat_markdown "MD_MARKDOWN_MARKER" "dark markdown chat"

# 22_dark_settings_top
log "22_dark_settings_top"
if tap_node "Menu"; then
  sleep 2
  if tap_node "Settings"; then
    sleep 3
    capture 22_dark_settings_top "Settings" "dark settings top"
    press_back
  else
    capture 22_dark_settings_top "Settings" "Settings not found"
  fi
else
  capture 22_dark_settings_top "Settings" "Menu not found"
fi
press_back

# 23_dark_miniapp_open
log "23_dark_miniapp_open"
seed_chat "$OUT/seeds/miniapp.json" "aspis-bio.theme:dark"
if tap_node "Open tool"; then
  sleep 3
  capture 23_dark_miniapp_open "What is 2 + 2" "dark miniapp modal"
  press_back
else
  capture 23_dark_miniapp_open "What is 2 + 2" "Open tool not found"
fi

# ── Summary ────────────────────────────────────────────────────────────────
log "done — RESULT.txt:"
cat "$OUT/RESULT.txt"
ok_n=$(grep -c '^OK  ' "$OUT/RESULT.txt" 2>/dev/null || true)
fail_n=$(grep -c '^FAILED  ' "$OUT/RESULT.txt" 2>/dev/null || true)
ok_n=${ok_n:-0}
fail_n=${fail_n:-0}
log "summary: OK=$ok_n FAILED=$fail_n (capture tool — always exit 0 after setup)"
exit 0
