# Local voice in the terminal (2026-11-12)

Everything runs on this Mac. Nothing is sent anywhere.

## What was installed

- `brew install whisper-cpp` (the formula is now named `whisper.cpp`): whisper.cpp 1.9.5, binary `/opt/homebrew/bin/whisper-cli`.
- ffmpeg 9.0.2 (already there), macOS `say` (built in).
- Model `ggml-base.en.bin` from `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin` into `~/.remy/voice/`, 147,964,211 bytes.
  - SHA-256 `a03779c86df3323075f5e796cb2ce5029f00ec8869eee3fdfb897afe36c6d002` equals the `x-linked-etag` Hugging Face publishes for the file.
  - SHA-1 `137c40403d78fd54d454da0f9bd998f78703390c` (the value whisper.cpp's model README lists for this model, from memory; the SHA-256 is the checked one).

## What was built

- `apps/cli/src/voice-local.ts`: `createVoice(env)` with `check()`, `transcribe(wav)`, `record({maxSeconds})`, `speak(text)`, `stopSpeaking()`. Programs start through `spawn` with argument lists (no shell). `say` gets its text on stdin (`say -f -`), so flags inside the text are never read as options. Spoken text drops code, links and markdown marks and is capped at 400 characters at a sentence. Recording is 16 kHz mono wav in a `mkdtemp` folder (mode 0700), at most 30 s, folder deleted afterwards (also on cancel and on failure). Each missing piece gives one next step, for example `Voice needs whisper.cpp: brew install whisper-cpp`. When ffmpeg cannot open the microphone the message says macOS asks Terminal for permission and where to allow it.
- `/voice` toggles spoken final answers (not tool chatter). `/listen` records until Enter (Esc cancels, 30 s at most), transcribes, and puts the text in the prompt. It never sends: Enter sends, as for typed text. Spoken replies stop when a task is interrupted or `/listen` starts.
- `remy voice test` checks each piece, speaks one test line, exits 1 when something is missing.
- Tests: `voice-local.test.ts` (19, fake exec: missing whisper, ffmpeg, model and say, timeout, empty transcript, non-zero exit, long text capped, interruption and replacement, cancel, mic permission message, temp folder removal) and 5 chat tests (`/voice` on and off, next step when speech is impossible, `/listen` draft and nothing sent, Esc, start failure).

## Live proof (no human, no microphone recording)

```
$ say -o /tmp/rv-proof/x.aiff "Remind me to call the dentist at four"
$ ffmpeg -i x.aiff -ar 16000 -ac 1 -c:a pcm_s16le x.wav          # 0.37 s
$ transcribe('/tmp/rv-proof/x.wav')
transcribe 7755 ms (first run, cold model load)  {"ok":true,"text":"Remind me to call the dentist at 4."}
transcribe  243 ms, 219 ms (warm, two more runs)  same text
$ speak('Remind me to call the dentist at four. Voice is working on this computer.')
speak 5030 ms, 5002 ms, 4936 ms  {"ok":true,"spoken":"..."}     # real audio through say; time is the length of the speech
$ pnpm remy voice test
ok       whisper.cpp found (whisper-cli)
ok       Speech model found (/Users/aarav/.remy/voice/ggml-base.en.bin)
ok       ffmpeg found (ffmpeg)
ok       macOS say found
ok       Spoke a test line.
Everything runs on this computer; nothing is sent anywhere.
$ ffmpeg -f avfoundation -list_devices true -i ""
[0] Background Music  [1] MacBook Air Microphone  [2] Background Music (UI Sounds)  [3] iPhone Microphone
```

The transcript says "4" where the spoken word was "four": whisper writes digits. Fine for a composer the person reads before sending.

Not run: recording from the microphone (no human here, and macOS will prompt Terminal for permission on first use). The recorder uses `-i :default` rather than `:0`, because index 0 on this Mac is the virtual "Background Music" device, not the microphone. `:default` was not exercised live.

## Voice on your computer (user note)

- Needs: `brew install whisper-cpp` and the speech model. Spoken replies need only macOS `say`.
- The model lives in `~/.remy/voice/ggml-base.en.bin`, about 142 MB (English only, base size). Download it with `curl -L -o ~/.remy/voice/ggml-base.en.bin https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin` (make the folder first).
- Try it: `remy voice test`. In the chat, `/voice` turns spoken answers on or off, `/listen` records until Enter and leaves the text in the prompt for you to check.
- To remove: `rm -r ~/.remy/voice` and `brew uninstall whisper-cpp`. Recordings are never kept: each one is deleted as soon as it is read.
- The first time `/listen` runs, macOS asks whether Terminal may use the microphone. If you said no: System Settings > Privacy & Security > Microphone.
