# Improving Remy's own prompts

`remy improve` lets Remy suggest small changes to its own prompt wording, based on eval runs that failed. It only ever suggests. Nothing changes until you read the diff, a check shows the change helps, and you say yes.

## What can change

Only text on an explicit list can be tuned:

- Nine lines of the system rules: how to work in steps, how to finish, trying other sources, not asking to confirm the obvious, opening items before summarizing, linking sources, the knowledge cutoff, plans and checking the result.
- The descriptions of six plain tools: `read_file`, `list_files`, `finish`, `calculate`, `update_plan` and `ask_user`.
- The descriptions of three built-in skills: `research`, `triage-issues` and `save-to-notion`.

Everything else is locked: the approval, untrusted content, secrets and honesty rules, the never-lists, every tool that writes, sends, deletes, runs commands or fetches pages, the skills that send or buy, and all of policy. A test keeps a fingerprint of each locked text and fails if one changes. The model that writes the edits is never shown a locked id.

The model's output is not trusted. Before an edit is kept it must pass these checks, and an edit that fails any of them is dropped and listed:

- The id is on the editable list.
- At most 3 edits, one per id.
- The new text is at most 400 characters and no more than 120 longer than the old text.
- It has no backticks, backslashes or `${`, and tool and skill descriptions stay on one line.
- It does not mention secrets, untrusted content, safety or policy, and does not tell the model to ignore, skip or bypass approval, work without asking, or approve for the user.
- Its reason is one short sentence, and it names a case that really failed.

## Steps

1. Run an eval with a journal, so each run is saved: `pnpm eval --profile <p> --model <id> --suite hard --journal runs.jsonl --max-usd 2`.
2. Ask for a proposal: `remy improve propose --from runs.jsonl --profile <p> --model <id> --max-usd 0.10`. It prints the estimated cost first and refuses to start if the estimate is over the cap. It groups the failed runs, asks the model for at most 3 edits, and saves a proposal in `REMY_HOME/improve/` with the diff, the reasons and the case ids.
3. Check it: `remy improve check <proposal> [--suite hard] [--max-usd 0.50]`. The edits are applied in memory only. Remy runs the replay gate with the edits on, then the same cases live on the same model, as many times as the journal ran them. The estimate (the cost of the journal's runs) is printed first, and the run stops at the cap.
4. Read the verdict. A proposal is kept only if the failed target cases pass more often, no other case passes less often, the replay gate stays at 100% (so approval, injection and recovery still pass), and `eval compare` finds no regression: no safety violations or duplicate side effects, and no drop in success, cache reuse, cost or speed beyond its limits. A run lost to the provider, or one cut off by the cap, decides nothing.
5. Apply it: `remy improve apply <proposal>`. It refuses without a passing verdict, or if the edits changed after the check, or if the source no longer holds the old text. It shows the diff and waits for you to type `yes`. Then it edits the source files in the folder you run it from. It never commits: read `git diff`, run `pnpm check`, and commit yourself.

`remy improve list` shows saved proposals.
