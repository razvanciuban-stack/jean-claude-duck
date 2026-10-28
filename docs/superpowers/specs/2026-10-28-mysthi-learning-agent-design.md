# Mysthi — Learning Agent (Phase 2) Design

Date: 2026-10-28
Repo: `jean-claude-duck` (Electron desktop pet, macOS)

## Intent

The desktop pet is becoming **Mysthi**, a black cat (visual redesign is a separate phase; a throwaway animation spike exists). This phase gives her a brain: she **watches what the user does on their Mac and turns it into reusable knowledge** — step-by-step lessons and a knowledge base — written precisely enough that a *future* phase can have her **reproduce** those tasks.

For now she only learns. She does not chat about it, advise, or act.

Why: the user wants an apprentice that learns how they work by observation, so repeated work can eventually be handed off to her.

## Success

After the first week of running, the user receives a **full weekly report** listing every new lesson Mysthi learned (and lessons she updated), which they read in Obsidian. If the lessons in that report are recognisable tasks the user actually did, with steps they agree with, the phase works.

## Goals

1. **Continuous capture** of the user's activity while Mysthi is not paused:
   - frontmost app and window title
   - every click and keyboard action, with the **UI element acted on, by its accessibility identity** (role + title/label, e.g. button "Export", text field "File name", menu path File → Export → PNG), not just screen coordinates
   - text typed into fields (after redaction — see Privacy)
   - a screenshot shortly before/after meaningful actions, used only to let a local vision model describe what changed
2. **Fully automatic task segmentation.** No "start/stop recording" from the user. Mysthi decides where tasks begin and end from the step stream (idle gaps, context switches to unrelated apps/projects, session ends), groups related steps, and names the task.
3. **Lessons.** One lesson per distinct task. When she sees a task she already has a lesson for, she merges the new run into it (adds missing steps, updates changed ones) and increments a "times observed" count. Lessons observed 3+ times are marked *confident*.
4. **Knowledge base.** Facts learned along the way that aren't tasks: tools used and what for, project locations, naming conventions, frequently used shortcuts, preferred settings.
5. **Replay-ready data.** Every lesson has a human-readable note *and* a structured machine-readable form (per step: app, target element identity, action, input value or placeholder, expected result). Replay itself is out of scope, but the data must be sufficient for it.
6. **Weekly report.** Seven days after learning is first enabled (and weekly after), Mysthi writes a report note containing all new lessons in full, a list of updated lessons with what changed, and new knowledge-base entries. The user is notified it's ready.
7. **Daily log.** A short daily note: lessons learned/updated today, knowledge added.

## Non-goals (this phase)

- Replaying/automating lessons.
- Improving chat replies, personality, or the model used for chat.
- Putting the Mysthi cat visuals into the app (the existing duck sprite stays; only the pause indicator below touches visuals).
- Any cloud service. Everything runs locally and free.
- Windows/Linux support.

## Anti-goals (failure even if it "works")

- **Any sensitive value reaching disk** in notes, logs, structured data, caches, or crash dumps.
- Raw screenshots or raw keystroke logs persisted anywhere.
- Noticeably slowing the user's machine while they work.
- Lessons expressed as pixel coordinates ("click at 412,880") instead of named elements.
- A flood of trivial lessons (scrolling, reading, window switching becoming "lessons").

## Constraints

