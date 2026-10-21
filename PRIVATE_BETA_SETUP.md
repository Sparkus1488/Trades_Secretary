# Trades Secretary private-beta setup (Release 0.4.1)

This is a low-account-count pilot deployment guide. It deliberately does not claim production SaaS readiness. This release still uses JSON files and local media storage, so run exactly one app instance with a persistent disk. Do not use real sensitive customer data until a security review and privacy controls are complete.

## What is ready in code

- Invite-only account registration when `Trades Secretary_BETA_INVITE_CODE` is set; production startup refuses to run without it.
- Public config endpoint tells the registration screen whether an invite code is required, without revealing the code.
- Render Blueprint for a single Docker web service with a persistent disk, health check, generated invite code, and disabled automatic deployment.
- `npm run preflight` checks runtime prerequisites, persistent data path writability, required production values, and warns about missing optional integrations.
- Backup and restore scripts for manual operations. These are not a substitute for automated encrypted offsite backups and tested disaster recovery.

## 1. Create the repository

1. Download the release ZIP and extract it.
2. Create a private repository in a Git hosting account you control.
3. Upload the contents of the `sitepix-ai-mvp` directory to the repository root (including `render.yaml`, `Dockerfile`, `scripts/`, `docs/`, `db/`, `public/`, and `package.json`).
4. Confirm `.env` and runtime data are not committed. Only `.env.example` should be in the repository.

## 2. Deploy a private beta on Render

1. Create a Render account and connect the private repository.
2. Create a new Blueprint deployment using the repository's `render.yaml`.
3. Review the paid web-service and persistent-disk costs before confirming. The blueprint uses one instance and a 1 GB disk; confirm current provider pricing and region availability in the dashboard.
4. Set `Trades Secretary_BASE_URL` to the exact HTTPS service URL shown by Render (for example, `https://your-service-name.onrender.com`).
5. Render generates `Trades Secretary_BETA_INVITE_CODE`. Copy it from the service environment page and share it privately only with invited testers. Rotate it if it is exposed. This is a shared invite code, not individual invitations.
6. Deploy manually. Verify `/api/health` returns `ok: true`, then open the HTTPS site and create one test workspace using the invite code.
7. Do not enable auto-deploy until you have a reviewed release process.

The persistent disk keeps JSON runtime data and uploads across service restarts, but it does not make JSON storage transactional or multi-instance safe. Do not scale this service horizontally. The disk is not an offsite backup.

## 3. Local validation before deploy

- Install Node.js 20 or newer.
- Run `npm test`.
- Run `npm run preflight`.
- Test invite-only registration with the environment set: `Trades Secretary_BETA_INVITE_CODE=your-long-random-code npm start` (shell syntax varies by platform).
- Verify a missing/wrong invite code is rejected and a correct code succeeds.
- Confirm `.env` is excluded from version control.

## 4. First private-beta acceptance test

Use synthetic data only. Invite 2–5 contractors who agree to test and do not upload confidential customer information.

- Register, sign in, sign out, and verify a wrong invite code cannot register.
- Create a customer, project, estimate, and separate travel estimate; verify travel remains excluded from bid totals.
- Save a manual supplier quote and check that it is labeled unverified and includes its source/date.
- Upload a non-sensitive test image/video, download it, and delete it.
- Test lead creation, estimate export, and workspace deletion.
- Verify AI/phone/billing/social integrations report not configured when no keys exist.
- Test backups and restoration in a separate temporary directory before storing anything valuable.

## 5. Important gaps before public/paid launch

- PostgreSQL runtime adapter and migration are not implemented in this release; `DATABASE_URL` alone does not enable PostgreSQL.
- Private S3-compatible object storage adapter is not implemented; media remains on the persistent app disk.
- Password reset, email verification, MFA, team invites/roles, CSRF hardening review, durable distributed rate limits, malware scanning, and independent security review remain outstanding.
- OpenAI, Twilio, Stripe, Google Routes, Meta, and supplier APIs are not configured by this blueprint. Only connect a provider after account creation, permissions review, secret configuration, and live test calls.
- Automated video measurement, production-grade appointment scheduling, complete Stripe lifecycle handling, social OAuth/scheduling, and verified retailer stock/delivery data are not complete.
- Publish reviewed terms, privacy/retention policy, call recording/transcription disclosure, media consent, support contact, and refund/cancellation policies before inviting customers to use production data.

## 6. Backup operations

Set `Trades Secretary_DATA_DIR` to the app's persistent data directory and run `./scripts/backup.sh /path/to/separate-backup-volume`. Store backups in a separate encrypted/offsite location. To restore, stop the app, ensure the target data directory is empty, then run `Trades Secretary_DATA_DIR=/path/to/data ./scripts/restore.sh /path/to/archive.tar.gz`. Test restore on a copy first; never experiment on the only copy of live data.
