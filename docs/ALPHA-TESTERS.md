# Kalsa for alpha testers

Kalsa runs a private AI on your own computer. Your messages are answered on this
computer; when Kalsa searches the web, the words of that search leave it. Your phone
talks to this computer. This page gets you installed and through the first start. It is
written for non-technical testers — you don't need to know how anything works.

## 1. What you need

- **A Mac with Apple Silicon** (M1 or newer). Intel Macs are not supported yet.
- **Or a Windows PC, 64-bit.** Windows 11 is what we have tested. Windows on ARM comes later.
- **Memory:** we have tested 16 GB and 32 GB. With 8 GB the app may still offer you a
  small AI. If the first-start screen says **Pick the AI** and offers no choice, no AI
  Kalsa has runs well enough on this computer. The screen says, in English: "This computer
  is not worth using: it can give a model … and the smallest one in the catalog needs …."
  Under **Show details** it says: "Kalsa doesn't have an AI that runs well on this computer
  yet. Check for an app update." Check for an app update. If you still get no choice,
  tell us.
- **About 30 GB of free disk space, to be safe.** Depending on your computer, the first
  download is about 3 GB up to about 22 GB.
- **An internet connection** for the first start: Kalsa downloads the AI first. On some
  work or school networks the download is blocked — Kalsa says
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
2. Kalsa checks your computer, then offers the AIs that suit it (usually two). Each one
   shows its name, a size, and either "Smarter answers." or "Faster answers.", with its
   own **Use this** button. Pick one. If the AI is already on the computer, there is no
   download question. **Cancel** takes you back a step.
3. Kalsa asks "Download … GB?" with the size. Press **Download**. Then it downloads the
   AI and measures your computer: "Finding what runs fastest on your computer…". The
   screen shows about how many minutes are left.
4. When it finishes, you can chat.

Keep the computer plugged in and awake until the first start finishes. You can minimize
Kalsa while it works. If something fails, the app shows **Try again** — press it. This
measuring happens only once. Later, Kalsa starts by itself when you open it; the screen
says "Getting ready." and this can take a minute on a slower computer.

The first start can take a long time. Most of it is the download, so it depends on your
internet speed.

## 5. Connecting your phone

Kalsa must be on. If the Home page says Kalsa is off, press **Turn on**.
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

**Kalsa sends some reports by itself.** During the alpha, Kalsa sends error reports with
technical details. For these serious problems it also sends the app's log:

- the AI engine stops or crashes, at any time;
- the AI engine cannot run on this computer, or its program cannot be downloaded. The
  screen says "Kalsa can't run on this computer yet." or "Kalsa couldn't download what
  she needs.";
- the first-start check of this computer cannot finish reliably. The screen says "Kalsa
  couldn't check this computer."

A failed AI download, a failed web search and a full disk do not send the log. Kalsa
never sends your chats or your text. At most three logs a day are sent this way.

The log never contains your messages, Kalsa's answers, your files, or any code or key.
It holds what Kalsa did and what this computer has: versions, processor, graphics card,
memory, errors.

The first time you open Kalsa, a notice says:

> During the alpha, Kalsa sends error reports with technical details, and the app's log
> when something serious goes wrong. Never your chats or text. You can turn this off in
> Settings.

Press **Dismiss** to close it.

**To turn it off:** open **Settings** (top right), find **Error reports**, and untick it.
If you turn it off, it stays off, also after you restart Kalsa.

**To send a log yourself:** open the **AI** page (on the home page, under **This
computer**). Scroll to **Report a problem** at the bottom and press **Send the log**. Kalsa
says "Sent. Thank you." Tell us what you were doing and when.

**If the AI engine stops by itself:** if Kalsa was on, it starts the engine again, once.
It does not do this after an out-of-memory stop, or when the engine stops again before it
has run for ten minutes after the restart. Then Home says **Stopped** and "Kalsa stopped
by herself. Turn her on again." Press **Try again**.

If the restart works, a small line appears: "Kalsa recovered from an error." It goes
away after six seconds. If error reports are off, the line also has **Send the log**.
Press **Dismiss** to close it.

**If a reply was cut:** when the engine stops by itself and Kalsa restarts it, a reply that
the stop cut off says "The answer was interrupted." Press **Retry** to ask again. Any other
cut reply says "The answer stopped halfway." and has a **Try again** button. If Kalsa is
off, that box says "Kalsa is off." and offers **Turn Kalsa on**.

**If Kalsa says "Your network (e.g. a company network) blocks the upload."** when you
press **Send the log**, the log was not sent. Press **Open the log folder** instead: a
folder opens on your computer. Send the file **kalsa-brain.log** by email to the person
who gave you Kalsa. If you also see **kalsa-brain.1.log**, send that file too.

**On a work or school network** the reports may not get through. Kalsa keeps them for up
to 30 days and sends them when the computer is on another network. You do not need to do
anything.

The log folder is:

- **Mac:** `~/Library/Logs/ai.kalsa.brain/`
- **Windows:** `%LOCALAPPDATA%\ai.kalsa.brain\logs\`

## 7. Download

Download Kalsa at **https://kalsa.io/download**.

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
