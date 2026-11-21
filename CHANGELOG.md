# Changelog

All notable changes to ShipCheck are documented here.

## [1.0.0] — 2026-11-21
### Added
- GitHub repo audit: 18 checks scored from the GitHub API + Community Profile, with generated fixes (LICENSE, .gitignore, CONTRIBUTING, SECURITY, CODE_OF_CONDUCT, issue/PR templates).
- npm dependency risk scan: outdated levels, deprecation, abandonment, weekly downloads and OSV vulnerability checks, plus a one-command fix.
- Domain & email readiness: live DNS checks for A/AAAA, MX, SPF (with recursive lookup counting vs the 10-lookup limit), DKIM discovery, DMARC grading and a generated starter DMARC record.
- Combined Launch Readiness score and exportable Markdown report.
