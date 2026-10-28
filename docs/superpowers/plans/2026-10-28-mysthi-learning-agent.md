# Mysthi Learning Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mysthi watches the user's Mac activity (clicks, typing, UI elements, screenshots) and turns it into redacted, replay-ready lessons, a knowledge base, a daily log and a weekly report in the Obsidian vault — all local and free.

**Architecture:** A Swift helper binary captures input events, accessibility info and screenshots and streams JSON lines to the Electron main process. In Node, every event passes privacy rules and a single redaction layer before becoming a `Step`, which is appended to a redacted on-disk journal. Screenshots are described by a local Ollama vision model at low priority; when the user is idle, a pipeline segments the journal into tasks, creates/merges lessons (user edits win), extracts knowledge, and writes notes to `~/ObsidianVault/mysthi/`.

**Tech Stack:** Electron 33 (CommonJS), Node 20 built-in test runner (`node --test`), Swift 6 (Swift Package, macOS frameworks: CoreGraphics event taps, ApplicationServices AX, ScreenCaptureKit), Ollama HTTP API on `127.0.0.1:11434`, electron-store, electron-builder.

**Spec:** `docs/superpowers/specs/2026-10-28-mysthi-learning-agent-design.md`

## Global Constraints

- Local and free only: every model call goes to Ollama at `127.0.0.1:11434`. No other network calls.
- Models (constants in `src/learning/config.js`): `VISION_MODEL = 'qwen2.5vl:7b'`, `TEXT_MODEL = 'qwen2.5vl:7b'` (one model for both keeps memory under ~7 GB on the 24 GB machine). User pulls it with `ollama pull qwen2.5vl:7b`.
- Nothing unredacted is ever written to disk: notes, journal, logs, caches, console output. Raw screenshots and raw keystrokes exist only in memory.
- Redaction placeholders, exactly: `[PASSWORD]`, `[IP]`, `[API_KEY]`, `[PRIVATE_KEY]`, `[CARD]`, `[IBAN]`, `[SECRET]` (for `.env` values / connection-string credentials), `[PHONE]`. Emails and people's names are kept.
- Never record literal typed text in terminals or in fields after a password-style prompt; secure fields are dropped entirely.
- Learning is off until the user turns it on; when not watching (off, paused, or do-not-watch context) the pet's eyes are closed.
- Heavy work (segmentation, merging, knowledge, reports) runs only after ≥ 3 minutes of system idle.
- Vault root: `~/ObsidianVault/mysthi/` with `lessons/`, `knowledge/`, `log/`, `reports/`. Lessons observed ≥ 3 times are `confident`.
- Bundle ID stays `com.jeanclaude.duck`.
- Existing features (chat, wander, reactions, Obsidian reading) must keep working.

## Review Focus

1. **Ollama down or model not pulled** → capture keeps running, the pipeline leaves the journal unprocessed and retries at the next idle window, tray shows "Learning: model unavailable"; nothing crashes. (Task 10)
2. **Quit, crash or sleep mid-day** → on restart, the pipeline resumes from the last processed step id and never processes a step twice. (Task 10)
3. **Model returns malformed or partial JSON** → one retry with the same prompt, then the segment is skipped and stays unprocessed. (Task 8)
4. **User deletes or renames a lesson note in Obsidian** → Mysthi treats the task as unseen and creates a new note; it never crashes or resurrects the deleted file under the old name from stale JSON. (Task 9)
5. **Romanian diacritics / emoji / IME input** (`ă î ș ț`, `😀`) → typed text and descriptions keep them intact through redaction and note rendering. (Task 2)

---

## File Structure

```
native/mysthi-helper/                 Swift package (capture helper)
  Package.swift
  Sources/MysthiHelper/main.swift     arg parsing, stdin commands, stdout JSON lines
  Sources/MysthiHelper/EventTap.swift global mouse/keyboard tap, typing aggregation
  Sources/MysthiHelper/AXInspector.swift element under action, focused field, browser URL, terminal line
  Sources/MysthiHelper/Screenshot.swift ScreenCaptureKit capture, downscale, JPEG base64
  Sources/MysthiHelper/Permissions.swift preflight/request for the three permissions
src/services/ollama.js                shared Ollama client (extracted from claude.js)
src/learning/config.js                constants (models, paths, thresholds)
src/learning/redact.js                the single redaction layer
src/learning/privacy.js               capture decisions (do-not-watch, banking, terminal, password prompts)
src/learning/data/banking-domains.json
src/learning/data/default-do-not-watch.json
src/learning/helper-client.js         spawns helper, parses JSON lines, EventEmitter
src/learning/journal.js               redacted JSONL step journal + processed pointer
src/learning/step-recorder.js         helper events → privacy → redaction → Step → journal
src/learning/vision.js                capped, throttled screenshot description queue
src/learning/vault.js                 vault paths, atomic writes, do-not-watch.md loader
src/learning/lesson-note.js           lesson render/parse, user-edit detection
src/learning/segmenter.js             boundary heuristics + model grouping/naming
src/learning/lessons.js               match + merge (user edits win), confident flag
src/learning/knowledge.js             fact extraction + knowledge notes
src/learning/reports.js               daily log + weekly report
src/learning/pipeline.js              idle-time orchestration
src/learning/index.js                 public API used by main.js
test/learning/*.test.js               node --test suites
test/fixtures/secrets.json            redaction corpus
```

