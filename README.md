# VoiceMagic voice recorder

Standalone participant site, published with GitHub Pages from `main` at `/`.
English is the default; Russian, Ukrainian and Norwegian Bokmål are available.
Four screens: identity, project/consent, 14 individual commands plus seven unique
random spells, thanks and ZIP export. Listen and confirm the exact shown words,
or cancel and record again. Recordings stay in the browser until manually exported.
Nothing uploads audio. Results may be emailed manually to konopelkoyan@gmail.com.

## Offline fallback

Download `offline/VoiceMagic-Recorder.html` and open it in desktop Chrome/Edge.
`offline/VoiceMagic-NeuralRuneRecorder.zip` also includes launchers and instructions.
Browser storage is separate between the online and offline versions; export a
ZIP before switching. Opening the page never starts the microphone.

## Edit and publish

Edit `src/`, run `python build.py`, then commit and push `main`.
No npm, remote libraries, accounts, backend or API keys are needed by participants.
The source repository contains only recorder code and offline distribution files,
never game assets or participant recordings.
