# Memory

Remy keeps short notes about you, such as a preference, a fact about you or how you like something done. It saves one only when you say so or confirm it, and it asks first when the task has read a web page, an email or a file.

## Where notes live

Notes are in the `notes` table of `remy.sqlite` in your Remy folder, readable only by you. The chat and any background task use the same file, so both see the same notes. There is no limit on how many you keep. Notes never hold secrets: Remy does not save keys or passwords.

Older versions kept notes in `memory.json`. The first time a newer Remy opens your folder it imports that file once and renames it to `memory.json.imported`. It does not delete it. A file that cannot be read is left where it is, reported by `/memory` and `remy memory list`, and moved to `memory.json.damaged` the next time a note is saved.

## What the model sees

Only a few notes reach the model, so a long memory costs the same as a short one. Each message carries the notes that best match what you wrote, then your newest preferences, up to about 250 tokens and 12 notes. The `recall` tool searches all of your notes and past tasks when the model needs something older, up to about 600 tokens of notes.

## Duplicates and conflicts

The same fact in other words updates the note you have instead of adding a second one: "Likes tea" and "Likes tea with milk" become one note, and the longer wording stays. Notes of different kinds are never merged.

A note that cannot be true next to an older one of the same kind is saved, and both are flagged. Two cases count: one value of a single-valued fact against another ("Lives in Lisbon" and "Lives in Porto"; also where you work, your name, your favourite of something, your time zone) and a note against its negation ("Likes cilantro" and "Does not like cilantro"). "Lives in Lisbon" and "Lives in Lisbon, Portugal" do not conflict. Remy never replaces a note on its own. `/memory` and `remy memory list` show which notes may contradict each other. Forget the one that is out of date and the flag on the other goes away.

## Switching it off

Turn off "Personalise replies" in `/profile` and nothing is saved or recalled. Your notes stay on disk until you forget them with `/memory` or `remy memory clear`.
