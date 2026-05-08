# Security policy

## Supported versions

The latest tagged release is supported. Older tags receive fixes only for
critical issues.

## Reporting a vulnerability

Please **do not** open a public issue for security problems. Instead:

1. Open a private security advisory on this repository, **or**
2. Email the maintainer (see the `Author` field in `README.md`).

Include: a description, reproduction steps, and the affected version. We aim
to acknowledge within 72 hours.

## What's in scope

- The installers (`install.sh`, `install.ps1`)
- The `gh-octerse` CLI extension
- Anything that writes files, executes commands, or modifies a user's repo

## What's not in scope

- Behavior of GitHub Copilot itself (report upstream to GitHub)
- Behavior of the editor or IDE (report to its maintainers)
- Cosmetic phrasing in instruction payloads
