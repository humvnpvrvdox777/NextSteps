# next-steps assistant, stage 1

A separate assistant that reads each answer aloud and helps decide how to continue. Design approved by the
user on 2026-10-03. Implemented and tested on 2026-10-04; what is left is the install and the live check with
the user (see Progress). `README.md` describes the feature as it works now; this file keeps the reasons, the
decisions and the facts behind it. It builds on the mascot band described in `README.md`.

## What the user asked for

The mascot becomes a separate assistant that appears at the end of each answer and helps decide how to
continue. It reads the whole answer aloud with a female voice, has a button to switch the voice on or off,
keeps its own chat and cache apart from the project chat, and only when you have reached a conclusion puts that
request into the project chat. Later (stage 2): the microphone listens while it reads, the wake phrase "hey
claude" interrupts it, your voice is transcribed, and the conversation is natural and spoken.

Stage 1 is everything except the microphone: voice out, the separate assistant, the conversation by typing and
the hand-off.

## Decisions

| Decision | Choice | Why |
| --- | --- | --- |
| Voice engine | Piper `it_IT-serena-high`, local. CC-BY-4.0, dataset `committa/serena-synthetic-it-27h`: credit it | Chosen by the user after a measured listening test against Elsa (Windows), Paola medium and Serena medium |
| Why not `$.audio.speak` | It fails on Windows ("no speech synthesizer on windows"): the engine only has macOS `say` | Verified live with a probe |
| Hand-off | An editable field with two buttons: Copy and Send to the project. Nothing is sent without a press | The user's rule; the desktop app owns its prompt box, which the engine cannot write into |
| Assistant model | `claude-sonnet-5-5`, effort `max`, `maxTokens` 16000, all configurable | The user's choice. Expect tens of seconds per reply: the call is cancellable and the mascot shows it is thinking |
| The three first ways forward | Stay on the fast path of today (`$.model.fork`), not on the assistant model | Otherwise every answer would wait for a max-effort reply; a setting can move them |
| Chat separation | `$.model.complete` calls with their own system prompt; the history lives in the mod | Never touches the project's transcript or its prompt cache |
| Voice process | A Python daemon started by the mod with `$.process.spawn`, controlled over HTTP on `127.0.0.1` with a token | Probes showed spawn and localhost HTTP work from the desktop session; stopping speech is a message, not a kill |
| Playback | `winsound`, asynchronous, from a temporary WAV file; stop = drop the queue and purge | Standard library only. Measured: the purge returns in 8.5 ms and starting a file takes 5.4 ms. Python refuses memory plus asynchronous, and a synchronous play from memory cannot be interrupted from another thread (the thread ran its whole 9.4 s after the purge) and adds about 118 ms per chunk |

## Facts verified on this machine

- Desktop session, engine 2.1.286: `$.process.run`, `$.process.spawn`, `$.http.fetch` to `127.0.0.1` and
  `$.store` work. `$.audio.speak` does not.
- `$.prompt.fill` is refused on the desktop (the app draws its own prompt box).
- i7-13620H, 15.7 GB. Piper Serena high: model load about 3.5 s, warm first sentence 0.6 to 1.2 s, real-time
  factor 0.27 (3.7 times faster than speech). Install: isolated venv 156 MB on disk, 61.6 MB of wheels, voice
  114.2 MB, all checksums verified.

## Progress (2026-10-04)

- Task 0, spike: `winsound` and the loader's import rule answered; `$.prompt.submit` verified on the desktop (the
  user's own clicks); a pane with a Button works. Not reported: whether an `Input` accepts typing in the pane
  or the band. The panel is built on a pane with an `Input`; the live check settles it, and the fallback is the
  same `Input` in the band.
- Task 1, the daemon: done except the listening check (audible), which belongs to the live check. 51 unit
  tests, the real-voice smoke test 7 of 7. Changes since the plan: the system picks the port and the daemon
  prints `ready <port>` (no port to guess, no retry), and it ends by itself when its parent is gone.
- The panel's text field gets a new `key` after each message and when the conversation ends (`say-0`, `say-1`, ...),
  so it is a new, empty field whether or not the host clears an `Input` on Enter; the live check will show if it
  was needed. Tests find the field by the `say` prefix.
- Task 2, `speakable`: done, 25 of 25 mutants killed. Task 3, `assistant`: done, 15 of 15. Task 4, `voice`:
  done, 21 of 21, behind three ports and a listener for a daemon that dies after it was ready.
- Task 5, phases, band and reading: done. Phases `reading`, `chatting` and `replying` with film strips on the
  desktop (304 cells checked pixel for pixel in Chromium); the band's controls; `/voce`; the daemon started
  without waiting for it at session start.
