# next-steps

A Claude Code mod. After each completed answer, Claude's little mascot appears in a band above the prompt
and asks how to continue, offering three next steps. It can also read the answer aloud with a local voice,
and it opens a separate assistant you can talk to before you decide. Nothing reaches the project chat unless
you press a button.

- **Three next steps**, by fixed roles chosen by the user: the natural continuation, a verification, an
  alternative. Pick any of them with `1`, `2` or `3` or by clicking; each goes into the prompt box, and the band
  stays until you send that prompt.
- **Voice** (optional, off by default): the mascot reads the whole answer aloud, then asks "How do you want to continue?" and reads the three options. A local Piper voice, no network.
- **Talk it over** (Discutiamone): a panel with a separate assistant that has its own conversation, apart from the project
  chat. When you agree on a request it proposes it in an editable field, with **Copy** and **Send to the project**.

## Language

The default is English. The plugin option `language` (`en` or `it`) sets the labels, the mascot's lines, the toasts, the panel and the voice phrases. The slash command is `/voice` in English and `/voce` in Italian. The suggested steps and the assistant's replies follow the language you write in. The voice follows the language
too: LJSpeech for English, Serena for Italian.

## Behavior

- Shown on the terminal and desktop surfaces, the only ones that draw the band above the prompt. A session
  that draws neither (`-p`, SDK, vscode, mobile) never pays for the side question.
- Appears when the main conversation finishes an answer of at least 80 characters (trimmed). Not for
  subagent turns, interrupted or failed turns, or shorter answers.
- The side question is asked 250 ms after the answer, so that a prompt typed ahead (queued behind the
  running turn) starts its turn first and supersedes the suggestion before the model is called.
- Hidden while a turn runs, while a survey holds the band, and as soon as a turn starts, a new prompt is
  submitted or the conversation is cleared. Each of those also stops the voice and ends a conversation.
- Choosing a step never sends anything. With an empty prompt box the step replaces it; with a draft
  already there the step is appended on a new line, so a draft is never overwritten. Each step goes in once,
  in the order you chose it, one per line. A chosen step is marked with a check and the band says how many
  are in the prompt. The band goes away when you send the prompt (`prompt.submit`) or the conversation ends.
  Choosing the same step again does nothing.
- On the desktop the app draws its own prompt box, which the engine cannot write into (`$.prompt.fill`
  refuses with `no_composer`). There every chosen step so far is copied to the clipboard, one per line
  (PowerShell `Set-Clipboard`, UTF-8), a toast says so and the band says "On the clipboard: 2 of 3 ... Paste them into the
  prompt with Ctrl+V". The digit hotkeys also belong to the engine's own prompt box (terminal): on the desktop you
  click.
- A button's label is the whole step, never shortened: the band takes the room it needs and the label wraps onto
  more rows. The engine refuses a Button whose only child is a `Text`, unless it also has a label, so the step is
  the label. Whether the host wraps a long label on the terminal and on the desktop is not yet checked live.
- The steps are written in the language of your last message. The mascot's lines and the labels are English by default; the `language` option (`en` or `it`) switches them.
- The band also holds three controls: **Voice** (a dropdown: Off, or one of the voice files in the voices folder; its label says "starting…" or "unavailable" when the daemon starts or fails), **Stop** (`s`, only while the voice is on and ready) and **Talk it over** (`d`). Hotkeys
  work where the band holds the keyboard (the terminal). The slash command `/voce` switches the voice too.

## The voice

- Engine: Piper, run by a small Python daemon (`voiced/`) that the mod starts with
  `$.process.spawn` when the voice is switched on, or at session start when the stored choice is on. The
  choice is kept with `$.store` and survives sessions. Default: off.
- Voices: the mod starts the voice of its language: `en_US-ljspeech-high` for English and `it_IT-serena-high` for
  Italian (see Credit).