---

### Task 1: Test harness and shared Ollama client

**Files:**
- Modify: `package.json` (add `"test": "node --test test/"`)
- Create: `src/services/ollama.js`
- Modify: `src/services/claude.js` (replace local `ollamaRequest` with the shared client)
- Create: `src/learning/config.js`
- Test: `test/learning/ollama.test.js`
- Also commit the spec and this plan.

**Interfaces:**
- Produces: `chat({ model, messages, format?, options?, timeoutMs? }) -> Promise<string>` (assistant content; `messages[i].images` may hold base64 JPEGs); `chatJSON(args) -> Promise<object>` (sets `format: 'json'`, parses, retries once on parse failure, then throws `OllamaJSONError`); `isAvailable(model) -> Promise<boolean>` (GET `/api/tags`, checks the model name). `OLLAMA_URL` overridable via `process.env.MYSTHI_OLLAMA_URL` for tests.
- Produces from config: `VISION_MODEL`, `TEXT_MODEL`, `VAULT_DIR` (`~/ObsidianVault/mysthi`), `IDLE_THRESHOLD_MS = 180000`, `CONFIDENT_AT = 3`, `VISION_QUEUE_CAP = 20`, `VISION_MIN_INTERVAL_MS = 5000`, `SEGMENT_GAP_MS = 180000`, `WEEK_MS = 604800000`.

- [ ] **Step 1: Write the failing tests** — start a local `http.createServer` stub on a random port, set `MYSTHI_OLLAMA_URL`:
  - `chat returns message content` — stub replies `{"message":{"content":"hi"}}` → `'hi'`.
  - `chat joins NDJSON stream lines` — stub replies two NDJSON lines `content:"a"`, `content:"b"` → `'ab'`.
  - `chatJSON retries once then throws` — stub returns `not json` twice → rejects with `OllamaJSONError`, stub hit count `2`.
  - `isAvailable false when model missing` — `/api/tags` returns `{"models":[{"name":"llama3.1:8b"}]}` → `isAvailable('qwen2.5vl:7b') === false`.
- [ ] **Step 2: Run** `npm test` — Expected: FAIL (`Cannot find module '../../src/services/ollama'`).
- [ ] **Step 3: Implement `src/services/ollama.js`** with Node `http` (no new deps), then switch `claude.js` to `chat()` keeping its existing model, options and fallback behaviour. Create `config.js`.
- [ ] **Step 4: Run** `npm test` — Expected: PASS. Run `npm start`, open chat, send "hello" — Expected: a reply (Ollama running) or the existing fallback text.
- [ ] **Step 5: Commit**
```bash
git add package.json src/services/ollama.js src/services/claude.js src/learning/config.js test/learning/ollama.test.js docs/superpowers
git commit -m "feat(learning): shared Ollama client, test harness, Mysthi spec and plan"
```

### Task 2: Redaction layer

**Files:**
- Create: `src/learning/redact.js`, `test/fixtures/secrets.json`
- Test: `test/learning/redact.test.js`

**Interfaces:**
- Produces: `redact(text: string) -> { text: string, kinds: string[] }` (`kinds` lists placeholder kinds applied, e.g. `['IP','API_KEY']`); `redactDeep(obj) -> obj` (redacts every string value in a plain object/array, returns a new object).

- [ ] **Step 1: Write the failing tests** — `secrets.json` is an array of `{ input, expected }`. Include at least:
  - `ssh root@192.168.1.20` → `ssh root@[IP]`; `fe80::1ff:fe23:4567:890a` → `[IP]`
  - `export OPENAI_KEY=sk-proj-abc123...` (40+ chars) → `export OPENAI_KEY=[API_KEY]`; `ghp_` + 36 chars → `[API_KEY]`; `AKIA` + 16 caps → `[API_KEY]`; a JWT `eyJ…​.eyJ…​.sig` → `[API_KEY]`; a 40-char random base64 string → `[API_KEY]`
  - `-----BEGIN OPENSSH PRIVATE KEY-----…-----END OPENSSH PRIVATE KEY-----` → `[PRIVATE_KEY]`
  - `4111 1111 1111 1111` → `[CARD]` (Luhn-valid only; `1234 5678 9012 3456` stays); `RO49AAAA1B31007593840000` → `[IBAN]`
  - `postgres://admin:hunter2@db.local/app` → `postgres://[SECRET]@db.local/app`; `DB_PASSWORD=hunter2` → `DB_PASSWORD=[PASSWORD]`; `API_TOKEN=xyz` (`.env` style `UPPER_KEY=value`) → `API_TOKEN=[SECRET]`
  - `+40 721 234 567` → `[PHONE]`
  - kept unchanged: `raz@wolfpack.example`, `Ana Popescu`, `version 1.2.3.4-beta`? → note: dotted version numbers with 4 parts *are* valid IPv4 shape; expected `[IP]` only when every octet ≤ 255 — assert `1.2.3.4` → `[IP]` and `v300.1.2.3` unchanged.
  - **Review Focus 5:** `Am exportat iconițele în Figma 😀` unchanged; `parola=Șarpe123` → `parola=[PASSWORD]`.
  - Tests: `redacts every corpus entry`, `reports kinds`, `redactDeep redacts nested strings and leaves numbers`.
