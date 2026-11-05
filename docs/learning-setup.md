# Mysthi learning: setup and daily use

Mysthi is a black cat who lives on your desktop and learns how you work. While you work, it watches which steps you repeat, and when you have done the same task a few times it writes a short lesson into your Obsidian vault.

## What it does and doesn't do

- Everything stays on this Mac. Screenshots are described by a local model (Ollama, `qwen3-vl:8b-instruct`). Nothing is sent to any server.
- It only learns while you are working. The lessons are built while you are idle (about 3 minutes without keyboard or mouse), not while you type.
- A task becomes a confident lesson after you have done it 3 times.

### What is never recorded

These are built into how Mysthi works:

- Password fields are dropped inside the capture helper, before anything reaches the app.
- Screenshots and raw keystrokes are never written to disk.
- In Terminal, iTerm2 and Warp, and in any field the helper identifies as a terminal, typed text is recorded only when the terminal echoes it on its last visible line, and never when that line contains a password-prompt word (`password`, `sudo`, `token`, `secret`, `API key`, ...).
- In code editors (VS Code, VS Code Insiders, Cursor, VSCodium, Zed), typed text is recorded only from a field macOS Accessibility reports as a text field or text area with a name or description that does not mention "terminal". Anything Mysthi can't classify, including an integrated terminal it can't recognise, is dropped. An integrated terminal it does recognise follows the terminal rule above.
- A screenshot is described only if the app (and, for a browser, the site) that is in front at the moment of capture may be watched; otherwise it is thrown away unread. Typing that is cut off by switching apps or windows gets no screenshot.
- Mysthi's own windows are never recorded or captured.
- Nothing is captured while learning is paused or off.

Limits: other apps with built-in terminals (for example JetBrains IDEs or Hyper) are not covered by the terminal rule; add them to `do-not-watch.md`. A screenshot shows the whole display, so a do-not-watch window that is visible next to the app in front can still appear in it.

### What is filtered on a best-effort basis

These checks use pattern matching, so they can miss things. They are not a guarantee.

- Apps and websites in `do-not-watch.md` are skipped (see below). It starts with a built-in list of password managers, messaging apps (Messages, WhatsApp, Messenger, Telegram, Discord, Signal) and social media (Facebook, Instagram, Threads, X, TikTok, Snapchat, LinkedIn, Reddit, Pinterest, Tumblr, Bluesky, Mastodon), plus their websites, and Mysthi also tries to recognise banking sites by domain and keywords.
- Text typed into a field labelled like a password prompt (password, `sudo`, PIN, verification code, token, secret, API key, private key, and similar) is not recorded.
- Before text is saved, Mysthi tries to replace secrets with placeholders: `[PASSWORD]`, `[API_KEY]`, `[SECRET]`, `[PRIVATE_KEY]`, `[IP]`, `[IBAN]`, `[CARD]`, `[PHONE]`, `[CNP]`, `[PIN]`. The same applies to the chat history and to notes you ask her to remember.

Because of this, add any sensitive app or site you use to `do-not-watch.md` yourself.

### Known limits

What the filters above do **not** catch, on purpose or because pattern matching can't tell:

