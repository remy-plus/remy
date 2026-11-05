# Security

Remy reads untrusted web pages and acts on your behalf, so we take these reports seriously.

## Reporting

Please use [a private security advisory](https://github.com/remy-plus/remy/security/advisories/new) rather than a public issue. Include what you did, what happened and what you expected.

## What counts

- A page, email, file or skill that gets Remy to act without your approval
- A way around the approval card, or an approval reused for a different action
- Keys or secrets reaching the model, logs or an outside service
- Remy reading or writing outside the folder it was given

## What Remy promises

- After Remy reads untrusted content, any action beyond reading asks you first.
- An approval covers one exact action, once.
- Payments and deletes ask every time.
- Text from pages, emails and skills from a link is treated as data, never as instructions.

## Supported versions

Fixes go into the latest release on npm.