- Credit (CC-BY-4.0): voice Serena, Piper `it_IT-serena-high`, trained from scratch on the dataset
  `committa/serena-synthetic-it-27h`. Piper itself is GPL-3.0; it is used as a library inside the user's own
  virtual environment and is not redistributed here.
- Credit (public domain): voice LJSpeech, Piper `en_US-ljspeech-high`, trained on the LJSpeech 1.1 dataset
  (keithito.com/LJ-Speech-Dataset).
- The daemon listens on `127.0.0.1` only, on a port the system picks (`--port 0`) and prints as
  `ready <port>`. Every request carries a random secret in the header `x-token`; the secret reaches the child
  through its environment (`VOICED_TOKEN`), never through the arguments, and is masked in any message. Start-up
  takes about 4 s on a quiet machine and up to 19 s measured on a busy one, so the mod waits up to 90 s.
- The daemon ends by itself when the process that started it is gone, so a crash of the host leaves no daemon
  behind; the engine also kills the child when the module unloads. `/clear` and a resume (another conversation
  taking the place of this one in the same process) leave it running: no `session.start` follows them.
- A session that draws no band does not start the voice at session start; if the stored choice is on and a band
  appears later, the first answer that has one starts it (that answer is not read: the voice needs a few seconds).
- Reading: the answer is turned into speech chunks (`hooks/speakable.ts`): the first at most 60 characters so
  that sound starts early, the others at most 120. Headings and list items become sentences; a code block is
  "Blocco di codice."; a table "Tabella."; a link keeps its text, a bare URL is "un link"; a long path is "un
  percorso"; a long hash or UUID "un identificatore". Edit `SPOKEN` in that file to change the phrases. An answer
  longer than 12,000 characters is read up to there and the voice adds "Il resto della risposta è nel testo."
  (the parsing is not linear on odd inputs, and twelve thousand characters are already some twelve minutes).
- Flow with the voice on: the phase is `reading` while the answer is read and, in parallel, the three steps are
  prepared. The buttons appear when both are done; then the mascot asks aloud and reads the three options. If
  the reading ends first the mascot thinks until the steps arrive; if the steps come first they wait for the
  voice. **Stop** silences the voice at once; the options are then shown but not read.
- Failures: a daemon that cannot start turns the voice back off and a toast names the reason (never the
  secret); a daemon that dies later leaves "Voice: unavailable" and a toast (the Stop button goes away and
  nothing is read until you switch the voice off and on); a daemon that only refuses one chunk stays "attiva",
  with one toast for that answer; switching the voice off while it starts is not a failure; the answer is never
  held up.
- Why not the app's own Read Aloud (the triangle on a message): it streams Anthropic's cloud voices through
  the app's UI code, has no hook for a mod, reads only transcript messages (the assistant's chat is not one)
  and only on a click. The mod API offers only `$.audio.speak`, which fails on this Windows host (`say` on
  macOS only), and `$.audio.play`, not probed here.

## The assistant

- **Talk it over** (Discutiamone) opens a panel (`Pane`, id `assistant`) with the conversation and a field. The assistant
  opens with a fixed greeting, spoken once if the voice is on. Typing and pressing Enter runs one turn:
  `$.model.complete` with the assistant's own system prompt. Nothing of this conversation is written to the
  project transcript or its prompt cache. The field is replaced by a new one (a new `key`) after each message
  and when the conversation ends, so it comes back empty whatever the desktop host does with an `Input` on Enter
  (not known; the test kit cannot show it).
- Model: `claude-sonnet-5-5`, effort `max`, reply cap 16000 tokens, at most 5 minutes a reply. All are plugin
  options (`assistantModel`, `assistantEffort`, `assistantMaxTokens`, up to 64000); an unusable value falls
  back to the default. The three first steps keep using `$.model.fork`, not this model.
- What it is told: its role (an advisor beside the coding assistant that cannot touch the project), a digest of
  the last 8 project messages (each cut to 1500 characters), the coding assistant's last answer (its last 6000
  characters) and this conversation (at most 30 lines). The quoted material is data, not instructions.
