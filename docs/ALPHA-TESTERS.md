# Kalsa for alpha testers

Kalsa runs a private AI on your own computer. Your messages are answered on this
computer; when Kalsa searches the web, the words of that search leave it. Your phone
talks to this computer. This page gets you installed and through the first start. It is
written for non-technical testers — you don't need to know how anything works.

## 1. What you need

- **A Mac with Apple Silicon** (M1 or newer). Intel Macs are not supported yet.
- **Or a Windows PC, 64-bit.** Windows 11 is what we have tested. Windows on ARM comes later.
- **Memory:** we have tested 16 GB and 32 GB. With 8 GB the app may still offer you a
  small AI. If it says no AI can run on this computer, there is nothing to press — tell us.
- **About 30 GB of free disk space, to be safe.** Depending on your computer, the first
  download is about 3 GB up to about 22 GB.
- **An internet connection** for the first start: Kalsa downloads a small program first,
  then the AI. On some work or school networks the download is blocked — Kalsa says
  "Kalsa couldn't download what she needs on this network. Try another network." Try
  again at home.
- **Your phone:** install the Kalsa phone app from the link we send you, and keep it
  updated. <!-- PHONE-APP-LINK -->

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

## 4. The first start (once)

1. Open Kalsa and press **Start**. Under the button, Kalsa says it checks your computer
   and picks the AI that runs best on it.
2. Kalsa checks your computer, then offers **two** choices. Each one shows its name, a
   size, and either "Smarter answers." or "Faster answers.", with its own **Use this**
   button. Pick one. If the AI is already on the computer, there is no download question.
   **Cancel** takes you back a step.
3. Kalsa downloads a small program first, then the AI (the screen asks "Download …?"
   with the size in GB). It then measures your computer: "Finding what runs fastest on
   your computer…" — about 6–7 minutes.
4. When it finishes, you can chat.

Keep the computer plugged in and awake, and leave the Kalsa window open until step 3
finishes. If something fails, the app shows **Try again** — press it. This measuring
happens only once. Later, Kalsa starts by itself when you open it; that takes up to a
minute or two.

The first start takes about 10 minutes on a smaller computer. On a big Mac or PC with a
large AI it can take 30 minutes or more — most of it is the download, so it depends on
your internet speed.

## 5. Connecting your phone

Kalsa must be on: if the page says this computer is not running, press **Turn Kalsa on**.
On Kalsa's home page, under **This computer**, open **Devices**. Point your phone's
camera at the square, or press **Invite by link** and send the link to your phone — it
works once, for one day. The app warns: "Anyone who can see this square can connect a
phone — show it only to yours."

The **Allow** button is on this computer, not on the phone. The Devices page shows
"Waiting for your OK", then "A phone is connecting. Choose Allow or Refuse below." —
press **Allow**.

If Windows asks whether Kalsa may use the network, choose Allow. This may appear the
first time.

## 6. When something goes wrong

Kalsa keeps a log: a record of what the app did. It is the first thing we need when
something goes wrong.

**To send it from inside Kalsa:** open the **AI** page (on the home page, under
**This computer**) and find **Report a problem** at the bottom. Press **Send the log**.
Kalsa answers with a report number — send that number to the person who gave you Kalsa.
Tell us what you were doing and when.

The screen says, in Kalsa's own words, what the log holds and what it never holds:

> The log never contains your messages, Kalsa's answers, your files, or any code or key.
>
> It holds what Kalsa did and what this computer has: versions, processor, graphics card, memory, errors.

**If Kalsa says "Your network (e.g. a company network) blocks the upload."**, the log
could not be sent automatically. Press **Open the log folder** instead: a folder opens
on your computer. Send the file **kalsa-brain.log** by email to the person who gave you
Kalsa. If you also see **kalsa-brain.1.log**, send that file too.

The log folder is:

- **Mac:** `~/Library/Logs/ai.kalsa.brain/`
- **Windows:** `%LOCALAPPDATA%\ai.kalsa.brain\logs\`

**If Kalsa did not close normally last time**, the next time you open it a card says
**Kalsa did not close normally last time** and offers to send the log: press **Send the
log**, or **Not now** to skip it. Nothing is sent unless you press the button. The same
card appears if something goes wrong while Kalsa is running.

## 7. Download

<!-- DOWNLOAD-LINK -->

## 8. Uninstall

**Mac:** Drag Kalsa from Applications to the Trash, then empty the Trash. To remove its
data, in Finder press **⌘ ⇧ G**, paste each of these, and delete the folder:
`~/Library/Application Support/kalsa-brain` (the downloaded AI — the big one),
`~/Library/Application Support/ai.kalsa.brain`, and `~/Library/Logs/ai.kalsa.brain`.

**Windows:** Open **Settings → Apps → Installed apps → Kalsa → Uninstall**. To remove
its data, press **Windows + R**, paste each of these, press Enter, and delete what is
inside: `%LOCALAPPDATA%\kalsa-brain` (the downloaded AI — the big one),
`%APPDATA%\ai.kalsa.brain`, and `%LOCALAPPDATA%\ai.kalsa.brain` (the web view's own
data and the logs).
