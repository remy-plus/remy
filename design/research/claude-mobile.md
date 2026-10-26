# Claude mobile apps

Accessed 2026-10-25. iOS app version 1.261023.20 (App Store listing, iOS 18+). This is the weakest-sourced file: Anthropic publishes feature docs, not design specs, and I could not view screenshots. Rows marked "inferred" are unverified.

## Summary

The app is a conversation first. One composer sits at the bottom; projects, artifacts, search and settings are behind a sidebar. Voice, camera and files hang off the composer. Work that produces something (a doc, deck, design) opens in an Artifacts tab rather than staying in the thread. Recent releases add one thread across devices, with notifications when Claude has results or needs input.

## Anatomy (inferred)

```
┌ ☰   Chat title            ⌄ model ┐
│                                   │
│  you                              │
│  ┌─────────────────────────────┐  │
│  │ message (quiet bubble)      │  │
│  └─────────────────────────────┘  │
│  Claude reply, plain text,        │
│  no bubble                        │
│  ▸ Thought for 8s  (collapsed)    │
│  ▭ Artifact card, opens a tab     │
├───────────────────────────────────┤
│ ＋   Message Claude…     ((•))  ➤ │   + attach/camera/files; waveform = voice
└───────────────────────────────────┘
```

## Patterns

| Pattern                        | Behaviour                                                                                                                                                                                               | Status                     | Why it works                             |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- | ---------------------------------------- |
| Voice entry                    | Sound-wave icon next to the mic in the input; hands-free by default, interrupt by speaking, push-to-talk alternative; settings bottom left; transcripts saved as text; switch voice and text mid-thread | Verified (support article) | One composer, two modes, no context loss |
| Artifacts tab                  | Ask in any chat; the result opens in the Artifacts tab and is editable there; sharing settings are web and desktop only                                                                                 | Verified (support article) | Output becomes an object                 |
| Docs, Slides, Design on mobile | Edit a doc, deck or design on the phone (out of beta 2026-10-08)                                                                                                                                        | Verified (release notes)   | Review and nudge on the go               |
| Cross-device continuity        | Work started on one device resumes on another; notifications when results are ready or input is needed (2026-10-23, Enterprise)                                                                         | Verified (release notes)   | Long tasks do not need the screen        |
| Duet (research preview)        | Standalone iOS and Android app, one ongoing thread by text or voice, notifies on completion or review (2026-10-21)                                                                                      | Verified (release notes)   | A single-thread model for an agent       |
| Widgets                        | Small and medium widgets with chat, camera, mic, add image, voice shortcuts                                                                                                                             | Verified (dated coverage)  | Entry in one tap                         |
| Search, memory, incognito      | Search past chats; memory summaries; incognito chats (2025)                                                                                                                                             | Verified (release notes)   | Continuity with a clear private mode     |
| Thinking and progress          | Collapsed summary and a pulsing mark while working                                                                                                                                                      | Inferred                   |                                          |
| Haptics, motion, type, color   | Light haptics on send; warm off-white, serif accent                                                                                                                                                     | Inferred                   |                                          |
| Onboarding, empty states       | Short sign-in, then an empty composer with suggestions                                                                                                                                                  | Inferred                   |                                          |

## Borrow

- One composer with voice inside it; transcripts kept as text.
- Results as objects (a "Result" card that opens), not walls of text in the thread.
- A push notification when a task finishes or needs approval, answerable from the notification.
- A single ongoing thread for a long-lived agent.
- Warm paper background and quiet bubbles.

## Do not borrow

- Hiding what the agent did. On mobile Remy must still show the action log one tap away.
- Implicit memory. Remy's records are events the user can inspect.
- Empty-state suggestions for tasks Remy cannot yet do reliably.

## Sources

- https://apps.apple.com/us/app/claude-by-anthropic/id6473753684 (2026-10-25)
- https://support.claude.com/en/articles/11101966-using-voice-mode (2026-10-25)
- https://support.claude.com/en/articles/9487310-what-are-artifacts-and-how-do-i-use-them (2026-10-25)
- https://releasebot.io/updates/anthropic/claude (2026-10-25), a mirror of the Claude release notes
- https://alternativeto.net/news/2024/10/claude-app-updates-enhance-mobile-functionality-and-ipad-availability (2024 redesign, dated)

Not verified: all visual specifics (type, color, haptics, motion, empty states, onboarding). A follow-up needs screenshots of the current iOS and Android builds.
