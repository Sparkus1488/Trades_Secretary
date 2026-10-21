# Trades Secretary integration setup — Release 0.3.0

This release adds owner login, per-organization file-backed workspaces, private local media uploads, export/delete controls, OpenAI marketing drafts and a basic spoken receptionist loop, Stripe Checkout plus signed webhook processing, Twilio signature-validated calls/voicemail, and optional Facebook Page text publishing. Provider integrations remain disabled until real accounts, permissions, and environment values are configured.

## Start locally

1. Copy `.env.example` to `.env` and set local-only values.
2. Run `npm test` and then `npm start`.
3. Visit `http://localhost:4242`, create a workspace, and use a unique password of at least 12 characters.
4. Use the Settings page to export workspace data or permanently delete the workspace.

The current runtime persists each workspace in `data/tenants/`, uploaded media in a private directory beneath the tenant folder, and authentication metadata in `data/auth.json`. Media uploads are limited to 50 MB per file and 500 MB per workspace. This is suitable for local evaluation and a single-instance pilot only. `DATABASE_URL` does **not** switch the runtime to PostgreSQL; `db/schema.sql` remains a proposed migration schema. Do not deploy this JSON-backed runtime as a multi-instance production SaaS.

## OpenAI marketing drafts

Set `OPENAI_API_KEY` and optionally `OPENAI_MODEL`. The app calls the Responses API to generate one draft from contractor-supplied facts. The generated text is never automatically published by this endpoint. A human must verify project claims and client permission.

## Stripe billing