- [ ] **Step 2: Run** `npm test -- --test-name-pattern=redact` — Expected: FAIL (module missing).
- [ ] **Step 3: Implement `redact.js`** as an ordered list of `{ kind, pattern, replace }` rules (private keys first, then connection strings, key=value secrets, tokens, cards with Luhn check, IBAN, IP, phone, high-entropy ≥ 32 chars with Shannon entropy > 4.0). Password-style keys: `/(pass(word)?|pwd|parola|secret|token)\s*[=:]\s*\S+/i`. All regexes use the `u` flag.
- [ ] **Step 4: Run** `npm test` — Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "feat(learning): redaction layer with secrets corpus"`

### Task 3: Privacy rules

**Files:**
- Create: `src/learning/privacy.js`, `src/learning/data/banking-domains.json`, `src/learning/data/default-do-not-watch.json`
- Test: `test/learning/privacy.test.js`

**Interfaces:**
- Consumes: none.
- Produces:
  - `createPolicy({ doNotWatchApps: string[], doNotWatchDomains: string[] }) -> Policy`
  - `policy.canWatch(ctx: { bundleId, appName, url?: string|null, isBrowser: boolean }) -> boolean` — false for do-not-watch apps (match bundleId or appName, case-insensitive), banking domains (built-in list ∪ user domains, suffix match on host), banking keywords in host/title (`/bank|banca|banking|ibank|netbank|paypal/i`), and browsers whose `url` is null (fail closed).
  - `policy.typedTextAllowed(ctx: { bundleId, isTerminal: boolean, secure: boolean, fieldLabel?: string }) -> boolean` — false if `secure`, or `isTerminal`, or `fieldLabel` matches `PASSWORD_PROMPT = /pass(word|phrase|code)?|parola|sudo|\bpin\b|one[- ]?time|otp|verification code|2fa|cod de verificare/i`.
  - `policy.terminalCommandAllowed({ typed: string, visibleLine: string|null }) -> boolean` — true only if `visibleLine` is non-null, contains `typed` (echo was on), and the text before `typed` in `visibleLine` does not match `PASSWORD_PROMPT`.
  - `TERMINAL_BUNDLES` (`com.apple.Terminal`, `com.googlecode.iterm2`, `dev.warp.Warp-Stable`) and `BROWSER_BUNDLES` (`com.apple.Safari`, `com.google.Chrome`, `company.thebrowser.Browser`, `org.mozilla.firefox`, `com.microsoft.edgemac`, `com.brave.Browser`) exported.
- Defaults (`default-do-not-watch.json`): apps `com.1password.1password`, `com.agilebits.onepassword7`, `com.bitwarden.desktop`, `com.apple.keychainaccess`, `com.apple.Passwords`, `com.apple.MobileSMS`, `net.whatsapp.WhatsApp`, `desktop.WhatsApp`; domains `[]`. Banking list: major RO banks (`bancatransilvania.ro`, `bt.ro`, `ing.ro`, `bcr.ro`, `brd.ro`, `raiffeisen.ro`, `cec.ro`), `revolut.com`, `wise.com`, `paypal.com`, `stripe.com`, `chase.com`, `bankofamerica.com`, `wellsfargo.com`, `hsbc.com`, `barclays.co.uk`.

- [ ] **Step 1: Write the failing tests:**
  - `blocks 1Password by bundle id`, `blocks user domain online.mybank.example via suffix`, `blocks keyword host ibank.example.com`, `blocks browser with unknown url`, `allows github.com in Chrome`.
  - `drops secure field`, `drops any typing in Terminal`, `drops field labelled "Parola"`, `allows field labelled "File name"`.
  - `terminal command allowed when echoed after $ prompt` (`typed:'git status'`, `visibleLine:'~/app $ git status'`) → true; `rejected when not echoed` (`visibleLine:'Password: '`) → false; `rejected after [sudo] password prompt` → false; `rejected when visibleLine null` → false.
- [ ] **Step 2: Run** `npm test -- --test-name-pattern=privacy` — Expected: FAIL.
- [ ] **Step 3: Implement `privacy.js`** and the two data files.
- [ ] **Step 4: Run** `npm test` — Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "feat(learning): privacy policy for apps, banking sites, terminals and password prompts"`

### Task 4: Swift capture helper

**Files:**
- Create: `native/mysthi-helper/Package.swift` (macOS 14+, executable `mysthi-helper`) and the five sources listed in File Structure.
- Modify: `package.json` scripts: `"build:helper": "swift build -c release --package-path native/mysthi-helper"`.

