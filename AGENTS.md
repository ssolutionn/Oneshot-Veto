# Oneshot-Veto Agent Guide

## Goal
Keep veto state correct and convergent across supported browsers, devices, network interruptions, and relay modes. Never represent stale transport data as live presence or an acknowledged current state.

## Working rules
- Inspect the current implementation and tests before editing.
- Make small, focused changes; do not refactor unrelated code.
- Add deterministic regression tests for every behavior change, including negative and recovery paths.
- Do not claim cross-browser or production readiness from static/unit tests alone. Record untested environments explicitly.
- Preserve legacy room/link compatibility unless a migration is implemented and tested.
- Avoid logging room secrets, encryption keys, packet bodies, or URL fragments.
- Treat relay snapshots as historical state unless freshness is independently verified.
- Online status must have bounded expiry and require fresh evidence. It must never gate safety-critical veto correctness unless protocol design proves the evidence and timeout semantics.

## Verification
- Run the tests and syntax checks relevant to the change.
- Check the complete diff for regressions and run the independent adversarial reviewer against it.
- Report exact commands/results and limitations, especially for mobile Safari, OBS Browser Source, VDO.Ninja, and deployed Cloudflare/Node environments.
