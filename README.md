# Trades Secretary — Private-Beta Candidate Release 0.4.2

Trades Secretary is a single-instance pilot for contractor productivity workflows. It includes owner accounts, organization-scoped workspace data, private media uploads, CRM leads, estimates, marketing drafts, prototype telephony, and Stripe checkout/webhook handling.

**This is not production-ready SaaS.** Runtime data is JSON-backed, some integrations are prototypes, and the deployment is intended for a single instance only. Do not use sensitive customer data or scale horizontally.

## Requirements
- Node.js 20 or newer (Node 22 recommended)
- No npm dependencies are required for local pilot mode

## Run locally
1. Open a terminal in the project root.
2. Run `npm start`.
3. Open `http://localhost:4242`.

## Tests and checks
- Run `npm test` for the built-in Node test suite.
- Run `npm run preflight` to check configuration.
- Run `docker compose up --build` to run with Docker Compose.

## Free Render sandbox
The included `render.yaml` configures a free, single-instance Docker sandbox with automatic deployment disabled. It does not attach a persistent disk. Render's free filesystem is ephemeral, so test accounts, saved records, and uploaded media can be lost when the service spins down, restarts, or redeploys. Use synthetic test data only; do not use real customer information. The service may take about a minute to wake after inactivity. Production startup requires `SITEPIX_BETA_INVITE_CODE`, which the blueprint generates.

Read `docs/INTEGRATIONS.md`, `docs/PRIVATE_BETA_SETUP.md`, and `docs/LAUNCH_CHECKLIST.md` before using integrations or deploying. Live provider calls are not validated by the automated tests, and deployment has not yet been performed.

## Important limitations
The file-backed pilot does not provide managed database transactions, multi-instance consistency, encrypted-at-rest storage, managed backups, password-reset email, MFA, or a full production billing lifecycle. Before public launch, migrate to PostgreSQL and private object storage, add operational controls, and obtain an independent security review.
