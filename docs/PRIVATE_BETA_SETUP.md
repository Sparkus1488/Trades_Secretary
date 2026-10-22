# Trades Secretary sandbox setup (Release 0.4.2)

This guide describes a free, low-account-count testing deployment. It deliberately does not claim production SaaS readiness. This release uses JSON files and local media storage, and the free Render filesystem is ephemeral. Test accounts, records, sessions, and uploaded files can disappear when the service spins down, restarts, or redeploys. Use synthetic data only; never enter real customer or confidential information.

## What is ready in code

- Invite-only account registration when `SITEPIX_BETA_INVITE_CODE` is set; production startup refuses to run without it.
- Public config endpoint tells the registration screen whether an invite code is required, without revealing the code.
- Render Blueprint for a single Docker web service on the free plan, with a health check, generated invite code, and disabled automatic deployment. No persistent disk is attached.
- `npm run preflight` checks runtime prerequisites, data-path writability, required production values, and warns about missing optional integrations.
- Backup and restore scripts for manual local operations. These are not a substitute for durable cloud storage or tested disaster recovery.

## 1. Create or select the repository

1. Use the repository and branch containing this release.
2. Confirm `.env` and runtime data are not committed. Only `.env.example` should be in the repository.
3. Keep the sandbox isolated from production services and real user data.

## 2. Deploy the free sandbox on Render

1. Create or open your Render account and connect the repository.
2. Create a Blueprint deployment using the repository's `render.yaml`.
3. Review the service plan in Render before confirming; it should be the free plan. Do not add a paid disk for this sandbox.
4. The blueprint sets `SITEPIX_DATA_DIR` to `/app/data`, which is inside the container's ephemeral filesystem.
5. Render generates `SITEPIX_BETA_INVITE_CODE`. Copy it from the service environment page and share it only with trusted testers. Rotate it if exposed. This is a shared invite code, not individual invitations.
6. Deploy manually. Verify `/api/health` returns `ok: true`, then open the HTTPS site and create a test workspace using the invite code.
7. Keep automatic deployment disabled until you have a reviewed release process.

**Sandbox data warning:** Render free web services spin down after 15 minutes without inbound traffic and can take about a minute to wake. Filesystem changes are lost when the service spins down, restarts, or redeploys. Do not rely on accounts, records, sessions, or uploads surviving. Free web services do not support persistent disks.

## 3. Local validation before deploy

- Install Node.js 20 or newer.
- Run `npm test`.
- Run `npm run preflight`.
- Test invite-only registration with `SITEPIX_BETA_INVITE_CODE=your-long-random-code npm start` (shell syntax varies by platform).
- Verify a missing/wrong invite code is rejected and a correct code succeeds.
- Confirm `.env` is excluded from version control.

## 4. First sandbox acceptance test

Use synthetic data only. Invite a small number of trusted testers who understand that data may disappear.

- Register, sign in, sign out, and verify a wrong invite code cannot register.
- Create a customer, project, estimate, and separate travel estimate; verify travel remains excluded from bid totals.
- Save a manual supplier quote and check that it is labeled unverified and includes its source/date.
- Upload a non-sensitive test image/video, download it, and delete it.
- Test lead creation, estimate export, and workspace deletion.
- Verify AI/phone/billing/social integrations report not configured when no keys exist.
- Check logs and record any failures. Do not put real customer data in the sandbox.

## 5. Important gaps before public/paid launch

- PostgreSQL runtime adapter and migration are not implemented in this release; `DATABASE_URL` alone does not enable PostgreSQL.
- Private S3-compatible object storage adapter is not implemented; media remains on the local app filesystem.
- Password reset, email verification, MFA, team invites/roles, CSRF hardening review, durable distributed rate limits, malware scanning, and independent security review remain outstanding.
- OpenAI, Twilio, Stripe, Google Routes, Meta, and supplier APIs are not configured by this blueprint. Only connect a provider after account creation, permissions review, secret configuration, and live test calls.
- Automated video measurement, production-grade appointment scheduling, complete Stripe lifecycle handling, social OAuth/scheduling, and verified retailer stock/delivery data are not complete.
- Publish reviewed terms, privacy/retention policy, call recording/transcription disclosure, media consent, support contact, and refund/cancellation policies before inviting customers to use production data.

## 6. Future durable storage

Before storing real accounts or records, implement and test a PostgreSQL adapter and migration, private object storage for media, secure secret management, and automated backups with restore tests. Render's free Postgres database expires after 30 days, so it should not be treated as permanent free storage. Choose durable storage only after comparing current costs and requirements.