1. Create recurring monthly Products/Prices in Stripe test mode for Solo, Pro, Growth, and the separate Measure & Bid add-on.
2. Set `STRIPE_SECRET_KEY`, `STRIPE_PRICE_SOLO`, `STRIPE_PRICE_PRO`, `STRIPE_PRICE_GROWTH`, and optionally `STRIPE_PRICE_MEASURE_BID`.
3. Set `Trades Secretary_BASE_URL` to the canonical HTTPS application URL in production.
4. Configure the Stripe webhook endpoint `POST /api/billing/webhook` with the matching `STRIPE_WEBHOOK_SECRET`. Subscribe to `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, and `customer.subscription.deleted`.
5. Configure the Stripe customer portal in Stripe Dashboard before using Manage Billing.
6. Test successful checkout, failed payments, cancellation, upgrade/downgrade, and webhook retries before taking live payments.

The application rejects duplicate checkout sessions when it already knows an active/trialing subscription exists. Paid plan and add-on access are updated only by signed subscription events with organization metadata. A checkout-completed event alone does not enable paid features. Tax configuration, invoice emails, customer terms, refunds, disputes, and failed-payment dunning still need business decisions and end-to-end testing.

## Twilio incoming-call prototype

Set `TWILIO_AUTH_TOKEN`, `TWILIO_INCOMING_WEBHOOK_URL`, and `TWILIO_VOICE_TURN_WEBHOOK_URL` to the exact public HTTPS URLs configured in Twilio. Set `OPENAI_API_KEY` to enable conversational turns. Configure `TWILIO_ORGANIZATION_ID` for a single-workspace pilot, or `TWILIO_NUMBER_ORG_MAP` as a JSON object mapping each Twilio `To` number to its organization ID. Optional: set `TWILIO_RECORDING_CALLBACK_URL` for voicemail fallback, `Trades Secretary_HUMAN_HANDOFF_NUMBER` for handoff, and `TWILIO_HANDOFF_WEBHOOK_URL` for the signed handoff result callback. `TWILIO_ACCOUNT_SID` and `TWILIO_PHONE_NUMBER` alone do not activate the receptionist.

With OpenAI and the voice-turn URL configured, the app provides a basic spoken AI receptionist using Twilio speech transcription and TwiML text-to-speech. It keeps a bounded conversation transcript in the tenant workspace and uses a fallback response if the AI service fails. This is an early prototype: it does not yet reliably extract structured lead fields, schedule appointments, perform CRM actions, provide guaranteed human transfer, or meet a production latency/reliability target. Test every call path, consent/disclosure, transfer fallback, and after-hours scenario before using with customers. Do not promise production-grade call answering until live tests pass.

## Facebook Page text publishing

Set `META_PAGE_ID`, `META_PAGE_ACCESS_TOKEN`, and `META_GRAPH_API_VERSION` only in the deployment secret manager. Configure a Page access token with the necessary Meta permissions and approvals. The LocalReach workflow only attempts a text-only Facebook Page post when the user explicitly marks a draft `Approved` and clicks **Publish to Facebook**. No Instagram publishing, media upload, OAuth onboarding, or automatic scheduling is included. Check Meta's current API version, permissions, and platform policies before enabling it.

## Measure & Bid AI and media

Videos and images can be uploaded to private local pilot storage. Measurements are entered by the contractor and saved as a review record; the basic calculator derives floor area, perimeter, gross wall area, and a configurable floor-area waste allowance from those entered dimensions. No automated vision measurement, calibrated dimension inference, room segmentation, takeoff engine, image enhancement, private object storage, or accuracy certification is implemented. Keep human review and site verification mandatory. To complete this feature, select a video-processing/vision provider, implement consented upload and retention controls, validate supported devices and calibration methods, and run accuracy tests across representative jobsite conditions.

## Data, privacy, and security

- Use HTTPS for production. Set `NODE_ENV=production` only behind a correctly configured HTTPS reverse proxy; secure cookies are enabled in production mode.
- If behind a trusted proxy, set `TRUST_PROXY=1` only when the proxy strips untrusted incoming forwarding headers.
- Never commit provider credentials or put them in browser JavaScript.
- Authentication uses Node's `scrypt` password hashing and opaque random session tokens stored as hashes. Session lifetime is seven days. There is no password-reset email, MFA, invitation/team-management workflow, or external identity provider yet.
- The JSON file store does not provide encrypted-at-rest storage, robust transactional guarantees, managed backups, multi-instance consistency, or production monitoring. Use a production database adapter before launch.
- Workspace JSON export is provided, but media binaries are excluded from the export. Account deletion is available to the workspace owner and requires the current password. Publish a real privacy policy and retention schedule before collecting customer call recordings, project videos, or personal data.
- Do not use demo data as real leads. Cost references are user-entered and unverified. Verify all cost sources, dates, quantities, local taxes, permits, labor rates, and bid assumptions.

## Suggested production architecture

- Runtime: Node.js 22+ behind managed HTTPS and a reverse proxy.
- Database: PostgreSQL with migrations and organization-scoped authorization in every query.
- Object storage: private S3-compatible storage with short-lived signed upload/download URLs and lifecycle retention.
- Billing: Stripe Checkout + Customer Portal + verified, idempotent subscription webhooks.
- Calls: Twilio plus a selected low-latency voice AI service; include disclosure, escalation, and human handoff.
- Media/measurement: a selected vision/video pipeline, with reference calibration, uncertainty reporting, and field verification.
- Social: official Meta APIs with approved app permissions and explicit publishing consent.
- Operations: centralized logs, alerts, automated backups/restore tests, rate limits, dependency scanning, security review, and a documented incident process.


## Supplier pricing, contractor rates, and travel estimates (Release 0.4.0)

### Supplier data policy
- The Cost Intelligence page now offers material searches with links to Lowe's, The Home Depot, Menards, Ace Hardware, and a local-map search using the ZIP/postal code entered for the job. These links are not a claim of live inventory or guaranteed delivery. The contractor must verify the exact SKU, unit, local store, Pro/account pricing, quantity discounts, freight, taxes, stock, and delivery date.
- Direct live supplier pricing is only attempted for Lowe's when all three server environment variables `LOWES_CLIENT_ID`, `LOWES_ACCESS_TOKEN`, and `LOWES_API_BASE_URL` are set with approved partner access. Lowe's access is partner-gated; see https://developer.lowes.com/portal/solutions/product-discovery/ and https://developer.lowes.com/portal/contact/. Configure credentials in the host's secret manager, not in browser code.
- Menards has a developer portal that states production access requires prior authorization: https://developer.apim.menards.com/. Do not assume an account or API entitlement exists.
- No general consumer product scraping is performed for The Home Depot or Ace Hardware. Request authorized data access or use their public product pages and supplier quotes. Supplier prices and catalog data may have terms-of-use or redistribution restrictions.
- Contractor-entered price references are stored per workspace, including source, source date, ZIP, and delivery status. They are labeled unverified until the contractor validates them.

### Contractor pricing profile
Business Settings supports construction trade/industry selection, cost per man-hour, labor burden percentage, materials markup, home/office origin, vehicle cost per mile, and default round trips. Estimate drafts use total man-hours multiplied by the saved rate and labor burden; materials markup applies to material cost only. Other bid costs are separate. Verify whether a rate should represent cost, billable rate, or a loaded cost before relying on it.

### Travel evaluator
Travel estimates are saved as itemized records separate from bid totals. Items include vehicle cost allowance, travel-time labor, tolls, parking, meals/per diem, lodging, and other costs. If `GOOGLE_MAPS_API_KEY` is configured for the Google Routes API, the app attempts a driving-route distance and duration lookup; otherwise the contractor-entered miles and hours are used. Restrict the key, enable the Routes API and billing, and verify the returned route. Travel estimates are internal planning values and do not automatically become customer charges or bid line items.

### Customer/project records
Project records now include project name, customer name, jobsite address, trade, dimensions, and walkthrough reference. Use consistent project names and customer addresses to connect follow-up travel estimates. Address and customer information is workspace data and should be handled according to your privacy policy.