**Interfaces (stdout, one JSON object per line; stdin, one command per line):**
- `{"type":"permissions","screen":bool,"accessibility":bool,"input":bool}` — emitted at start and after `{"cmd":"request-permissions"}`.
- `{"type":"app","bundleId","appName","window","url":string|null}` — on frontmost app/window change; `url` read via AX for `BROWSER_BUNDLES` (Safari `AXDocument` of the focused window; Chromium-family `AXURL` of the `AXWebArea`), null if unreadable.
- `{"type":"click","ts","bundleId","appName","window","url","target":{"role","subrole","title","description","menuPath":[string]|null}}` — element under the click via `AXUIElementCopyElementAtPosition`; `menuPath` filled by walking `AXParent` while role is `AXMenuItem`/`AXMenu`/`AXMenuBarItem`.
- `{"type":"shortcut","ts",...,"keys":"cmd+shift+e"}` — key down with ⌘/⌃/⌥ held.
- `{"type":"typed","ts",...,"text":string|null,"secure":bool,"field":{"role","title","placeholder","description"},"isTerminal":bool,"visibleLine":string|null}` — typing is aggregated per focused field and flushed on focus change, Return, or 2 s pause. **If the focused element's subrole is `AXSecureTextField`, `text` is always null and keystrokes are discarded inside the helper.** For terminals, `visibleLine` is the last line of the focused text area's `AXValue` at flush time; VS Code/Cursor integrated terminals are detected by focused element description containing `terminal` (case-insensitive) and set `isTerminal:true`.
- `{"type":"screenshot","ts","id","jpegBase64","width","height"}` — in response to `{"cmd":"screenshot","id"}`; captures the display containing the frontmost window, downscaled to max 1024 px wide, JPEG quality 0.6. Never written to disk.
- Commands: `{"cmd":"pause"}` / `{"cmd":"resume"}` (tap disabled while paused), `{"cmd":"request-permissions"}`.
- `mysthi-helper --selftest` prints one `permissions` line and exits 0.

- [ ] **Step 1: Build** `npm run build:helper` — Expected: `Compiling … Build complete!`
- [ ] **Step 2: Self-test** `native/mysthi-helper/.build/release/mysthi-helper --selftest` — Expected: one line `{"type":"permissions",...}` and exit code 0.
- [ ] **Step 3: Manual capture check** — grant the terminal app Accessibility + Input Monitoring, run the binary, click a Finder toolbar button, type in Spotlight, type into a Safari password field. Expected: a `click` with the button's title; a `typed` with text; a `typed` with `"secure":true,"text":null`. Ctrl-C to stop.
- [ ] **Step 4: Commit** `git commit -m "feat(learning): Swift capture helper (events, AX, screenshots, permissions)"`

### Task 5: Helper client, step recorder and journal

**Files:**
- Create: `src/learning/helper-client.js`, `src/learning/journal.js`, `src/learning/step-recorder.js`
- Test: `test/learning/step-recorder.test.js`, `test/learning/journal.test.js`

**Interfaces:**
- Consumes: `redact`, `redactDeep` (Task 2); `createPolicy`, `TERMINAL_BUNDLES`, `BROWSER_BUNDLES` (Task 3).
- Produces:
  - `HelperClient extends EventEmitter` — `new HelperClient(binPath)`, `.start()`, `.stop()`, `.send(cmd)`, emits each parsed line as `'event'`; restarts the child once on unexpected exit, then emits `'dead'`.
  - `Step` = `{ id: string (ulid-ish: Date.now().toString(36)+counter), ts: number, bundleId, appName, window, url, action: 'click'|'shortcut'|'type'|'command', target: object|null, keys?: string, value?: string, description?: string, redactions: string[] }` — every string already redacted.
  - `createJournal(dir) -> { append(step), readSince(stepId|null) -> Step[], markProcessed(stepId), lastProcessed() -> string|null, attachDescription(stepId, text) }` — files `dir/steps-YYYY-MM-DD.jsonl` and `dir/state.json`; `attachDescription` appends a `{ "patch": stepId, "description" }` line resolved by `readSince`.
  - `createStepRecorder({ policy, journal, onWatchingChange(bool), onScreenshotWanted(stepId) }) -> { handle(event) }` — keeps current app context from `app` events; drops everything when `!policy.canWatch(ctx)` and calls `onWatchingChange(false)` (true again when allowed); `typed` → `action:'type'` only if `policy.typedTextAllowed`, terminal `typed` → `action:'command'` only if `policy.terminalCommandAllowed`; values pass through `redact` and `redactDeep`; after `click`/`shortcut`/accepted typing calls `onScreenshotWanted(step.id)`.
- Journal dir: `app.getPath('userData') + '/learning'` (passed in, not hard-coded in the module).

