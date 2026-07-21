# TeleSyriana V2 CI remediation

This follow-up branch exists because V2 was merged before its automated checks were green.

Changes in this remediation:

- keep one canonical V2 GitHub Actions workflow
- remove duplicate workflows that created repeated notifications
- remove the broken `v2/package-lock.json` cache/`npm ci` assumption
- validate the current candidate server/modules rather than transitional entrypoints
- keep V2 blocked from production deployment until the remaining Node test failures are fixed and this PR is green
