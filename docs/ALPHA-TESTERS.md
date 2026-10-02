# Kalsa for alpha testers

Kalsa runs a private AI on your own computer. Your chats stay on that computer. Your
phone talks to this computer. This page gets you installed and through the first ten
minutes. It is written for non-technical testers — you don't need to know how anything
works.

## 1. What you need

- **A Mac with Apple Silicon** (M1 or newer). Intel Macs are not supported yet.
- **Or a Windows PC, 64-bit.** Windows 11 is what we have tested. Windows on ARM comes later.
- **16 GB of memory or more.** That is what we have tested (16 GB and 32 GB machines).
- **About 25 GB of free disk space.** The biggest AI the app may offer weighs about 22 GB.
  Smaller picks are 3–7 GB.
- **An internet connection** for the first start: it downloads the AI and the program that
  runs it (that part is only about 30 MB).
- Your phone, with the Kalsa app on it, for section 5.

## 2. Install on Mac

The app is not signed by Apple, so macOS warns you before opening it. There are two ways
through, depending on your macOS version.

**macOS 15 (Sequoia) or newer** — the old right-click trick no longer works here:

1. Open the app once (double-click). macOS says it can't be opened. Close that message.
2. Open **System Settings → Privacy & Security**.
3. Scroll down a little. You will see a note that Kalsa was blocked. Click **Open Anyway**.
4. Confirm (your password or Touch ID), then open Kalsa again.

**Older macOS:**

1. Right-click (or Control-click) the app, choose **Open**, then **Open** again.

If the app opens from a disk image, drag it into **Applications** first.

## 3. Install on Windows

1. Run the Kalsa installer. It installs for you only — no administrator password needed.
2. Windows may show **"Windows protected your PC"**. Click **More info**, then **Run anyway**.
3. Start Kalsa from the Start menu.

## 4. The first start (once, about 10 minutes)

1. Open Kalsa and press **Start**.
2. Kalsa checks your computer, then offers an AI. Take the suggestion — the app says it
   "checks your computer and picks the AI that runs best on it". Press **Use this**.
3. Confirm the download — the screen asks "Download …?" with your size in GB — by
   pressing **Download**.
4. The AI downloads (a few minutes), then Kalsa measures your computer:
   "Finding what runs fastest on your computer…". This takes about 6–7 minutes.
5. When it finishes, you can chat.

Keep the computer plugged in and awake, and leave the Kalsa window open until step 4
finishes. This measuring only happens the first time; later starts are quick.

## 5. Connecting your phone

In Kalsa, open **Devices**. Point your phone's camera at the square, or press
**Invite by link** and send the link to your phone. When your phone asks to connect,
choose **Allow**.

Your computer may ask whether Kalsa can find devices on your **local network**. Choose
Allow — without it, your phone cannot reach this computer.

## 6. When something goes wrong

<!-- LOG-FILE: filled in when the app writes its log file -->
Tell us what you were doing and when.

## 7. Download

<!-- DOWNLOAD-LINK -->

## 8. Uninstall

**Mac:** Drag Kalsa from Applications to the Trash, then empty the Trash. To remove its
data, in Finder press **⌘ ⇧ G**, paste `~/Library/Application Support/kalsa-brain`, and
delete that folder (it holds the downloaded AI — it is the big one). Do the same with
`~/Library/Application Support/ai.kalsa.brain`.

**Windows:** Open **Settings → Apps → Kalsa → Uninstall**. To remove its data, press
**Windows + R**, paste `%LOCALAPPDATA%\kalsa-brain`, press Enter, and delete what is in
there (the downloaded AI — the big one). Do the same with `%APPDATA%\ai.kalsa.brain`.