- [ ] **Step 1: Write the failing tests:**
  - `journal round-trips steps and resumes after lastProcessed` (append 3, markProcessed(first), new journal instance on same dir, readSince(lastProcessed()) returns 2).
  - `attachDescription patches the step`.
  - `recorder drops everything in 1Password` (app event bundle `com.1password.1password`, then click) → journal empty, `onWatchingChange(false)` called.
  - `recorder redacts typed value` (`typed` text `ssh root@10.0.0.5` in Safari field "Address") → step `value === 'ssh root@[IP]'`, `redactions` includes `'IP'`.
  - `recorder never writes secure text` (`secure:true`) → no step.
  - `terminal command recorded, password input not` — iTerm `typed` `git push` with `visibleLine:'$ git push'` → `action:'command'`; then `typed` `hunter2` with `visibleLine:'Password: '` → no step; assert no journal line contains `hunter2`.
- [ ] **Step 2: Run** `npm test` — Expected: FAIL.
- [ ] **Step 3: Implement** the three modules.
- [ ] **Step 4: Run** `npm test` — Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "feat(learning): helper client, privacy-filtered step recorder, redacted journal"`

### Task 6: Screenshot description queue

**Files:**
- Create: `src/learning/vision.js`
- Test: `test/learning/vision.test.js`

**Interfaces:**
- Consumes: `chat` (Task 1), `redact` (Task 2), `journal.attachDescription` (Task 5).
- Produces: `createVisionQueue({ describe: (prevJpeg|null, jpeg) => Promise<string>, onDescription(stepId, text), cap = VISION_QUEUE_CAP, minIntervalMs = VISION_MIN_INTERVAL_MS }) -> { push(stepId, jpegBase64), size(), stop() }` and `defaultDescribe(prevJpeg, jpeg)` which calls `chat({ model: VISION_MODEL, messages:[{ role:'user', content: DESCRIBE_PROMPT, images:[prev?, cur] }], options:{ num_predict: 60 } })`.
- `DESCRIBE_PROMPT`: "Two screenshots: before and after one user action (or only after). In one sentence, describe what the user just did and what changed. Name the app and the UI element. Do not repeat any passwords, keys or numbers you can read."
- One description in flight at a time, at least `minIntervalMs` between starts; when full, drop the oldest; the previous screenshot is kept only as the next item's "before" and released after; output passes through `redact` before `onDescription`.

- [ ] **Step 1: Write the failing tests** (inject a fake `describe` and fake timers via `node:test` `mock.timers`):
  - `drops oldest when over cap` — cap 2, push 3 while first in flight → described ids are 1st, 3rd (2nd dropped).
  - `respects min interval` — two pushes, second `describe` not called before 5000 ms elapse.
  - `redacts descriptions` — fake returns `Opened 10.0.0.1 in Safari` → `onDescription` gets `Opened [IP] in Safari`.
  - `describe failure does not stop the queue` — first rejects, second resolves → second delivered.
- [ ] **Step 2: Run** `npm test` — Expected: FAIL.
- [ ] **Step 3: Implement `vision.js`.**
- [ ] **Step 4: Run** `npm test` — Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "feat(learning): throttled, capped screenshot description queue"`

### Task 7: Vault access and lesson notes

**Files:**
- Create: `src/learning/vault.js`, `src/learning/lesson-note.js`
- Test: `test/learning/lesson-note.test.js`, `test/learning/vault.test.js`

**Interfaces:**
- Produces from `vault.js`: `createVault(rootDir = VAULT_DIR) -> { ensure(), writeAtomic(relPath, text), read(relPath) -> string|null, exists(relPath), list(relDir) -> string[], loadDoNotWatch() -> { apps: string[], domains: string[] } }`. `ensure()` creates `lessons/ knowledge/ log/ reports/` and, if missing, `do-not-watch.md` seeded from `default-do-not-watch.json` as two markdown lists under `## Apps` and `## Websites`. `writeAtomic` writes to `*.tmp` then renames.
- `Lesson` = `{ slug, title, apps: string[], timesObserved: number, confident: boolean, firstSeen: 'YYYY-MM-DD', lastSeen: 'YYYY-MM-DD', steps: LessonStep[] }`; `LessonStep` = `{ id: string, app, action, target, value?, text: string, userEdited: boolean, variants: string[] }`.
- Produces from `lesson-note.js`:
  - `renderLesson(lesson) -> string` — YAML frontmatter (`title`, `type: mysthi-lesson`, `apps`, `times_observed`, `confident`, `first_seen`, `last_seen`), `# title`, `## Steps` as a numbered list where each line is `N. <text> <!-- step:<id> -->` followed by indented `   - Also seen: <variant>` lines, then a fenced ```` ```mysthi-lesson ```` JSON block holding the full `Lesson` (the replay-ready form).
  - `parseLesson(markdown) -> { lesson: Lesson, edits: { changed: id[], removed: id[], added: LessonStep[] } }` — reads the JSON block as the last machine state, then compares the numbered list against it: a line whose text differs from `step.text` → `text` updated, `userEdited = true`, id in `changed`; an id missing from the list → step removed, id in `removed`; a numbered line with no `step:` comment → new step (`id` generated, `userEdited: true`, `action: 'manual'`) in `added`; list order becomes step order.

- [ ] **Step 1: Write the failing tests:**
  - `render then parse is lossless with no edits` → `edits` all empty, lesson deep-equal.
  - `edited step text wins` — replace step 2's text in the rendered markdown → `changed` = `[id2]`, `userEdited === true`, new text.
  - `deleted line removes step`, `new line without id becomes user step`, `reordered lines reorder steps`.
  - `vault.ensure seeds do-not-watch.md and loadDoNotWatch reads it back` (tmp dir), `writeAtomic leaves no .tmp file`.
- [ ] **Step 2: Run** `npm test` — Expected: FAIL.
- [ ] **Step 3: Implement** both modules (frontmatter written by hand; keys only from the fixed set, values JSON-quoted so they are valid YAML).
- [ ] **Step 4: Run** `npm test` — Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "feat(learning): vault access and lesson note render/parse with edit detection"`

