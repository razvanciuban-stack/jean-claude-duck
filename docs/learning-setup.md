# Mysthi learning: setup and daily use

Mysthi is the learning side of Jean Claude Duck. While you work, it watches which steps you repeat, and when you have done the same task a few times it writes a short lesson into your Obsidian vault.

## What it does and doesn't do

- Everything stays on this Mac. Screenshots are described by a local model (Ollama, `qwen2.5vl:7b`). Nothing is sent to any server.
- It only learns while you are working. The lessons are built while you are idle (about 3 minutes without keyboard or mouse), not while you type.
- A task becomes a confident lesson after you have done it 3 times.

### What is never recorded

- Anything typed into a password field, a `sudo` or other password prompt, or a verification-code prompt.
- Anything in an app or on a website listed in `do-not-watch.md` (see below). Banking sites and a built-in list of password managers and messaging apps are always skipped.
- Text typed after a password-style prompt in Terminal (for example `sudo`), and anything that looks like a secret.
- Before any text is saved, secrets are replaced with placeholders: `[PASSWORD]`, `[API_KEY]`, `[SECRET]`, `[PRIVATE_KEY]`, `[IP]`, `[IBAN]`, `[CARD]`, `[PHONE]`.

### Where your notes go

Everything is plain Markdown in `~/ObsidianVault/mysthi/`:

| Folder | What is in it |
| --- | --- |
| `lessons/` | One note per repeated task, with the steps, `times_observed` and `confident` |
| `knowledge/` | Facts Mysthi picked up about your tools and workflow |
| `log/` | A daily log listing what was learned that day |
| `reports/` | The weekly report |
| `do-not-watch.md` | Your block list |

Tray menu, "Open lessons folder" opens `lessons/`.

### Editing the do-not-watch list

Open `~/ObsidianVault/mysthi/do-not-watch.md`. It has two sections, `## Apps` (macOS bundle ids, for example `com.1password.1password`) and `## Websites` (domains, for example `mybank.com`; subdomains are included). Add one `- item` per line and save. Mysthi re-reads the file about once a minute.

## One-time setup checklist

macOS ties the Screen Recording, Accessibility and Input Monitoring permissions to the app's code signature. A stable local signing certificate means you grant them once and they survive rebuilds.

- [ ] **a. Fix Command Line Tools** (needed to build the Swift helper). On this Mac the install is broken, so reinstall it:
  ```
  sudo rm -rf /Library/Developer/CommandLineTools
  xcode-select --install
  ```
  Then check `npm run build:helper` finishes without errors.
- [ ] **b. Pull the model:** `ollama pull qwen2.5vl:7b` (already done on this Mac; expect `success`). Ollama must be running when you use learning.
- [ ] **c. Create the signing certificate "Mysthi Local Signing":**
  1. Open Keychain Access.
  2. Menu bar: Keychain Access, Certificate Assistant, Create a Certificate...
  3. Name: `Mysthi Local Signing`. Identity Type: Self Signed Root. Certificate Type: Code Signing.
  4. Create, then Done.
  5. Verify: `security find-identity -v -p codesigning` lists `Mysthi Local Signing`.
- [ ] **d. Build:** `npm run build`. This builds the helper and then the app. Result: `dist/mac-arm64/Jean Claude Duck.app`. Optional check: `codesign -dv --verbose=2 "dist/mac-arm64/Jean Claude Duck.app/Contents/Resources/mysthi-helper"` shows `Authority=Mysthi Local Signing`.
- [ ] **e. Launch and grant permissions:** open `dist/mac-arm64/Jean Claude Duck.app`. From the tray icon choose **Start learning**. Mysthi asks for **Screen Recording**, **Accessibility** and **Input Monitoring**; use the "Open ..." buttons in its dialog to jump to System Settings, switch Jean Claude Duck (or mysthi-helper) on for each, then return. Mysthi notices the change on its own.

macOS may ask for Automation access ("System Events") the first time; that is the duck checking which app is in front.

## Daily use

- **Pause / resume:** press **⌘⇧M**, or **⌥-click** the pet, or use Pause learning in the tray menu.
- **Closed eyes** on the duck mean learning is on but not watching right now: paused, missing permissions, model unavailable, or you are in an app/site on the block list.
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
- [ ] **Banking:** visit a banking site. Nothing from that visit is recorded.
- [ ] **Permissions survive a rebuild:** run `npm run build` again and relaunch. The tray shows `Learning: watching` without asking for permissions again.
- [ ] **Helper capture check:** with learning on, click a toolbar button in Finder, type in Spotlight, and type in a password field. The click and the Spotlight search show up as steps; the password field produces no text.

## Troubleshooting

- **`Learning: model unavailable`:** start Ollama (open the Ollama app or run `ollama serve`) and check `ollama list` shows `qwen2.5vl:7b`; if not, `ollama pull qwen2.5vl:7b`.
- **`Learning: missing permissions`:** System Settings, Privacy & Security. Turn Jean Claude Duck (or mysthi-helper) on under Screen Recording, Accessibility and Input Monitoring. If you rebuilt without the "Mysthi Local Signing" certificate, macOS treats it as a new app: check `security find-identity -v -p codesigning`, rebuild, and grant again.
- **"Mysthi's watcher couldn't start":** the helper is missing or crashed, and learning turns itself off. Run `npm run build:helper` (if it fails, redo step a), or rebuild with `npm run build`, then choose Start learning again. In the packaged app the helper lives at `Jean Claude Duck.app/Contents/Resources/mysthi-helper`.
- **Reset everything Mysthi has stored locally:** quit the app and delete `~/Library/Application Support/jean-claude-duck/learning`. Your notes in `~/ObsidianVault/mysthi/` are not touched; delete those yourself if you want them gone.
