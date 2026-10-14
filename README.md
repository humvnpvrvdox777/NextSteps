# next-steps

**Your next move, one click away.** next-steps is a Claude Code mod. After each finished answer, Claude's mascot
offers three next steps: the natural continuation, a verification, and an alternative. Pick one, several or all
three: in the terminal they go into your prompt, in the desktop app onto the clipboard. You edit and send them yourself. Nothing is sent until you press Enter.

It works in the Claude Code desktop app and in the terminal. Two optional extras: a local voice that reads each
answer aloud, and a side assistant to think through your next request before you send it to the project.

## Support

next-steps is free and open source. If it saves you time, if you like it, or if you simply feel like buying me a
coffee, support its development on [PayPal](https://paypal.me/bside777). Questions and licensing:
humvnpvrvdox@gmail.com

## How it works

1. You finish a turn with Claude. next-steps asks the model for three next steps based on that answer. 
2. The mascot appears above your prompt and asks "How do you want to continue?". With the voice on, it also reads
   the answer and the options aloud.
3. Press `1`, `2` or `3`, or click a step. In the terminal the step goes into the prompt. In the desktop app the
   steps go to the clipboard, one per line, because the app owns the prompt box: paste them with Ctrl+V. Choose as
   many steps as you want. Each chosen step gets a check mark, and the band counts them.
4. Edit the prompt if you wish, then press Enter. The band disappears when the prompt is sent.

## Requirements

- Windows 10 or 11, tested on Windows 11.
- Claude Code with mod support, in the desktop app or the terminal. Developed against Claude Code 2.1.286 and 2.1.295.
- An active Claude account. Suggestions and assistant replies use the model, like any other request.
- For the voice only: Python 3.12, about 250 MB of disk space, and a voice file (109 MB English, 114 MB Italian).

## Installation

Run these commands in Claude Code, from a terminal session:

```text
/plugin marketplace add humvnpvrvdox777/NextSteps
/plugin install next-steps@next-steps
```

Then run `/reload-plugins` or restart Claude Code. The mod is active from the next answer on.

### Turn on the function hooks

next-steps runs on Claude Code's function hooks. Without them the mod stays silent: its hook modules are not loaded.
Set this switch in your user settings, then restart Claude Code. On Windows the file is `%USERPROFILE%\.claude\settings.json`:

```json
{
  "env": {
    "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1"
  }
}
```

With the value `1`, Claude Code loads the hook modules even when its rollout has not reached your account. If the band
never appears after the restart, this switch is the first thing to check.

## Turning on the voice (optional)

The voice is off by default. It uses the voice that matches the language in use. Create the Python environment
once, with Python 3.12 (`python --version` must print 3.12.x):

```powershell
$voice = "$env:USERPROFILE\.claude\voice"
New-Item -ItemType Directory -Force "$voice\voices" | Out-Null
python -m venv "$voice\venv"
& "$voice\venv\Scripts\python.exe" -m pip install piper-tts==1.8.0
```

Download the English voice (LJSpeech, public domain, 109 MB):

```powershell
$base = "https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/ljspeech/high"
Invoke-WebRequest -Uri "$base/en_US-ljspeech-high.onnx" -OutFile "$voice\voices\en_US-ljspeech-high.onnx"
Invoke-WebRequest -Uri "$base/en_US-ljspeech-high.onnx.json" -OutFile "$voice\voices\en_US-ljspeech-high.onnx.json"
```

For the Italian language, download the Italian voice (Serena, Piper `it_IT-serena-high`, 114 MB, CC-BY-4.0):

```powershell
$base = "https://huggingface.co/rhasspy/piper-voices/resolve/main/it/it_IT/serena/high"
Invoke-WebRequest -Uri "$base/it_IT-serena-high.onnx" -OutFile "$voice\voices\it_IT-serena-high.onnx"
Invoke-WebRequest -Uri "$base/it_IT-serena-high.onnx.json" -OutFile "$voice\voices\it_IT-serena-high.onnx.json"
```

Switch the voice on from the band's Voice dropdown, or with `/voice` (`/voce` in Italian). If the folder is somewhere
else, set the `voiceHome` option. If the voice cannot start, the mod says why and everything else keeps working.

## Using it

| Key or button | Where | What it does |
| --- | --- | --- |
| `1`, `2`, `3` | Terminal, with the prompt box empty | Adds that step to the prompt |
| Click a step | The band | Terminal: adds it to the prompt. Desktop app: copies it to the clipboard |
| **Voice** dropdown | The band | Picks Off or a voice file; the choice is kept for the next session |
| `s` or **Stop** | The band, while the voice is on | Stops the voice at once |
| `d` or **Talk it over** | The band | Opens the side assistant |
| `/voice` (`/voce`) | The prompt | Switches the voice on or off |
| **Copy** / **Send to the project** | The assistant's panel, when it proposes a request | Copies the request, or sends it to the project as your own message |

## Settings

Set these in the plugin's options in Claude Code. Values that cannot be used fall back to the defaults.

| Option | Default | What it does |
| --- | --- | --- |
| `language` | `auto` | `auto` follows the language of your last message, in any language Claude writes. `en` (English), `it` (Italiano) or `ro` (Română) fixes it: the labels, the mascot's lines, the voice phrases and the voice file |
| `assistantModel` | `claude-sonnet-5-5` | The model for the side assistant |
| `assistantEffort` | `max` | How hard the assistant thinks: `low`, `medium`, `high`, `xhigh` or `max` |
| `assistantMaxTokens` | `16000` | The longest reply the assistant may write (up to 64000) |
| `voiceHome` | empty (`%USERPROFILE%\.claude\voice`) | The folder holding `venv\` and `voices\` |

## Privacy

- **Suggestions** send each finished answer to the model under your own account, in one short completion on Sonnet 5.5:
  the end of the answer (its last 6000 characters) and the message that started the turn (its first 500 characters).
  The conversation itself is never sent.
- **The assistant** sends each of your messages to the model, in its own conversation. That conversation is not
  written into your project or its transcript.
- **The voice** runs locally. The text goes to a Piper process listening on `127.0.0.1` only, behind a secret that
  changes every time it starts. No audio is stored, and no speech service is contacted.
- **The clipboard** is written only when you choose a step in the desktop app or press Copy.
- **Your project** changes only when you send a message yourself.

## Limitations

- The voice works on Windows only. Each language has its own voice: a text in one language read by the other voice
  sounds accented.
- The labels and the mascot's lines follow the `language` option. Languages other than English, Italian and Romanian
  are translated by the model the first time, which takes a few seconds; a message too short to name keeps the current
  language.

## Development

The repository contains the mod's source, its tests and the voice daemon. Before opening a pull request, read
[CONTRIBUTING.md](CONTRIBUTING.md): pull requests are accepted only after discussion in an issue.

```text
claude plugin validate .
claude plugin test .
python -m unittest discover -s voiced/tests -t .
```

The type-check (`tsc -p`) uses the type files that Claude Code writes into `.claude-plugin/types/` when it loads the
mod. Architecture notes are in [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md); the assistant's design is in
[docs/ASSISTANT.md](docs/ASSISTANT.md).

## Credits

- Voice: Serena, Piper `it_IT-serena-high`, trained on the dataset
  [committa/serena-synthetic-it-27h](https://huggingface.co/datasets/committa/serena-synthetic-it-27h). Licensed
  CC-BY-4.0. Voice files from [rhasspy/piper-voices](https://huggingface.co/rhasspy/piper-voices).
- Voice: LJSpeech, Piper `en_US-ljspeech-high`, trained on the LJSpeech 1.1 dataset, which is public domain.
- Speech engine: [Piper](https://github.com/OHF-Voice/piper1-gpl) (`piper-tts`, GPL-3.0-or-later). It is installed in your own
  virtual environment and is not redistributed in this repository.
- The mascot is an original pixel-art drawing inspired by Claude Code's banner.

next-steps is an independent product. It is not affiliated with or endorsed by Anthropic. Claude and Claude Code
are Anthropic's products.

## License

MIT License. Copyright (c) 2026 humvnpvrvdox777. See [LICENSE](LICENSE).
