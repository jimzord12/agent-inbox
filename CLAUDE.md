@AGENTS.md

# Claude Code here

- Reviewers are fresh general-purpose subagents briefed per docs/practices/review.md, never a fork of the author.
- The mod is loaded for one session with `claude --plugin-dir mod` during development. It is installed into the real profiles only by INB-020, which the owner approved on 2026-10-22 (docs/decisions.md).
