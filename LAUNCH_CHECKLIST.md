# Trades Secretary launch checklist

Use this as the release gate before taking payments or handling real client data. Items marked **account/owner action** cannot be completed without your provider accounts, domain, policy decisions, or field testing.

## Already built in pilot 0.4.0
- [x] Owner registration/login with scrypt password hashing and opaque session cookies
- [x] Organization-scoped JSON workspaces and authorization on application APIs
- [x] Lead CRM, draft estimating calculator with man-hour rates and material markup, contractor-entered cost references
- [x] Supplier search links for Lowe’s, The Home Depot, Menards, Ace Hardware, and local supplier map results; authorized Lowe’s live-price adapter scaffold
- [x] Trade/industry selection, customer-addressed project records, home/office origin, and itemized travel estimator kept separate from bid totals
- [x] Private local media upload/download/delete with file-type signature checks and storage quotas
- [x] Workspace export and password-confirmed owner deletion
- [x] OpenAI marketing draft adapter with human approval requirement
- [x] Stripe Checkout/Customer Portal request scaffolding and signed webhook event processing
- [x] Twilio signature-validated voice/voicemail webhooks and basic OpenAI conversational voice loop
- [x] Optional explicitly approved Facebook Page text publishing
- [x] Automated tests for auth, isolation, upload privacy, estimation validation, and signed/idempotent Stripe webhooks

## Must be completed before a public SaaS launch
- [ ] **Database migration:** replace JSON files with PostgreSQL migrations and organization-scoped queries; add transactions, indexes, connection pooling, and safe concurrent writes.
- [ ] **Identity:** password recovery, email verification, MFA or passkeys, session revocation UI, team invitations, roles, and account recovery procedure.
- [ ] **Security review:** threat model, dependency review, penetration test, CSRF/session review, rate limits for all costly routes, upload malware scanning, secure secret rotation, and incident-response process.
- [ ] **Media storage:** move to private S3-compatible object storage with signed upload/download URLs, lifecycle deletion, backups, encryption, quotas, and verified ownership checks.
- [ ] **Privacy/legal:** publish privacy policy, terms, retention/deletion policy, customer media consent, AI disclosure, call-transcription notice, recording disclosures, and jurisdiction-specific compliance review.
- [ ] **Billing:** configure Stripe test products and webhook endpoint; test checkout, duplicate webhook delivery, trial/active/past-due/canceled states, upgrades/downgrades, add-on changes, refunds/disputes, customer portal, and payment failure behavior. Configure taxes and customer invoices.
- [ ] **Voice receptionist:** real-call tests for noise/accent handling, transcription errors, latency, interrupted speech, prompt-injection attempts, caller escalation, voicemail fallback, after-hours behavior, structured lead extraction, and appointment scheduling. Do not promise a human handoff until it is verified end-to-end.
- [ ] **Measure & Bid AI:** choose a vision/depth measurement provider; implement consented video/frame extraction, calibration/reference objects, room/plane detection, quantities/waste factors, uncertainty/confidence, takeoff editing, and bid-document generation. Test against known measurements across multiple phones, lighting conditions, trades, and room types; require contractor verification.
- [ ] **Cost data:** obtain supplier partner approvals (Lowe’s API access is partner-gated; Menards production API requires authorization), add any permitted Home Depot/Ace/catalog feeds, connect supplier/catalog or licensed cost sources; record source, region, timestamp, units, taxes, permits, disposal, labor assumptions, and license permissions.
- [ ] **Media processing:** choose image/video enhancement and report-generation services; preserve originals and obtain customer permission before reuse.
- [ ] **Social integrations:** verify Meta app permissions, token refresh/rotation, API version, content rules, publishing errors, and account disconnect. Add OAuth onboarding, media uploads, Instagram if desired, and scheduling only after approved API access.
- [ ] **Growth/referrals:** implement opt-in referral links, attribution, anti-abuse controls, reward terms, consented analytics, and refund/chargeback hold periods. The current virality page is a playbook, not an automated referral system.
- [ ] **Operations:** production HTTPS/domain, secrets manager, database/object-storage backups and restore tests, uptime/latency/error monitoring, alerting, structured redacted logs, retention jobs, and disaster recovery.
- [ ] **Commercial validation:** pilot with contractors, measure qualified leads, conversion, support cost, AI/telephony/video costs, and willingness to pay. Confirm the proposed $199/$399/$699 plans and $149 add-on only after this validation.

## Account/owner actions
- [ ] Create/configure OpenAI, Stripe, Twilio, and Meta accounts as desired; complete any app review/permissions.
- [ ] Configure provider credentials in the hosting secret manager, not in the code or browser.
- [ ] Supply a domain and HTTPS host, database, private media storage, and a backup destination.
- [ ] Approve customer terms, privacy/retention rules, voice disclosure, support policy, and billing terms with qualified advisors.
- [ ] Run live end-to-end tests and approve launch only after logs and error handling are reviewed.

**Current recommendation:** use this build for local evaluation and a tightly controlled, non-sensitive pilot only. Do not market the measurement add-on as automatic or sell production call-answering guarantees until the respective features pass real-world validation.
