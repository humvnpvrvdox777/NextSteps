# next-steps

**Your next move, one click away.** next-steps is a Claude Code mod that turns every finished answer into a clear
choice. Claude's mascot asks how you want to continue and offers three next steps: the natural continuation, a
verification, and an alternative. Pick one, several or all three, and they land in your prompt, ready for you to
edit and send. Nothing is sent until you press Enter.

It works in the Claude Code desktop app and in the terminal. You can also turn on a local voice that reads each
answer aloud, and open a side assistant to think through the next step before you commit to a request for your
project.

## Support

next-steps is free and open source. If it saves you time, you can support its development on PayPal:
[paypal.me/bside777](https://paypal.me/bside777).

## Highlights

- **Three suggested next steps after each answer.** Roles are fixed and predictable: continue, verify, or try a
  different approach.
- **Build your request from several steps.** Choose any step as often as you like; each one is written into the
  prompt once, in the order you chose it. The band stays on screen until you send the prompt.
- **You stay in control.** Suggestions never submit themselves. You review, edit and send.
- **Local voice (optional).** A Piper text-to-speech voice runs on your machine. It reads the answer and then the
  three options. Nothing is streamed to the cloud, and no audio is stored.
- **Talk it over, a side assistant.** Talk the problem through in a separate conversation that does not touch your
  project. When you agree on a request, it proposes it in an editable field; you copy it or send it yourself.
- **Built to stay out of your way.** The band yields to running turns and surveys, and a failed suggestion never
  interrupts your work.
- **A clean, animated mascot.** Pixel-art Claude mascot in a dark teal frame that complements Claude's orange,
  animated per state (reading, thinking, asking, chatting).

## How it works

1. You finish a conversation turn with Claude. If the answer is at least 80 characters long, next-steps asks the
   model for three next steps based on that answer.
2. The mascot appears above your prompt and asks "Come vuoi proseguire?" (or, with the voice on, reads the answer
   and the options aloud).
3. Press `1`, `2` or `3`, or click a step. It is written into the prompt. Choose more steps if you want to combine
   them. Each chosen step is marked with a check mark, and the band tells you how many are in the prompt.
4. Edit the prompt if you wish, then press Enter. The band disappears when the prompt is sent.

On the desktop app the prompt box belongs to the app, so next-steps copies your chosen steps to the clipboard,
one per line. Paste them with Ctrl+V.

## Requirements

- Windows 10 or 11. Tested on Windows 11; the local voice uses Windows audio playback.
- Claude Code with function-hook (mod) support, in the desktop app or the terminal. Developed against Claude Code
  2.1.286 and 2.1.295.
- An active Claude account. Each suggestion and each assistant reply uses the model, as any Claude Code request
  does.
- For the voice only: Python 3.12, about 250 MB of disk space, and one voice file: 109 MB for English, 114 MB for Italian.

## Installation

Run these commands in Claude Code, from a terminal session:

```text
/plugin marketplace add humvnpvrvdox777/next-steps
/plugin install next-steps@next-steps
```

Then run `/reload-plugins` or restart Claude Code. The mod is active from the next answer on. Access to this
private repository must be granted to your GitHub account before the first command works.

## Turning on the voice (optional)

The voice is off by default. Each language has its own voice, and the mod uses the one that matches the `language`
option. Create the Python environment once (Windows, Python 3.12):

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

If you use the Italian language, download the Italian voice (Serena, Piper `it_IT-serena-high`, 114 MB, CC-BY-4.0):

```powershell
$base = "https://huggingface.co/rhasspy/piper-voices/resolve/main/it/it_IT/serena/high"
Invoke-WebRequest -Uri "$base/it_IT-serena-high.onnx" -OutFile "$voice\voices\it_IT-serena-high.onnx"
Invoke-WebRequest -Uri "$base/it_IT-serena-high.onnx.json" -OutFile "$voice\voices\it_IT-serena-high.onnx.json"
```

Then pick the voice in the band's Voice dropdown (or type `/voice`, or `/voce` in Italian) to switch it on. If the folder is somewhere
else, set the option `voiceHome`. If the voice cannot start, the mod shows the reason and the voice stays off;
everything else keeps working.

## Using it

| Key or button | Where | What it does |
| --- | --- | --- |
| `1`, `2`, `3` | Terminal, with the prompt box empty | Adds that step to the prompt |
| Click a step | Terminal and desktop app | Adds that step to the prompt |
| **Voice** dropdown | The band | Picks Off or a voice file; the choice is kept for the next session |
| `s` or **Stop** | The band, while the voice is on and ready | Stops the voice at once |
| `d` or **Talk it over** | The band | Opens the side assistant |
| `/voice` | The prompt | Switches the voice on or off |
| **Copy** / **Send to the project** | The assistant's panel, when it proposes a request | Copies the request, or sends it to the project as your own message |

## Settings

Set these in the plugin's options in Claude Code:

| Option | Default | What it does |
| --- | --- | --- |
| `language` | `en` | `en` (English) or `it` (Italiano): the labels, the mascot's lines, the voice phrases and the voice file |
| `assistantModel` | `claude-sonnet-5-5` | The model for the side assistant |
| `assistantEffort` | `max` | How hard the assistant thinks: `low`, `medium`, `high`, `xhigh` or `max` |
| `assistantMaxTokens` | `16000` | The longest reply the assistant may write (up to 64000) |
| `voiceHome` | empty (`%USERPROFILE%\.claude\voice`) | The folder holding `venv\` and `voices\` |

Values that cannot be used fall back to the defaults.

## Privacy

- **Suggestions** call the model once per qualifying answer, with the end of that answer, under your own account.
- **The assistant** calls the model for each message you send it, in its own conversation. That conversation is
  not written into your project or its transcript.
- **The voice** runs locally. The text goes to a Piper process listening on `127.0.0.1` only, protected by a secret
  that changes every time it starts. No audio is stored, and no speech service is contacted.
- **The clipboard** is written only when you press a button that copies a step or a request.
- **Your project** is changed only by the message you choose to send.

## Limitations

- The voice works on Windows only. Each language has its own voice: a text in one language read by the other voice sounds accented.
- The labels and the mascot's phrases are in English by default; the `language` option (`en` or `it`) switches them. The suggested steps follow the language of your last message.
- On the desktop app a chosen step goes to the clipboard, because the app owns the prompt box.

## Development

The repository contains the mod's source, its tests and the voice daemon.

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
- Speech engine: [Piper](https://github.com/rhasspy/piper) (`piper-tts`, GPL-3.0). It is installed in your own
  virtual environment and is not redistributed in this repository.
- The mascot is an original pixel-art drawing inspired by Claude Code's banner.

next-steps is an independent product. It is not affiliated with or endorsed by Anthropic. Claude and Claude Code
are Anthropic's products.

## Contact

For questions, support and licensing: humvnpvrvdox@gmail.com

## Support

If next-steps is useful to you, you can support its development on PayPal:
[paypal.me/bside777](https://paypal.me/bside777). Thank you.

## License

MIT License. Copyright (c) 2026 humvnpvrvdox777. See [LICENSE](LICENSE).