- It answers in `<say>` tags, in the language of your last message, one to three sentences; the reply is
  shown and spoken when the voice is on. A reply without `<say>` is shown as it came and logged.
- **Cancel** frees the panel at once and drops the answer when it arrives. A failed call is explained in one
  line (rate limit, network, empty reply, too slow); those lines are never sent back to the model.
- Hand-off: when you and the assistant agree, it adds the request in `<handoff>` tags. The panel shows it in an
  editable field with **Copy** (clipboard) and **Send to the project** (`$.prompt.submit({ text, asUser: true })`,
  your own words). Nothing is sent or copied without a press; an empty field does nothing. After either the
  conversation ends: the panel closes, the history is cleared. If a hook beneath the plugin refuses the prompt,
  a toast says so and the proposal stays. What you change in the proposal is kept when you press Enter in it,
  and when you close the panel and open it again; the field is replaced by a new one each time so that a host
  that blanks a field after Enter cannot leave you looking at an empty field while the buttons hold the text.
  A line sent while the assistant is still answering gets a toast instead of vanishing. The cancel button is
  drawn after the message field, so the field keeps its place in the keyboard focus order.
- Choosing one of the three steps during a conversation puts it in the prompt and keeps the conversation: the
  panel stays open until the prompt is sent. A turn, a prompt sent or a clear ends it. Steps that arrive while
  you talk only add their buttons.

## The mascot

One pixel-art sprite, 18 by 7 pixels: a body with two eyes, two arms and four feet. It is a hand-made
approximation of the block-character banner of Claude Code, not the official asset. Colors: body
`#D97757`, eyes `#2B1A14`. The look and the animations below were previewed and approved by the user.

