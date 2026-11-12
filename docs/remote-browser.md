# Remote browsers

By default Remy opens pages in its own hidden Chrome on this computer. If you prefer, it can use a cloud browser instead: Steel or Browserbase. It is opt-in.

```
REMY_BROWSER=steel          # key: STEEL_API_KEY, or Keychain service remy, account steel
REMY_BROWSER=browserbase    # keys: BROWSERBASE_API_KEY and BROWSERBASE_PROJECT_ID,
                            # or Keychain accounts browserbase and browserbase-project
```

Unset (or `local`) keeps the browser on this computer.

## What is sent

- The service sees the pages Remy visits, what Remy types into them, and its screenshots, because the page runs on their machines.
- Your own browser profile, cookies and logins are never uploaded. A cloud session starts empty.
- Nothing from your files is sent unless Remy types it into a page, and then it goes through the same approvals as before.

## What stays the same

Every guard still runs on this computer before a page opens: loopback, private-network and metadata addresses are refused, the task's allowed-sites list applies, and buttons that spend money or sign in still need approval. The cloud browser cannot reach your localhost anyway.

## What changes

- One session per Remy process, started the first time a browser tool runs, released on exit and after 5 minutes unused.
- There is no window to show. `browser_show` explains this; a step that needs you (a password, a CAPTCHA) has to be done by you another way.
- If the key is missing or the service refuses a session, Remy says so in one sentence and stops. It does not fall back to the local browser, so pages never open somewhere you did not choose.
- The API key and the connection address are hidden from logs, events, snapshots and errors.
- Where the browser's status is shown it reads: "Pages open in Steel's cloud browser, not on this computer."

## Sources

Steel sessions (create, viewer link, `wss://connect.steel.dev?apiKey=...&sessionId=...`, release): docs.steel.dev. Browserbase create session (`X-BB-API-Key`, `connectUrl`) and update session (`REQUEST_RELEASE`): docs.browserbase.com. Steel's raw HTTP paths were not shown in the pages read (only the SDK); the paths used are `POST /v1/sessions` and `POST /v1/sessions/{id}/release`. Not yet run against either service.