- Task 6, panel, conversation and hand-off: done. Plugin options `assistantModel`, `assistantEffort`,
  `assistantMaxTokens`, `voiceHome`. Changes since the plan: **Annulla** frees the panel at once and the plugin
  drops the late answer (the engine's abort is not relied on); error lines carry `isError` and never go back
  to the model; the three step buttons stay while the user talks. 61 of 62 register mutants killed (the survivor needs a race the kit cannot make).
- Task 7, install, live check, independent review, memory: the voice is installed (about 250 MB under
  `~\.claude\voice`, copied, nothing downloaded). The independent review (2026-10-06, a fresh subagent: the code,
  its own probes, fuzzers and mutation sweeps) found twelve groups of defects; each was reproduced, fixed test
  first and is listed in `README.md` ("Review"). A real-engine probe settled how the daemon lives and dies. The
  live check with the user is the one thing left, and the user's yes to make the mod permanent.

## Behavior

1. With the voice on, when an answer completes (main loop, a session that draws a band) the mascot reads the answer
   aloud. The three ways forward are prepared in parallel; when both reading and preparation are done, the mascot
   asks "How do you want to continue?" aloud, reads the three options
   and shows the buttons.
2. With the voice off nothing is spoken and the band behaves as in `README.md`.
3. Reading stops at once when a turn starts, a prompt is submitted, the conversation is cleared, **Stop** is
   pressed or the voice is switched off.
4. **Voce on/off** is a button in the band. The choice is stored with `$.store` and survives sessions. Default:
   off.
5. The daemon starts when the voice is switched on, or at session start when the stored choice is on. It needs
   about 4 s to load and warm up (19 s measured on a busy machine; the mod waits up to 90 s). If it cannot
   start, the voice goes back off and a toast names the reason.
6. **Discutiamone** opens a panel with the conversation and a field where you type to the assistant. Its replies
   are short (one to three sentences), in the language of your last message, always shown in the panel and
   spoken when the voice is on. A long call can be cancelled; the mascot shows it is thinking.
7. When you agree on a request the assistant proposes it in an editable field with **Copia** (clipboard) and
   **Manda al progetto** (`$.prompt.submit`, as the user's own words). Nothing is sent without a press. After
   either, the conversation of that episode ends.
8. Clicking one of the three ways forward still works as in `README.md` (clipboard on the desktop, prompt box
   on a terminal) and skips the conversation.

## Architecture

Files (the new ones; the existing ones are extended):

- `voiced/`: the Python daemon. `server.py` (HTTP), `speaker.py` (the queue, two threads, the epoch that makes a
  stop final), `engine.py` (Piper), `player.py` (`winsound`, and a silent player for tests), `__main__.py`,
  `smoke.py` (a manual test of the real daemon with the real voice) and `tests/`. Run the unit tests from the mod
  folder: `python -m unittest discover -s voiced/tests -t .` (any Python 3.12; Piper is only imported when a
  voice is loaded). Run the smoke test with the voice's venv: `python -m voiced.smoke --voice PATH` (silent),
  add `--loud` to hear it.
- `hooks/speakable.ts`: pure. Markdown to speech chunks.
- `hooks/assistant.ts`: pure. System prompt, project digest, history, reply parsing.
- `hooks/voice.ts`: pure lifecycle logic that talks to the daemon through injected ports (`speak`, `stop`,
  `status`, `quit`); `register.tsx` builds the ports from `$`.
- `hooks/register.tsx`: phases, band, panel wiring. Every function that receives `$` is declared at the top level
  of this same file: the engine's loader follows `$` only into functions of the same file, never across an
  import (verified: validation fails with "$ is passed to X, imported from ./helper"). That is why the other
  modules are pure and take injected ports. `Input` does not exist on `mobile`: the render hooks yield there.

Phases: `idle`, `reading`, `thinking`, `asking`, `chatting`, `replying`, `chosen`. State values (JSON, all in
`types/index.d.ts`): `phase`, `steps`, `tick`, `via`, `voice`, `daemon` (`off`, `starting`, `ready`, `failed`),
`busy`, `chat` (the lines of the panel), `draft` (the proposed request). New mascot poses: `reading` talks (a
quick bob with a waving arm and blinks), `chatting` listens (eyes toward the panel), `replying` thinks while the
assistant works.

### Constraints from the band fix (2026-10-03)

- The desktop band is never redrawn by a clock: a redraw makes the host replace the band and reset the hover
  under the pointer (the user filmed the highlight blinking at the 140 ms tick). New phases (`reading`,
  `chatting`) get an intro and a loop in `SHAPES` (`hooks/mascot.ts`) and play on the desktop as SMIL film
  strips; only the terminal `Raster` is advanced by the tick.
- Nothing that changes periodically (reading progress, an elapsed counter, a speaking flag that toggles per
  sentence) may be read by the desktop branch of `ui.render`. The desktop band reads only `phase`, `steps`, `placed`,
  `via`, `voice` and `daemon`, which change on user actions and phase changes (a test records every atom read while it
  is drawn and compares the list). `tick` is read by the terminal band alone; `chat`, `draft` and `busy` by the
  panel alone: a state write redraws only the instances that read it, so a reply arriving redraws the panel and
  leaves the band (and the hover under the pointer) alone.
- The art is 1:2: one pixel is twice as tall as wide (`PIXEL_ASPECT`), on both surfaces.

### Voice daemon protocol

JSON over HTTP on `127.0.0.1:<port the system picks>` (`--port 0`), every request carries `x-token` (random per
run, passed to the child in an environment variable, never in the arguments).

- `POST /speak {id, text}`: queue one chunk. `text` is at most 4096 characters. Replies `{ok, queued}`.
- `POST /stop`: drop the queue and cut the sound now. Replies `{ok, dropped}`.
- `GET /status`: `{ok, ready, speaking, queued, playing, lastError}`.
- `POST /quit`: stop and exit.
- Anything else: 404; a wrong token: 401; a bad body (not JSON, too deeply nested, too large, wrong fields): 400. A
  connection that stops sending half way is dropped after 10 s.
- The child prints `ready <port>` on stdout once the model is loaded and warmed up, errors on stderr. `--quiet`
  skips the sound, for tests and measurements. It ends by itself when the process that started it is gone.
- Synthesis runs ahead of playback (up to three chunks) so after the first chunk there are no gaps.

### Speech chunks

`speakable(markdown)` returns chunks of at most about 120 characters, the first one at most about 60 so speech
starts early. Headings and list items become sentences; a code block becomes "Blocco di codice."; a table
becomes "Tabella."; a link keeps its text; an image is dropped; inline code is read as text; a long path, hash
or URL is replaced by a short description. Long sentences are split at commas.

### Assistant contract

- Every turn sends one prompt: the system prompt (role: a separate advisor, brief spoken replies, reply in the
  user's language, never claim to have changed the project, end with a `<handoff>` block when the user and the
  assistant agree on a request), a digest of the project conversation (the last messages, each truncated, from
  `$.session.messages()`), the last answer in full, and the history of this conversation.
- The reply is read from `<say>...</say>` and an optional `<handoff>...</handoff>`; anything outside the tags is
  ignored. A reply with no `<say>` is shown as it is and logged for debugging.
- History is the `chat` atom (so a hot reload keeps it), at most 30 lines, cleared by every end of a conversation: a
  chosen step, **Copia**, **Manda al progetto**, a turn, a prompt, a clear.

### Install and credits

The voice lives in `~\.claude\voice\`: `venv\`, `voices\it_IT-serena-high.onnx` and its `.json`, and
`CREDITS.md` ("Voice: Serena, Piper it_IT-serena-high, trained from scratch on
`committa/serena-synthetic-it-27h`, CC-BY-4.0"). It is created only with the user's consent. Nothing is
downloaded: a venv cannot be moved, but a fresh venv (`python -m venv`) with the lab's installed package
folders copied into its `Lib\site-packages` (flatbuffers, google, numpy, numpy.libs, onnxruntime, packaging,
pathvalidate, piper and their dist-info) imports Piper, loads Serena high and synthesizes offline (verified
2026-10-03: Python 3.12.10, import and load 5.6 s, cold first synthesis 4.4 s). About 250 MB on disk. The path
is the `voiceHome` setting; the default is read from `USERPROFILE`.

Why not the app's own Read Aloud (the triangle on a message): it streams from Anthropic's servers
(`/api/ws/text_to_speech/text_stream`, account voices, rate limited) and is a feature of the app's UI code. The
plugin API has no call to start it, it only reads transcript messages (the assistant's chat is not one), and
using that internal endpoint from a mod would be an undocumented use of the user's session. The mod API offers
`$.audio.speak` (platform synthesizer, `say` on macOS: fails on this Windows host) and `$.audio.play` (the
engine's clip player through the platform's own: `afplay` on macOS, not probed on Windows; the daemon's
`winsound` is the verified path).

## Privacy

The voice is entirely local and the daemon listens on loopback only. The model calls carry only what the
project chat already sends to the model, through the same account. Stage 1 records nothing: there is no
microphone.

## Verification

- `claude plugin test`, `tsc -p` and `claude plugin validate` on the mod; Python `unittest` on the daemon.
- The daemon exercised in `--quiet` mode with the real Piper model, then by ear.
- Mutation checks on the new logic, an independent review by a fresh subagent, and a live check on the desktop.

## Risks and unknowns (first task)

- Whether a `Pane` with an `Input` works on the desktop surface; fallback: an `Input` in the band.
- Resolved in the first task: `winsound` (see Decisions) and the loader's import rule (see Architecture).
- Resolved 2026-10-03: `$.prompt.submit({ text, asUser: true })` works from the desktop session. The probe's button
  inside the pane was pressed and its message `Prova del probe: rispondi solo "ok".` arrived in the chat as a real
  user turn, three times. So a pane draws on the desktop, its Buttons are clickable, and the "Manda al progetto"
  hand-off is possible. Still unverified on the desktop: whether the pane's `Input` accepts typing, empties on
  Enter and keeps the focus. The mod does not depend on the answer: the message field gets a new key after each
  message (so it is new and empty whatever the host does), the new field is given the keyboard with `$.ui.focus`
  (denied, and logged for debugging, when the pane does not hold it), and the proposal field is replaced when
  it is submitted. The test kit has no focus ring, so those are checked by the debug log and by the keys drawn.
- Latency and token cost of `effort: max` for a conversation.

## Out of scope (stage 2)

Microphone, wake phrase, transcription, interruption by voice, spoken conversation, echo handling.