The art comes from quarter-block glyphs, where one pixel is half a cell wide and half a cell tall: twice as
tall as wide (`PIXEL_ASPECT`). Drawn with square pixels it came out as a 3.2:1 strip ("troppo stirato", the
user's report on 2026-10-03); with the right aspect the silhouette is a stocky 16 by 10 box, 1.6:1.

The band has seven phases; each animation says something about the phase:

| Phase | When | What the mascot does | What it says |
| --- | --- | --- | --- |
| `idle` | nothing to ask | not drawn, no timer runs | |
| `reading` | the voice reads the answer | a quick bob, one wave of the arm, a blink, every 12 ticks | "Reading the answer to you" |
| `thinking` | the side question is in flight | glances up, left, up, right and taps its feet | "Thinking about how to continue" with cycling dots (three still dots on the desktop) |
| `asking` | the three steps are ready | hops and waves one arm for about a second, then breathes, blinks every 3.4 s and glances toward the options | "How do you want to continue?" and the three steps |
| `chatting` | the panel is open | looks toward it, a slow breath and a blink | "Talking it over: write in the panel" |
| `replying` | the assistant is working | the thinking pose | "Thinking it over..." |
| `chosen` | the proposal was copied from the panel (**Copy**) | hops with happy eyes for about 0.8 s, then the band goes away | "Copied: paste it with Ctrl+V" |

A pose is a pure function of `(phase, tick)` at 140 ms per tick (`poseFor`), so the animation is testable
with a mocked clock. `timelineFor(phase)` samples it into an intro played once and a loop that repeats
(reading: loop of 12 ticks; thinking, chatting and replying: 24; asking: intro of 10 and loop of 48; chosen:
intro of 6, then it holds).

Rendering, from the one sprite:

- terminal: a `Raster` of colored cells, quarter-block glyphs (two by two pixels per cell: 9 columns by 4
  rows), frames advanced by a timer that runs only while the phase is not `idle` and a terminal is among
  the session's surfaces. A cell holds a glyph and a background, two colors; a cell with body, eye and an
  empty quarter would need three, so it keeps the body and the eye shows the background through. That only
  happens when the eyes glance up (`thinking`, sprite one row down): on the terminal they are two gaps in
  the top edge, on the desktop two dark notches, the same shape;
- desktop: an `Svg` (54 by 42 CSS px, 3 by 6 px per pixel: 60% of the first 90 by 70) that plays itself. The markup holds every part
  of the sprite (torso, two arm positions, two feet positions, five eye shapes, a group that bobs) and a
  discrete SMIL film strip per part, sampled from `poseFor` over the phase's timeline. The band is drawn
  once per phase change and then not again: the clock never reaches it.

Why the desktop does not redraw: a redraw makes the host replace the band, which resets the hover under
the pointer. Frame-by-frame redraws at 140 ms made the highlight of the hovered step blink at that rhythm
(video of 2026-10-03: dips of one frame at 1.216 and 1.350 s with the pointer still, 134 ms apart, and again
at 1.649 s as it started to move). The engine redraws only the instances that read a state value, so the
desktop branch of `ui.render` never reads `tick`, and the band reads only `phase`, `steps`, `placed`, `via`, `voice` and
`daemon`: the conversation (`chat`, `draft`, `busy`) is read by the panel alone, so a reply never redraws the
band. Each desktop draw writes `next-steps: drew <phase> on <surface>` to the debug log (`claude --debug`),
which is how the tests count redraws.

## Decisions

| Decision | Choice | Why |
| --- | --- | --- |
| Where the steps come from | A side question to the model (`$.model.fork`) after each answer | Keeps the transcript clean; the prefix is served from the prompt cache. Costs one extra call per qualifying answer. |
| What a choice does | Writes each chosen step into the prompt box (`$.prompt.fill`), never submits | The message comes from your keyboard, can be edited, and a step with effects (commit, push, install) is never sent unreviewed. The band stays until the prompt is sent, so all three can be picked first. |
| What the steps are | Roles 1 / 2 / 3 above, in `STEP_CRITERIA` (`hooks/steps.ts`) | Set by the user. Edit that constant to change them. |
| Output format | Steps wrapped in `<steps>` tags, read from inside the tags only | The fork shares the main thread's system prompt, so an output style may add text around the reply. |
| Failures | Nothing is shown and nothing is raised on screen, except a toast when the voice fails; the reason goes to the debug log | A convenience feature must never interrupt the work. |
| Stalled call | After 30 s without a reply the steps are given up (the phase goes to `idle` once any reading ends) and the late reply is dropped | `$.model.fork` has no timeout of its own. |
| Phase changes | Serialized through one promise queue; only the latest requested phase is applied | A prompt, a clear or a timeout can land between two state writes; this keeps state and timer consistent. |
| Animation | One pure pose function. Terminal: a timer drives the redraw. Desktop: a self-playing SMIL film strip sampled from the same function | A redraw resets the hover on the desktop; the terminal has no SMIL. Both are tested against `poseFor`. |
| Pixel shape | Pixels twice as tall as wide on both surfaces | The art is quarter-block art; square pixels stretch it to 3.2:1. |
| End of `chosen` | A timer of its own (`CHOSEN_TICKS * FRAME_MS`), cancelled by any phase change | The desktop has no tick to count. |
| Voice | A local Python daemon with Piper, `winsound` playback from a temporary file | `$.audio.speak` fails on Windows; the app's Read Aloud is not available to mods. `winsound` async from a file starts in 5 ms and purges in 8 ms (measured); from memory it is refused, and synchronous play cannot be cut from another thread. |
| Stop | An epoch: a stop drops the queue and a synthesis still running is thrown away when it ends; the purge is repeated until no sound of an older epoch is left | A purge that lands just before a sound starts is lost. |
| Assistant | `$.model.complete` with its own system prompt, history in the plugin's state | Separate from the project chat and its cache; `complete` takes one message, so the history travels in it. |
| Cancel | The panel is freed at once and the late answer is dropped by the plugin | Works whether or not the engine honors the abort in time. |
| Hand-off | Two buttons, never automatic | The user's rule. `$.prompt.submit` verified on the desktop with the user's own clicks. |

## Design

Files, in `~/.claude/skills/next-steps/`:

- `.claude-plugin/plugin.json`: manifest; names the state contract and the options (`userConfig`).
- `hooks/hooks.json`: `{ "modules": ["./register.tsx"] }`.
- `hooks/register.tsx`: the hooks, the phase machine, the band and the panel. Every function that receives `$`
  is declared at the top level of the file (a rule of the engine's loader); `register` only wires hooks.
- `hooks/steps.ts`: pure logic: `shouldSuggest`, `buildPrompt`, `parseSteps`, `fillFor`, `handoffFor`,
  `placedLine`, `voiceLabel`, the toast texts and the timing constants.
- `hooks/mascot.ts`: pure sprite and motion: `poseFor`, `timelineFor`, `pixelsOf`, `packCells`, `toCells`,
  `toSvg`, `lineFor`.
- `hooks/speakable.ts`: pure: markdown to speech chunks.
- `hooks/assistant.ts`: pure: system prompt, digest, prompt, reply parsing, history, options, failure lines.
- `hooks/voice.ts`: pure lifecycle of the daemon behind three ports (random bytes, a child process, a loopback
  call); `register.tsx` builds the ports from `$`.
- `voiced/`: the Python daemon: `server.py` (HTTP), `speaker.py` (queue, two threads, epochs), `engine.py`
  (Piper), `player.py` (`winsound`, and a silent player), `parent.py` (ends with its parent), `__main__.py`,
  `smoke.py` (a manual test of the real daemon with the real voice) and `tests/`.
- `types/index.d.ts`: the `$.state` contract (`phase`, `steps`, `placed`, `tick`, `via`, `voice`, `daemon`, `busy`,
  `chat`, `draft`).
- `tests/`: run with `claude plugin test`. The daemon's: `python -m unittest discover -s voiced/tests -t .`.

Daemon protocol (JSON over HTTP on `127.0.0.1`, header `x-token` on every request): `POST /speak {id, text}`
(text at most 4096 characters) answers `{ok, queued}`; `POST /stop` drops the queue and cuts the sound,
answers `{ok, dropped}`; `GET /status` answers `{ok, ready, speaking, queued, playing, lastError}`;
`POST /quit` ends it. 401 for a wrong token, 404 for anything else, 400 for a bad body. `python -m voiced
--port 0 --voice PATH [--quiet]` prints `ready <port>` once the voice is loaded and warm.

Flow:

1. `turn.complete` on the main loop (no `agentId`), `reason` `answer`, `shouldSuggest` true and the session
   draws a band: take `mine = ++generation` and start the work in a timer (`$.clock.after(SUGGEST_DELAY_MS)`)
   so the turn is not held up.
2. The work gives up if `mine` is no longer current. With the voice on and ready it sets the phase `reading`
   and reads the answer (`speakable`, then `voice.speak`, then polling `isSpeaking` every 300 ms); otherwise
   `thinking`. In parallel `findSteps` calls `$.model.fork` (at most 30 s) with a prompt that carries the
   answer (its last 6000 characters) and the three roles. The guard is checked again after every await.
3. `parseSteps` reads the lines inside `<steps>`: exactly three non-empty lines are accepted, anything else
   is dropped. When the reading and the steps are both done: no steps, back to `idle`; steps while the user
   talks, only added (and when there are none the band and the panel stay as they are); otherwise the phase
   `asking`, and the options are read aloud unless Stop was pressed.
4. `ui.render` on `AbovePrompt` draws the mascot and a column with the line, the three plain `Button`s, a check on each step already in the prompt, while
   `asking`, `chatting` or `replying`, and the controls. It yields to the engine while a survey holds the band,
   a turn is running, or the phase is `idle` or `asking` with no steps. `ui.render` on `Pane` (`assistant`)
   draws the conversation, the field, **Cancel** while busy, and the proposal with its two buttons.
5. A press on a step that is not in `placed` reads the prompt box and calls `$.prompt.fill` with `fillFor`; when
   the box took the text the step joins `placed` and the phase stays as it is. If it did not,
   `handoffFor(refusal, ownsComposer)` decides: `copy` copies every step in `placed` plus this one to the
   clipboard, one per line, and sets `via = clipboard`; `dialog` and `refused` toast and change nothing, so you can
   try again. A press on a step already placed does nothing.
6. `turn.start`, `prompt.submit` and `session.end` bump the generation, stop the voice, end the conversation
   and set the phase `idle`; `prompt.submit` does it only once the prompt has entered (a hook beneath may drop
   it, and then nothing changes); `session.end` also quits the daemon unless the process goes on (`clear`,
   `resume`). **Copy** and **Send to the project** bump the generation too, so steps still in
   the making cannot bring the band back for an episode the user has already closed. `session.start` resets the
   state (after a hot reload the module's variables restart, the state persists) and starts the daemon when
   the stored choice is on and a band is drawn, without waiting for it.

## Install

The mod itself lives in `~\.claude\skills\next-steps` (permanent since 2026-10-07, version 0.4.0): the engine loads a
plugin found in a skills folder at the start of every session and reloads it when a file is saved, as
`next-steps@skills-dir`. This folder is the source of truth: edit here, then run `claude plugin test`, `tsc -p` and
`claude plugin validate` on it. Plugin options go under `pluginConfigs["next-steps@skills-dir"]` in the settings. The
stored choice of the voice (`$.store`) belongs to the plugin's identity, so a choice made while the mod was loaded
from a session's mods folder (`next-steps@inline`) is not seen here: switch the voice on once more.

The voice lives in `~\.claude\voice\` (the option `voiceHome` changes it): `venv\` with `piper-tts` and its
libraries, `voices\it_IT-serena-high.onnx` and its `.json` (Italian), `voices\en_US-ljspeech-high.onnx` and its `.json`
(English), and `CREDITS.md`. Nothing needs downloading when the
files of the earlier listening test are at hand: create a venv (`python -m venv venv`), copy the installed
package folders (`flatbuffers`, `google`, `numpy`, `numpy.libs`, `onnxruntime`, `packaging`, `pathvalidate`,
`piper` and their `dist-info`) into `venv\Lib\site-packages`, and copy the voice. About 250 MB on disk. Without
it the mod works as before: pressing Voice gives a toast that names the missing file and the voice stays off.

The English voice is one download, 109 MB: `en_US-ljspeech-high.onnx` and `en_US-ljspeech-high.onnx.json` from
`https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/ljspeech/high/`, into `voices\`. The Italian one
is the Serena file above (114 MB). Both are read by the same daemon: the mod picks the file by the `language` option.

## Verification

- `claude plugin validate <folder>` passes and lists the hooks (`session.start`, `command.run` for `voce`,
  `turn.start`, `prompt.submit`, `session.end`, `turn.complete`, `ui.render` for `AbovePrompt` and `Pane`).
- `tsc -p <folder>` reports no errors.
- `claude plugin test <folder>` passes (268 tests): the pure modules, the full flow with a mocked clock, model,
  store and a fake daemon (a child that prints `ready <port>` and answers the four routes), the band on
  `terminal` and `desktop`, the voice (start, toggle, failures, stop on every interruption), the reading flow,
  the conversation, the hand-off, the desktop band not being redrawn by the clock or by a reply, the SVG film
  strip decoded back to `poseFor` tick by tick, all 72 poses decoded back from the packed terminal cells
  against an oracle of the sixteen Unicode glyphs, and each guard above.
- The daemon: 51 unit tests (stable over repeated runs). `python -m voiced.smoke --voice PATH` with the real
  voice, silent: ready 4.0 to 4.7 s after launch, first sound 767 to 853 ms after the request, three chunks
  with no silence between them, a stop reads idle in 3 to 29 ms, a clean exit, no process left.
- The daemon under a real engine (Claude Code 2.1.286, an isolated `claude -p` loading a throwaway probe plugin
  that starts the daemon with the mod's own arguments and environment; silent, no `/speak`): the process tree
  is engine, then the venv's `python.exe` launcher, then the real interpreter; `ready <port>` arrives as its
  own piece; ready after 10 to 19 s on a busy machine; status 200 and a wrong secret 401; still alive and
  answering 10 s later (the parent watcher does not fire early); `POST /quit` ends the stream with code 0 in
  0.6 s; `return()` on the stream ends it at once; after each of those ends, and after the engine itself was
  killed abruptly, no `python` process is left 3 s later.
- An independent review (a fresh subagent that read the code, ran its own probes, fuzzers and mutation sweeps)
  found twelve groups of defects; all were reproduced, fixed test first and are covered now. See "Review" below.
- Mutation checks, each mutant on a fresh copy: speakable 25 of 25 killed, assistant 15 of 15, voice 21 of 21,
  steps (quotes, tails, labels, the start limit) 9 of 9, text (emoji-safe cuts) 7 of 7, register (voice, reading,
  chat, hand-off, the per-message fields, the start limit, the session rules) 61 of 62, daemon 27 of 28 plus the
  parent watcher 5 of 5 (the survivor is a second guard kept on purpose), and the mascot's earlier set.
- The film strip in a real Chromium (headless Edge 154): every tick of every phase (304 cells: reading 28,
  thinking 52, asking 110, chatting 52, replying 52, chosen 10) is drawn inline, each SVG is paused and
  seeked to the middle of its tick, and the screenshot is compared pixel for pixel with the art of `poseFor`:
  0 cells differ, and a deliberate offset of one tick makes 92 differ, so the check can fail.
- Live check with the user in the desktop app: the voice reads, Stop is immediate, a new prompt cuts the
  voice, Talk it over opens the panel, a reply arrives, the proposal appears, Copy and Send work, voice off
  leaves no `python` running.
- Not yet looked at live (version 0.4.0): a long step wraps onto more rows on the terminal and on the desktop;
  the frame and the mascot at 60%; picking all three, then sending from the prompt makes the band go away.

## Review

The independent review of 2026-10-06 reported, and the code now fixes: steps that arrived during a reply being
wiped when it landed; a step quoted with a trailing code span losing its closing backtick; the proposal field
blanked by Enter on the terminal while the buttons held the text, and its edit lost on a reload; a daemon that
died after being ready still shown as "attiva"; a prompt refused beneath the plugin reported as sent; a resume
quitting the daemon for good; the cancel button drawn before the message field (the keyboard ring is a list index);
steps that failed or finished late taking the band away or bringing it back; a refused chunk marking the voice
unavailable while it worked; switching the voice off during its start showing a failure; the voice started in a
session with no band; half an emoji left by a cut; text that could freeze the parser; a request with a body nested
too deep or never finished holding the daemon's handler. Tests were added for each (and for the places where the
review's mutants survived), and the review's probes were kept as regression tests.

A second round (one reviewer process, 25 minutes) confirmed all twelve groups closed and found three more, now
fixed: a session that ends while the voice is still starting erased the stored choice and showed a failure; two
switches of the voice in a row could meet half done (they now run one at a time, in order, and the last one
stands); a daemon gone in the same breath as its ready line could be written over as active.

## Out of scope

The microphone, the wake phrase "hey claude", transcription and a spoken conversation (stage 2), a voice per
language (the Italian voice reads English text with an Italian accent), a reduced-motion setting, a cheaper
model for the side call, vscode and mobile, a configurable number of steps.
