# Kalsa for alpha testers

Kalsa is an AI that runs on your own computer: your messages stay there and the answers
are made there. Only web searches go out to the internet. You don't need any technical
knowledge to follow this guide.

## 1. What you need

- **A Mac with Apple Silicon** (M1 or newer), **or a 64-bit Windows PC** (tested on
  Windows 11).
- **Memory (RAM): 16 GB or more.** With less, Kalsa may offer only a small AI, or none.
  If it offers none, tell us.
- **About 30 GB of free disk space.** The AI download is 3 to 22 GB, depending on the
  computer.
- **An internet connection** for the first start. Some work or school networks block the
  download: if so, try again from home.

## 2. Install on Mac

The app is not signed by Apple yet, so macOS blocks it the first time.

**macOS 15 (Sequoia) or newer:**

1. Double-click the app. macOS says it can't open it: close the message.
2. Open **System Settings → Privacy & Security**, scroll down and click **Open Anyway**.
3. Confirm with your password or Touch ID, then open Kalsa again.

**Older macOS:** right-click the app, choose **Open**, then **Open** again.

If the app opens from a disk image (.dmg), drag it into **Applications** first.

## 3. Install on Windows

1. Run the installer. No administrator password is needed.
2. If Windows shows **"Windows protected your PC"**, click **More info**, then **Run
   anyway**.
3. Start Kalsa from the Start menu. If Windows asks whether Kalsa may use the network,
   choose **Allow**.

## 4. The first start

1. Open Kalsa and press **Start**: Kalsa checks your computer.
2. Pick one of the AIs it suggests with **Use this**.
3. Press **Download**. After the download, Kalsa tries a few settings to find the
   fastest one. The screen shows how many minutes are left.
4. When it finishes, you can chat.

This happens only once and can take a while, mostly for the download. Keep the computer
plugged in and don't let it go to sleep. If something fails, press **Try again**.

## 5. Phone

The Kalsa apps for Android and iOS will be released later.

## 6. When something goes wrong

During the alpha Kalsa sends us error reports on its own. When something serious
happens (for example the AI engine crashes), it also sends the app's log: a technical
record of what the app did. Neither ever contains your chats, your messages or your
files. When you first open Kalsa, a notice says:

> During the alpha, Kalsa sends error reports with technical details, and the app's log
> when something serious goes wrong. Never your chats or text. You can turn this off in
> Settings.

**To turn reports off:** **Settings** (top right) → untick **Error reports**.

**To send us the log yourself:** open the **AI** page, scroll to **Report a problem** and
press **Send the log**. Then tell us what you were doing and when.

**If the AI stops:** Kalsa restarts it on its own once. If that doesn't work, Home shows
**Stopped**: press **Try again**. If an answer was cut off, press **Retry** or **Try
again** under it.

**If the log can't be sent** (for example on a company network), press **Open the log
folder** and email us the file **kalsa-brain.log**.

The log folder is:

- **Mac:** `~/Library/Logs/ai.kalsa.brain/`
- **Windows:** `%LOCALAPPDATA%\ai.kalsa.brain\logs\`

## 7. Download

Download Kalsa from the private link we sent you. Please don't share it.

## 8. Uninstall

**Mac:** drag Kalsa from Applications to the Trash. To also delete its data (the AI is
the big one), in Finder press **⌘ ⇧ G**, paste each path and delete the folder:
`~/Library/Application Support/kalsa-brain`,
`~/Library/Application Support/ai.kalsa.brain`, `~/Library/Logs/ai.kalsa.brain`.

**Windows:** **Settings → Apps → Installed apps → Kalsa → Uninstall**. To also delete its
data, press **Windows + R**, paste each path, press Enter and delete what's inside:
`%LOCALAPPDATA%\kalsa-brain`, `%APPDATA%\ai.kalsa.brain`, `%LOCALAPPDATA%\ai.kalsa.brain`.