- **Email addresses** and **street addresses** are kept. They are often what a lesson or a note is about ("send it to …"), so hiding them would break notes you ask her to keep.
- **Short codes without a label:** "PIN 4821" or "CVV: 123" is hidden, but "my code is 4821" or a card expiry like "12/27" is not.
- **Secrets that look like ordinary words**, for example a password typed into a normal text field ("the wifi is sunshine"), or a key split across lines.
- **Names and personal details** in window titles or on screen (a chat partner's name in a title bar, for example).
- **Text on screen** that the vision model reads: it is redacted the same way, with the same limits.
- **Copies outside the app:** notes are plain files in your vault, so Time Machine, Obsidian Sync (if you turn it on) or any other backup keeps its own copies. Deleting a note in the app does not remove those.
- **What she infers** from your screen (`lessons/`, `knowledge/`) can be wrong; notes you asked her to remember (`memory/`) are marked as yours and win when they disagree.

The full list of checked examples is in `test/learning/redact.test.js`.

### Network

Mysthi talks to one thing: the local Ollama on `127.0.0.1`. The address can be changed only to another local one (`MYSTHI_OLLAMA_URL`); anything else is ignored. There is no telemetry and no cloud API; a test checks that no code opens other connections.

### What is stored locally

The redacted step journal and Mysthi's working state live in `~/Library/Application Support/jean-claude-duck/learning`. Recorded steps are kept for **30 days** and then deleted automatically (to change it, set `journalRetentionDays` in `~/Library/Application Support/jean-claude-duck/config.json`). To delete them all now: Mysthi's menu, **Delete Mysthi's screen journal…**. Your lessons and notes are not touched.

The chat history is kept in the same folder's `config.json` (the last 200 messages, redacted). **Clear** in the chat window empties it.

### Where your notes go

Everything is plain Markdown in `~/ObsidianVault/mysthi/`:

| Folder | What is in it |
| --- | --- |
| `lessons/` | One note per repeated task, with the steps, `times_observed` and `confident` |
| `knowledge/` | Facts Mysthi picked up about your tools and workflow |
| `log/` | A daily log listing what was learned that day |
| `reports/` | The weekly report |
| `memory/` | Notes you asked her to keep ("remember …" / "ține minte …"), marked `source: user-explicit` |
| `.trash/` | Notes you deleted from the chat, until you choose **Empty Mysthi's trash…** in her menu |
| `do-not-watch.md` | Your block list |

Tray menu, "Open lessons folder" opens `lessons/`.

### Editing the do-not-watch list

Open `~/ObsidianVault/mysthi/do-not-watch.md`. It has two sections, `## Apps` (macOS bundle ids, for example `com.1password.1password`) and `## Websites` (domains, for example `mybank.com`; subdomains and `www.` are included, and a pasted URL such as `https://mybank.com/login` is reduced to its domain). Add one `- item` per line and save. Mysthi re-reads the file about once a minute.

The file is created once and never overwritten. If yours was created before the built-in list grew (password-manager and social media sites, more messaging apps), those are still blocked; they just aren't listed in your file. Delete the file to have Mysthi write a fresh one with the current list.

## One-time setup checklist

macOS ties the Screen Recording, Accessibility and Input Monitoring permissions to the app's code signature. A stable local signing certificate means you grant them once and they survive rebuilds.

- [ ] **a. Fix Command Line Tools** (needed to build the Swift helper). On this Mac the install is broken, so reinstall it:
  ```
  sudo rm -rf /Library/Developer/CommandLineTools
  xcode-select --install
  ```
  Then check `npm run build:helper` finishes without errors.
- [ ] **b. Pull the model:** `ollama pull qwen3-vl:8b-instruct` (expect `success`; needs Ollama 0.40 or newer — `brew upgrade ollama` if the pull says to update). Ollama must be running when you use learning.
- [ ] **c. Create the signing certificate "Mysthi Local Signing":**
  1. Open Keychain Access.
  2. Menu bar: Keychain Access, Certificate Assistant, Create a Certificate...
  3. Name: `Mysthi Local Signing`. Identity Type: Self Signed Root. Certificate Type: Code Signing.
  4. Create, then Done.
  5. Verify: `security find-identity -v -p codesigning` lists `Mysthi Local Signing`.
- [ ] **d. Build:** `npm run build`. If electron-builder fails with a signing error about the identity, step (c) was not done. This builds the helper and then the app. Result: `dist/mac-arm64/Mysthi.app`. Optional check: `codesign -dv --verbose=2 "dist/mac-arm64/Mysthi.app/Contents/Resources/mysthi-helper"` shows `Authority=Mysthi Local Signing`.
- [ ] **e. Launch and grant permissions:** open `dist/mac-arm64/Mysthi.app`. From the tray icon choose **Start learning**. Mysthi asks for **Screen Recording**, **Accessibility** and **Input Monitoring**; use the "Open ..." buttons in its dialog to jump to System Settings, switch Mysthi (or mysthi-helper) on for each, then return. Mysthi notices the change on its own.

macOS may ask for Automation access ("System Events") the first time; that is Mysthi checking which app is in front.

## Daily use

- **Pause / resume:** press **⌘⇧M**, or **⌥-click** the pet, or use Pause learning in the tray menu.
- **Closed eyes** on Mysthi mean learning is on but not watching right now: paused, a permission is missing, or you are in an app/site on the block list. When the model is unavailable the eyes stay open: steps are still recorded and are learned once the model is back (the tray says `Learning: model unavailable`).
- **Tray status line** (first item, greyed out):
  - `Learning: watching` - all good.
  - `Learning: paused` - you paused it.
  - `Learning: off` - learning is not started.
  - `Learning: model unavailable` - Ollama or the model isn't reachable.
  - `Learning: missing permissions` - one of the three permissions is not granted.
  - `Learning: not watching this app` - the front app or site is on the block list.
- **Weekly report:** about once a week Mysthi writes a report into `reports/` and shows a notification, "Mysthi's weekly report is ready". Click it to open the report.

## Verification checklist

- [ ] **Lesson from repetition:** do one 4-6 step task (for example exporting a frame in Figma) 3 times, with at least 4 minutes idle after each. Then `~/ObsidianVault/mysthi/lessons/` has one lesson for it with `times_observed: 3` and `confident: true`, and today's file in `log/` lists it.
- [ ] **Secrets stay out:** in Terminal, type an `ssh` command with an IP address, and at a `sudo` prompt type a password (for example `hunter2`). After idle time, this prints nothing:
  ```
  grep -r "hunter2\|192.168" ~/ObsidianVault/mysthi ~/Library/Application\ Support/jean-claude-duck/learning
  ```
  (Use the real IP prefix you typed in place of `192.168`.)
- [ ] **Editor terminal sudo:** in VS Code (or Cursor), open the integrated terminal, run `sudo -k; sudo true` and type a password (for example `hunter3`) at the prompt. After idle time, `grep -r "hunter3" ~/ObsidianVault/mysthi ~/Library/Application\ Support/jean-claude-duck/learning` prints nothing.
- [ ] **Switching into a blocked app:** type a few words in Notes, then press ⌘Tab straight into 1Password. After idle time, no step description in the journal or lesson mentions 1Password.
- [ ] **Banking:** visit a banking site. Nothing from that visit is recorded.
- [ ] **Permissions survive a rebuild:** run `npm run build` again and relaunch. The tray shows `Learning: watching` without asking for permissions again.
- [ ] **Helper capture check:** with learning on, click a toolbar button in Finder, type in Spotlight, and type in a password field. The click and the Spotlight search show up as steps; the password field produces no text.

## Troubleshooting

- **`Learning: model unavailable`:** start Ollama (open the Ollama app or run `ollama serve`) and check `ollama list` shows `qwen3-vl:8b-instruct`; if not, `ollama pull qwen3-vl:8b-instruct`.
- **`Learning: missing permissions`:** System Settings, Privacy & Security. Turn Mysthi (or mysthi-helper) on under Screen Recording, Accessibility and Input Monitoring. If the "Mysthi Local Signing" certificate was recreated or renamed, macOS treats the app as new and asks for permissions again; grant them again.
- **"Mysthi's watcher couldn't start":** the helper is missing or crashed, and learning turns itself off. Run `npm run build:helper` (if it fails, redo step a), or rebuild with `npm run build`, then choose Start learning again. In the packaged app the helper lives at `Mysthi.app/Contents/Resources/mysthi-helper`.
- **Reset everything Mysthi has stored locally:** quit the app and delete `~/Library/Application Support/jean-claude-duck/learning`. Your notes in `~/ObsidianVault/mysthi/` are not touched; delete those yourself if you want them gone.