- **Local and free only.** Models run through Ollama (already used by the app) on the user's Mac: Apple M5 Pro, 24 GB RAM. Currently installed: llama3.1:8b, llama3.2:3b, llama3.2:1b — none can read images, so a vision-capable model must be pulled. It must fit comfortably alongside normal work.
- **macOS permissions:** Screen Recording, Accessibility, Input Monitoring. Mysthi must handle each being missing or revoked gracefully (explain what's needed, keep running with whatever is granted).
- **Heavy model work runs when the user is idle**, not while they're actively working. Capture itself must be lightweight.
- Existing app keeps working: chat, wander, reactions, Obsidian reading.

## Privacy (decided by the user — hard requirements)

Never captured at all:
- Keystrokes into **secure/password fields** (macOS marks these; drop them entirely).
- Anything while the frontmost app is on the **do-not-watch list**. Defaults: password managers (1Password, Bitwarden, Keychain Access, etc.), banking apps/sites, Messages, WhatsApp. User can add/remove.
- Anything while **paused**.

Redacted before anything is written anywhere (typed text, vision-model descriptions, window titles, final lesson text, structured data), replaced with typed placeholders such as `[IP]`, `[API_KEY]`, `[PASSWORD]`:
- passwords (also `password=…`-style text)
- IPv4/IPv6 addresses
- API keys and tokens (`sk-…`, `ghp_…`, `AKIA…`, JWTs, high-entropy strings)
- private/SSH keys
- credit card numbers, IBANs
- `.env` values and connection strings with credentials (`postgres://user:pass@host`)
- phone numbers

**Typed secrets outside password fields (user's decision):** literal typed text is never recorded in terminal apps (Terminal, iTerm2, Warp, VS Code/Cursor integrated terminals, etc.) or in any field immediately following a password-style prompt (`password:`, `passphrase`, `sudo`, `Enter PIN`, one-time-code prompts, and similar). For terminals, the command that was run is recorded (after redaction) but any secret input it then asks for is not. Elsewhere, typed text is recorded and goes through redaction. Residual risk outside those cases is accepted.

Kept (my call, user can override): email addresses and people's names, since steps often need them.

Placeholders keep lessons readable ("SSH into `[IP]`"); a future replay will ask the user for the real value.

Raw keystrokes and screenshots live only in memory until described and redacted, then are discarded.

**Buffering (my call):** screenshots are downscaled and described soon after capture by the vision model at low priority, throttled so it doesn't compete with the user's work; the in-memory screenshot queue is capped, and if it falls behind the oldest screenshots are dropped (a step without a description is acceptable). The *redacted* step stream (text only, already through the redaction layer) may be written to disk while it waits for idle-time segmentation, so a quit, crash, or sleep doesn't lose the day. Nothing unredacted is ever written.

**Browsers and banking sites (my call):** in browsers, the current URL is read before anything else is captured for an action. A site is do-not-watch if its domain is on a built-in list of known banks/payment providers, on the user's own domain list, or its URL/title matches banking keywords. If the URL can't be read, the browser is treated as do-not-watch for that moment (fail closed).

## Pause and visibility

- One-click pause/resume reachable from the pet itself, plus a global shortcut. (Exact control: builder's call.)
- When paused or when a do-not-watch app is frontmost, the pet's eyes are closed — the user can always see whether she's watching.
- Learning is **off until the user turns it on** the first time, at which point the permission prompts are walked through.

## Storage

In the user's Obsidian vault (`~/ObsidianVault/`, already read by the app) under a new folder:

```
mysthi/
  lessons/      one markdown note per task (title, app(s), steps, times observed, confident flag, first/last seen)
  knowledge/    knowledge-base notes (tools, projects, conventions, shortcuts, settings)
  log/          one daily note
  reports/      weekly reports
```

The structured replay-ready form of each lesson is stored alongside (format and location: builder's call — e.g. frontmatter, a fenced JSON block, or a sibling JSON file), as long as it stays in sync with the human note.

**User edits win (user's decision).** The user may edit lesson notes in Obsidian to correct steps. Before merging a new observation into a lesson, Mysthi reads the current note, detects user edits, and updates the structured form to match them; the user's version is authoritative. New observations are merged on top of it and must never silently revert a user's change. If a new observation contradicts a user-edited step, keep the user's step and record the observed variant as a note on that step rather than replacing it.

## How it gets made (my calls, stated so they can be challenged)

- Stays an Electron app; new code lives in the existing services structure.
- A small **native macOS helper** (Swift) handles global input events, accessibility lookups of the element under each action, secure-field detection, and screenshots, streaming events to the Electron main process. Node alone can't do these reliably.
- **Ollama** for both the vision model (describing before/after screenshots) and a text model (segmenting tasks, writing/merging lessons, knowledge extraction, reports). Specific models: builder's call within the constraints above.
- **Permissions and signing (my call):** macOS ties permission grants to the app's code signature and bundle ID. Builds are signed with one stable local signing identity so grants survive rebuilds; the Swift helper is embedded in and signed with the app. The bundle ID stays `com.jeanclaude.duck` this phase — renaming to Mysthi happens in the visual phase, and will mean re-granting permissions once.
- Redaction is a single shared layer every text path goes through before persistence; it is unit-tested against a corpus of sample secrets.

## Left to the builder

- Capture cadence, screenshot timing, and when a step is "meaningful".
- Exact segmentation heuristics and prompts; how lessons are matched to existing ones.
- Which vision and text models to use (local, fits in 24 GB alongside work).
- The native helper's protocol with Electron.
- Note templates and the structured lesson schema.
- How the pause control and do-not-watch list are edited in the UI.

## Known risk

Fully automatic segmentation will produce imperfect lessons early on (wrong boundaries, merged tasks). The user accepts this; quality should improve as tasks repeat.
