# Memory

Remy keeps short notes about you, such as a preference, a fact about you or how you like something done. It saves one only when you say so or confirm it, and it asks first when the task has read a web page, an email or a file.

## Where notes live

Notes are in the `notes` table of `remy.sqlite` in your Remy folder, readable only by you. The chat and any background task use the same file, so both see the same notes. There is no limit on how many you keep. Notes never hold secrets: Remy does not save keys or passwords.

Older versions kept notes in `memory.json`. The first time a newer Remy opens your folder it imports that file once and renames it to `memory.json.imported`. It does not delete it. A file that cannot be read is left where it is, reported by `/memory` and `remy memory list`, and moved to `memory.json.damaged` the next time a note is saved.

## What the model sees

Only a few notes reach the model, so a long memory costs the same as a short one. Each message carries the notes that best match what you wrote, then your newest preferences, up to about 250 tokens and 12 notes. The `recall` tool searches all of your notes and past tasks when the model needs something older, up to about 600 tokens of notes.

### Cost as memory grows

The notes for a message are picked once, when you send it, and that block is reused word for word for every step of the task and every later request in the chat. It goes in front of your message, after the part of the prompt a provider caches, so a long memory does not break the cache and a new note saved mid-task changes nothing already sent. Measured offline with a 12-turn chat, two model steps a turn (24 requests):

| Notes | Requests repeating the one before | Notes block per message | Situation block | Largest request |
| ----- | --------------------------------- | ----------------------- | --------------- | --------------- |
| 0     | 99.95%                            | 0                       | 97 chars        | 5.8 KiB         |
| 50    | 99.98%                            | up to 214 tokens        | 97 chars        | 14.5 KiB        |
| 500   | 99.98%                            | up to 221 tokens        | 97 chars        | 16.4 KiB        |
| 5,000 | 99.98%                            | up to 221 tokens        | 97 chars        | 16.4 KiB        |

The cap is 250 tokens and 12 notes, so 500 notes cost the same as 5,000. The replay memory suite checks the same at 500 and 5,000 notes: at least 99% of each request repeats the one before, and no request grows past a fixed size.

## How notes are found

Matching runs on your machine, with no key and no network. Remy ranks notes by the words they share with your message (BM25), after folding common endings together, so "living" finds "Lives in Porto". Numbers and dates stay whole, and "mar" counts as March. A short, fixed list of related words helps with the common cases: where you live, work or home, your pet or dog or cat, your job or employer, family words, phone, email and a few more. "Where do I live?" finds "Lives in Porto" and "my pet" finds "Has a dog named Kiwi" for that reason. A word that is neither shared nor on the list matches nothing. This is word matching, not understanding. The `recall` tool ranks past tasks the same way.

### Embeddings (optional, off by default)

If your provider offers an OpenAI-compatible `/embeddings` endpoint, set `REMY_EMBEDDINGS=on` and recall also compares meaning, so "something to keep me warm" can find "Owns a wool coat". Ranking then mixes the word score and the vector score.

What is sent: the text of each note and the text of the recall query, to the provider you already chose for chat, and to no other. There is no separate address to set. Nothing else goes: not task content, files, keys or the notes' ids. A note is sent once, in batches, and again only when you edit it; its vector is stored in `remy.sqlite` next to the note and deleted with it. A new message sends only its own text.

The model is `REMY_EMBEDDING_MODEL`. When the provider is OpenAI it defaults to `text-embedding-3-small`; for any other provider set it yourself. If the endpoint fails (not offered, refused, offline), Remy ranks locally for the rest of the session without interrupting you, and `remy doctor` shows the failure. With "Personalise replies" off, no embedding request is made.

## Duplicates and conflicts

The same fact in other words updates the note you have instead of adding a second one: "Likes tea" and "Likes tea with milk" become one note, and the longer wording stays. Notes of different kinds are never merged.

A note that cannot be true next to an older one of the same kind is saved, and both are flagged. Two cases count: one value of a single-valued fact against another ("Lives in Lisbon" and "Lives in Porto"; also where you work, your name, your favourite of something, your time zone) and a note against its negation ("Likes cilantro" and "Does not like cilantro"). "Lives in Lisbon" and "Lives in Lisbon, Portugal" do not conflict. Remy never replaces a note on its own. `/memory` and `remy memory list` show which notes may contradict each other. Forget the one that is out of date and the flag on the other goes away.

## Switching it off

Turn off "Personalise replies" in `/profile` and nothing is saved or recalled. Your notes stay on disk until you forget them with `/memory` or `remy memory clear`.
