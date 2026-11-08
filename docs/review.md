# Reach advice and what ran while you were away

## `remy doctor` and reach

`remy doctor` ends with a recommendation for how Remy should reach real apps and search on this machine. It reads memory, chip, cores, free disk where Remy keeps its data, whether Docker is running, whether Chrome or Edge is installed, and whether a search service key is set. Nothing is downloaded or started to find out. Docker is asked once, with a three second limit.

| Machine                                | Recommendation                                                                       |
| -------------------------------------- | ------------------------------------------------------------------------------------ |
| Under 16 GB, or less than 10 GB free   | `light`: the hidden browser                                                          |
| 16 GB or more, Docker running          | `strong`: a container (`remy browser vm start`)                                      |
| 16 GB or more, no Docker               | `light`, with one step: install or start Docker or Colima                            |
| Linux with room and no desktop browser | `home-server`: a container. The ready-made Docker image for servers comes in Stage 6 |

It always gives a one-line reason and the single next step. If no browser and no search key are found, the step is to install Chrome or set `TINYFISH_API_KEY`.

terminal-mac and Boat (a cloud computer on your own account) are opt-in. Doctor lists them and installs nothing.

## `remy review`

`remy review [--since 24h|7d|<date>]` lists tasks that started without you at the keyboard: scheduled runs, file watches and background tasks. The default window is 24 hours. In the chat, `/review` does the same and takes the same window (`/review 7d`).

Each task shows when it started, where it came from, what it was asked, how it ended (succeeded, failed, paused, waiting for approval or for your answer, still running, cancelled) and what it cost. It lists what changed, which means calls that wrote, sent, spent or deleted and completed, and the exact text of any card waiting for your OK. Tasks that need you come first, then the rest, newest first. If nothing ran, it says so in one line.

It reads the task log only. No model is called and nothing is changed.

Prompts, tool arguments and card text can contain words from web pages or other people. Review shows them in quotes as data, with control characters removed and long text cut short. Remy does not act on them.

The daemon's notification when a background task finishes, fails or first needs your approval ends with `remy review`.