### Task 8: Segmenter

**Files:**
- Create: `src/learning/segmenter.js`
- Test: `test/learning/segmenter.test.js`

**Interfaces:**
- Consumes: `chatJSON` (Task 1), `Step` (Task 5).
- Produces:
  - `splitAtBoundaries(steps: Step[], gapMs = SEGMENT_GAP_MS) -> Step[][]` — pure: new segment when the gap between consecutive steps ≥ `gapMs`.
  - `groupTasks(segment: Step[], ask = chatJSON) -> Promise<Array<{ name: string, stepIds: string[], isTask: boolean }>>` — sends a compact step listing (`id | app | action | target title | value | description`) with `GROUP_PROMPT`; validates that every returned id exists and ids are not reused; on `OllamaJSONError` or invalid shape returns `null` (caller keeps segment unprocessed).
- `GROUP_PROMPT` asks the model to split the steps into tasks the user was trying to accomplish, give each a short imperative name ("Export app icons from Figma"), and set `isTask:false` for browsing/reading/window switching with no goal, returning `{"tasks":[{"name","stepIds","isTask"}]}`.

- [ ] **Step 1: Write the failing tests** (inject a fake `ask`):
  - `splits on 3-minute gaps` (steps at 0, 60s, 300s → two segments).
  - `groupTasks returns validated tasks`.
  - `groupTasks drops unknown ids and duplicate ids`.
  - **Review Focus 3:** `groupTasks returns null when ask throws OllamaJSONError`; `returns null when tasks is not an array`.
