# 🚀 ShipCheck — Launch With Confidence

**The free all-in-one pre-launch check for developers.** Audit your GitHub repo, scan your npm dependencies for vulnerabilities and abandonment, and verify your domain's email DNS — then *generate the fixes*. No account, no install, no server: everything runs in your browser against public APIs.

🔗 **Live app:** https://haminyovanantonyfk-netizen.github.io/ship-check/
📦 **Installable:** it's a PWA — "Add to Home Screen" on Android/iOS, or wrap it with Capacitor for a native build.

## Why this exists

Launches fail in predictable places — and until now each check lived somewhere else: repo doctors are install-only CLIs, dependency monitoring is paid SaaS (Snyk, Socket) or a single-purpose web page, and DNS checkers dump raw records with no launch verdict. Meanwhile:

- **86% of codebases** contain open-source components with known vulnerabilities; the average app carries ~911 open-source components (Black Duck OSSRA).
- GitHub's own Community Profile health score for a typical new project is **under 30%** — no contributing guide, no security policy, no templates.
- Since 2024–25, **Gmail, Yahoo and Outlook require SPF, DKIM and DMARC**. Missing records = your launch emails, receipts and password resets land in spam or get rejected outright.

ShipCheck runs all three audits in one place, scores them, and — unlike a checker — **writes the missing files and DNS records for you**.

## The three checks

### 1 · 📦 GitHub repo audit
Enter `owner/repo`. ShipCheck scores 18 signals from the GitHub API and Community Profile: description, topics, homepage, README existence *and* quality, LICENSE, .gitignore, CI workflows, CONTRIBUTING, SECURITY, issue/PR templates, Code of Conduct, CHANGELOG, releases, recent activity, and GitHub's health percentage. For everything missing, it **generates the file** (MIT LICENSE with your name, stack-aware .gitignore, CONTRIBUTING, SECURITY, CODE_OF_CONDUCT, issue templates, PR template) ready to copy or download into your repo.

### 2 · 🧩 Dependency risk scan (npm)
Paste `package.json`. Each dependency is checked live against the npm registry and the OSV vulnerability database: outdated level (patch/minor/major), deprecated (with the author's reason), abandoned (no release in 2+ years), weekly downloads, license, and known CVEs with severity — sorted worst-first, with a risk score and **one copy-paste `npm install` command** that fixes the outdated and vulnerable ones.

### 3 · 🌐 Domain & email readiness
Enter a domain. ShipCheck reads live DNS (Cloudflare DNS-over-HTTPS): website A/AAAA, MX + provider detection, SPF validation including **recursive lookup counting against the hard limit of 10**, DKIM key discovery across 14 common selectors with key-strength estimate, DMARC policy grading (none → quarantine → reject), CAA, and nameserver redundancy. Missing DMARC? It writes your starter record.

### Combined Launch Readiness score + exportable Markdown report for all three.

## Privacy

Your inputs never touch a ShipCheck server — there isn't one. The page talks directly from your browser to `api.github.com`, `registry.npmjs.org`, `api.npmjs.org`, `api.osv.dev` and `cloudflare-dns.com`. Scores are kept only in your browser's local storage.

## Honest limits

- GitHub's unauthenticated API allows ~60 requests/hour per IP — enough for ~6 repo audits/hour.
- Vulnerability checks use the **lowest** version your semver range allows (what a fresh install could resolve to at minimum) — run `npm audit` locally for your exact lockfile tree.
- DKIM discovery tries common selectors; a provider with a custom selector can be missed.
- Scores are launch-readiness heuristics, not a security certification.

## Tech

Vanilla HTML/CSS/JS, zero dependencies, PWA (offline app shell), MIT licensed. Data: GitHub REST API, npm registry + downloads API, OSV API, Cloudflare DNS-over-HTTPS.

## License

MIT — free for everyone, forever.