- [ ] **Step 2: Run** `npm test` — Expected: FAIL.
- [ ] **Step 3: Implement `segmenter.js`.**
- [ ] **Step 4: Run** `npm test` — Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "feat(learning): segment steps into tasks"`

### Task 9: Lesson matching/merging and knowledge base

**Files:**
- Create: `src/learning/lessons.js`, `src/learning/knowledge.js`
- Test: `test/learning/lessons.test.js`, `test/learning/knowledge.test.js`

**Interfaces:**
- Consumes: `renderLesson`, `parseLesson`, `Lesson` (Task 7); `createVault` (Task 7); `chatJSON` (Task 1); task objects from `groupTasks` (Task 8).
- Produces from `lessons.js`:
  - `loadLessons(vault) -> Lesson[]` — parses every `lessons/*.md`, applying user edits (and rewriting the JSON block when `edits` is non-empty so the machine state catches up). The note file is the source of truth: a lesson whose note is gone does not exist.
  - `learnTask({ task, steps, lessons, vault, ask = chatJSON, today }) -> Promise<{ kind: 'new'|'updated', lesson: Lesson, changes: string[] }>` — candidates = lessons sharing an app with the task; `MATCH_PROMPT` asks for `{"slug": "<existing slug>" | null}`; null → new lesson (slug = kebab-case title, `-2`, `-3` on collision; `timesObserved: 1`). Match → `MERGE_PROMPT` with the existing steps (ids included) and the new run, returning `{"steps":[{ "id"?, "text", "app", "action", "target", "value"? }], "changes":[string]}`. Then enforce in code: every existing step with `userEdited: true` keeps its `text`; if the model changed or dropped it, restore it and append the model's version to `variants` (if different); `timesObserved += 1`; `confident = timesObserved >= CONFIDENT_AT`; `lastSeen = today`. Write via `vault.writeAtomic('lessons/<slug>.md', renderLesson(lesson))`.
- Produces from `knowledge.js`: `extractKnowledge({ steps, vault, ask = chatJSON, today }) -> Promise<Array<{ topic, fact }>>` — `KNOWLEDGE_PROMPT` returns `{"facts":[{"topic","fact"}]}` limited to tools, projects/paths, naming conventions, shortcuts, settings; appends new facts (normalised lowercase/whitespace dedupe) as `- fact (first seen today)` to `knowledge/<topic-slug>.md`, creating it with frontmatter `type: mysthi-knowledge`; returns only newly added facts.

- [ ] **Step 1: Write the failing tests** (tmp vault, fake `ask`):
  - `unmatched task creates lesson with timesObserved 1`.
  - `matched task merges and becomes confident on third observation`.
  - `user-edited step survives a merge that rewrites it` — note edited by user, fake merge returns different text for that id → final text is the user's, model text in `variants`.
  - `user-removed step is not resurrected` — line deleted in note, merge input excludes it.
  - **Review Focus 4:** `deleted note means task is new` — write lesson, delete the `.md`, learn same task → `kind === 'new'`, no exception.
  - `knowledge dedupes facts and returns only new ones`.
- [ ] **Step 2: Run** `npm test` — Expected: FAIL.
- [ ] **Step 3: Implement** both modules.
- [ ] **Step 4: Run** `npm test` — Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "feat(learning): lesson match/merge with user edits winning, knowledge base"`

### Task 10: Idle pipeline and daily log

**Files:**
- Create: `src/learning/pipeline.js`, `src/learning/reports.js` (daily part)
- Test: `test/learning/pipeline.test.js`

**Interfaces:**
- Consumes: `journal` (Task 5), `splitAtBoundaries`, `groupTasks` (Task 8), `loadLessons`, `learnTask` (Task 9), `extractKnowledge` (Task 9), `isAvailable` (Task 1), `createVault` (Task 7).
- Produces:
  - `appendDailyLog({ vault, date, lessons: {kind, lesson, changes}[], facts }) -> void` — `log/YYYY-MM-DD.md`, sections `## New lessons`, `## Updated lessons` (with `changes`), `## New knowledge`; links as `[[lessons/<slug>|<title>]]`; appends to an existing day file.
  - `createPipeline({ journal, vault, deps = {...real fns}, now = Date.now, getIdleMs }) -> { runIfIdle() -> Promise<'ran'|'not-idle'|'model-unavailable'|'nothing'>, status() }` — runs only when `getIdleMs() >= IDLE_THRESHOLD_MS`; checks `isAvailable(TEXT_MODEL)` first; reads `journal.readSince(journal.lastProcessed())`; leaves the trailing segment untouched if its last step is younger than `SEGMENT_GAP_MS` (may still be in progress); for each closed segment: `groupTasks` → null stops the run *without* advancing the pointer; else `learnTask` for `isTask` groups, `extractKnowledge` for all steps, `appendDailyLog`, then `journal.markProcessed(lastStepIdOfSegment)`. A guard prevents overlapping runs.
  - Records each run's results into `vault`-independent state `userData/learning/weekly.json` (`{ enabledAt, lastReportAt, newLessons: slug[], updated: {slug, changes}[], facts: {topic,fact}[] }`) via a `recordWeek(results)` helper for Task 11.

- [ ] **Step 1: Write the failing tests** (fake deps, tmp dirs):
  - `does nothing when not idle`.
  - **Review Focus 1:** `model unavailable leaves pointer unchanged` → returns `'model-unavailable'`, `lastProcessed()` unchanged.
  - **Review Focus 2:** `resumes after restart without reprocessing` — run once, construct a new pipeline over the same journal dir, run again → `learnTask` call count unchanged.
  - `leaves in-progress trailing segment`.
  - `null grouping stops without advancing`.
  - `daily log lists new and updated lessons`.
- [ ] **Step 2: Run** `npm test` — Expected: FAIL.
- [ ] **Step 3: Implement** `pipeline.js` and the daily-log part of `reports.js`.
- [ ] **Step 4: Run** `npm test` — Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "feat(learning): idle-time pipeline with resumable processing and daily log"`

### Task 11: Weekly report

**Files:**
- Modify: `src/learning/reports.js`
- Test: `test/learning/reports.test.js`

**Interfaces:**
- Consumes: `weekly.json` state (Task 10), `loadLessons`, `renderLesson` (Tasks 7, 9).
- Produces: `maybeWriteWeeklyReport({ vault, state, now }) -> { written: boolean, relPath?: string, state }` — when `now - (state.lastReportAt ?? state.enabledAt) >= WEEK_MS`, writes `reports/YYYY-MM-DD-week.md` containing: a summary line (`N new lessons, M updated, K new facts`), `## New lessons` with each lesson's **full** steps (title, apps, times observed, numbered steps — the lesson body without the JSON block) and a link, `## Updated lessons` with their `changes`, `## New knowledge` grouped by topic; then resets the week lists and sets `lastReportAt = now`. Lessons deleted since are listed by title as "(note removed)".

- [ ] **Step 1: Write the failing tests:**
  - `no report before 7 days`.
  - `report after 7 days includes full steps of every new lesson` (assert each step text appears).
  - `state resets after report`.
  - `removed lesson listed as (note removed)`.
- [ ] **Step 2: Run** `npm test` — Expected: FAIL.
- [ ] **Step 3: Implement** in `reports.js`.
- [ ] **Step 4: Run** `npm test` — Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "feat(learning): weekly report with full new lessons"`

### Task 12: App integration — on/off, pause, closed eyes, permissions onboarding

**Files:**
- Create: `src/learning/index.js`
- Modify: `main.js` (tray menu, shortcut, wiring), `src/renderer/pet/index.html` (closed eyes, ⌥-click), `src/windows/pet-window.js` (forward ⌥-click IPC)
- Test: `test/learning/index.test.js`

**Interfaces:**
- Consumes: everything above; Electron `powerMonitor.getSystemIdleTime()`, `Notification`, `dialog`, `systemPreferences`.
- Produces: `createLearning({ userDataDir, helperPath, notify, onWatchingChange }) -> { enable(), disable(), togglePause(), isEnabled(), isWatching(), status() -> { enabled, paused, permissions, model: 'ok'|'unavailable' } }`. Persists `enabled` in electron-store key `learning.enabled` (default `false`). On `enable()` first time: store `enabledAt` in `weekly.json`, `vault.ensure()`, send `request-permissions`, and if any permission is false show a `dialog` naming the missing ones and opening `x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture` / `…Privacy_Accessibility` / `…Privacy_ListenEvent`. Every 60 s: `pipeline.runIfIdle()` then `maybeWriteWeeklyReport`; on report → `notify('Mysthi\'s weekly report is ready', relPath)`. Reloads `do-not-watch.md` every 60 s into the policy.
- Watching = enabled && !paused && helper alive && policy allows current context. `onWatchingChange(false)` → main sends `pet:state` with `eyes: 'closed'`; true → `updateSlimeState()`.
- UI: tray items `Start learning` / `Stop learning`, `Pause learning` / `Resume learning`, `Open lessons folder`, a disabled status line (`Learning: watching | paused | off | model unavailable | missing permissions`). Global shortcut `CommandOrControl+Shift+M` toggles pause. ⌥-click on the pet toggles pause (renderer sends `learning:toggle-pause`).
- Renderer: support `eyes: 'closed'` in the `pet:state` handler (draw eyes as 1-px lines).
- Helper path: packaged `process.resourcesPath + '/mysthi-helper'`; dev `native/mysthi-helper/.build/release/mysthi-helper`.

- [ ] **Step 1: Write the failing tests** (fake helper client, fake pipeline):
  - `disabled by default and not watching`.
  - `togglePause flips watching and calls onWatchingChange(false)`.
  - `weekly report triggers notify`.
- [ ] **Step 2: Run** `npm test` — Expected: FAIL.
- [ ] **Step 3: Implement** `index.js` and the main/renderer wiring.
- [ ] **Step 4: Run** `npm test` — Expected: PASS. Then `npm run build:helper && npm start`: tray shows `Learning: off`; choose `Start learning` → permission dialog lists what's missing; ⌘⇧M → pet eyes close and tray says `paused`; again → eyes open.
- [ ] **Step 5: Commit** `git commit -m "feat(learning): wire learning into the app with pause, closed eyes and onboarding"`

### Task 13: Signed packaging and end-to-end check

**Files:**
- Modify: `package.json` `build` section: `"mac.identity": "Mysthi Local Signing"`, `"extraResources": [{ "from": "native/mysthi-helper/.build/release/mysthi-helper", "to": "mysthi-helper" }]`, `"mac.entitlements"`/`"entitlementsInherit"` pointing to `build/entitlements.mac.plist` (no sandbox; `com.apple.security.cs.allow-jit` for Electron); script `"build": "npm run build:helper && electron-builder --mac"`.
- Create: `build/entitlements.mac.plist`, `docs/learning-setup.md` (model pull, signing identity, permissions, where notes go, how to pause, how to edit do-not-watch).

- [ ] **Step 1: User step (manual, the user does this — not the agent):** in Keychain Access → Certificate Assistant → Create a Certificate…, name `Mysthi Local Signing`, type *Code Signing*, self-signed root. Verify: `security find-identity -v -p codesigning` lists `Mysthi Local Signing`.
- [ ] **Step 2: Pull model** `ollama pull qwen2.5vl:7b` — Expected: `success`.
- [ ] **Step 3: Build** `npm run build` — Expected: `dist/mac-arm64/Jean Claude Duck.app`; `codesign -dv --verbose=2 "dist/mac-arm64/Jean Claude Duck.app/Contents/Resources/mysthi-helper"` shows `Authority=Mysthi Local Signing`.
- [ ] **Step 4: End-to-end** — launch the built app, Start learning, grant the three permissions, then: export a frame in Figma (or any repeatable 4–6 step task) three times with ≥ 4 minutes idle after each; type an SSH command with an IP in Terminal and a password at a `sudo` prompt; visit a banking site. Expected after idle: `~/ObsidianVault/mysthi/lessons/` has one lesson for the repeated task with `times_observed: 3`, `confident: true`; `grep -r "hunter2\|192.168" ~/ObsidianVault/mysthi ~/Library/Application\ Support/jean-claude-duck/learning` prints nothing; the daily log lists the lesson; nothing recorded during the banking visit.
- [ ] **Step 5: Rebuild and confirm permissions survive** — `npm run build`, relaunch; tray shows `Learning: watching` without re-granting.
- [ ] **Step 6: Commit** `git commit -m "build: signed packaging with embedded capture helper; learning setup docs"`
