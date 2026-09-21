# Quorum GTM Head

An autonomous GTM operator for Quorum — diagnoses the current funnel
bottleneck, sources and qualifies real leads across India/US/Europe/UAE,
plans a day's actions within hard caps, executes what it safely can, and
queues everything else as ready-to-paste content or a ready-to-send Founder
Action.

This is a **separate, standalone Railway project** from the main Quorum app.
It reuses the **same Supabase project** (read-only access to the app's real
tables for analytics, full read/write on its own `gtm_*` tables) — it does
not get its own database.

## 1. What's in this build

**Working end-to-end:**
- **Analytics Agent** — reads real signups/sessions/payments from the main
  app, diagnoses the funnel bottleneck. Never invents a number.
- **Daily Planning Agent** — scores candidate actions against the bottleneck
  and the objective hierarchy (paying users > activation > traffic >
  awareness). Never defaults to "post more" just because it's easy.
- **Lead sourcing pipeline** (Prospecting Agent) — discover → qualify →
  enrich, across India, US, Europe, and UAE:
  1. **Discover** — Apollo People Search, per region, small page sizes to
     conserve free credits.
  2. **Qualify** — DeepSeek scores each candidate against your real ICP
     evidence; only the best survive (`GTM_LIMIT_PROSPECTS_QUALIFIED_PER_DAY`,
     default 20/day across all regions combined).
  3. **Enrich** — Hunter email-finder, called ONLY for qualified survivors
     — never the full discovery batch. This is what makes the free tiers
     of both tools last.
  4. **Persist** — into `gtm_prospects`, with a fit score, provenance, and
     a hard dedupe (never re-discovers/re-contacts the same person).
  - Vendors are behind a `ProspectSearchProvider` / `EmailFinderProvider`
    interface (`lib/providers/`) — swapping in Cognism/PDL/Clay later is a
    new file, not a rewrite.
- **ICP Agent** — self-generates/refines ICP hypotheses and search terms
  (job titles/keywords for Apollo), grounded in real positioning facts
  seeded from quorumvault.org (`scripts/seed-memory.ts`).
- **Content Agent** — drafts broadcast content (LinkedIn post, Instagram
  post, WhatsApp Status) tied to the bottleneck, using only verified proof
  points from `gtm_memory` — never a fabricated testimonial or stat.
- **Outreach Agent** — drafts targeted 1:1 messages (LinkedIn DM, WhatsApp
  message, Email) for real prospects only, channel chosen by what contact
  info is actually on file (email preferred as the safest, most
  jurisdiction-neutral first touch — see compliance note below). **Email is
  actually sent, not just drafted**, when `GTM_EMAIL_AUTONOMOUS=true` — see
  §2b below for setup and the safety tradeoffs.
- **Experiment Agent** — proposes experiments, refuses to call a result
  "successful"/"failed" on too small a sample.
- **Learning/Memory Agent** — persists structured learnings + founder
  feedback from the dashboard buttons.
- **Product Agent** — separately flags product/pricing/UX recommendations
  (rare, on purpose — never manufactures one just to have one).
- **Founder Dashboard** with clearly separate sections (see §4) + a
  timestamped activity log.
- Atomic daily-limit enforcement, safe under concurrent execution.

**Deliberately gated off (shown as explicit "skipped: reason", not hidden):**
- **LinkedIn autonomous actions** — no compliant official API exists for
  personal-profile DMs/posts/comments, so LinkedIn always produces a
  Founder Action. This project does not scrape or browser-automate LinkedIn.
- **WhatsApp / Instagram autonomous sends** — only activate once
  `WHATSAPP_BUSINESS_TOKEN` / `INSTAGRAM_GRAPH_TOKEN` are real official
  Business API tokens (send calls aren't wired yet even once you have the
  token — falls back to a Founder Action honestly). Until then, drafts
  route to the dashboard queues.
- **Autonomous ad spend** — `GTM_DAILY_SPEND_CAP_INR` defaults to 0.

## 2. Lead sourcing: cost and setup

**Correction confirmed against a real account (Sept 2026):** Apollo's Free
plan does NOT include the People Search API — it's excluded outright, even
with a master key, not a scoping issue. This build works two ways
depending on your plan:

| Provider | Free plan | What actually works free |
|---|---|---|
| Apollo API search | ❌ Paid-plan-only (Basic, $49/mo+) | — |
| Apollo web UI search | ✅ Included (~900–1,200 credits/year) | Manual search → CSV → dashboard import |
| Hunter email-finder | ✅ 50 credits/month, permanent, real API | Automatic enrichment of qualified prospects |

**Free-tier workflow (what you're on now):**
1. Search in Apollo's web UI as normal (filters: title, location, etc).
2. Export or copy the results as CSV.
3. Dashboard → **🗂️ Import prospects** → paste the CSV → Import.
4. From there everything is automatic again: Hunter fills in missing
   emails, the Outreach Agent drafts messages, results feed the learning
   loop — same as if the pipeline had found them itself.

**If/when you upgrade Apollo to a paid plan:** no code changes needed —
`lib/providers/apolloProvider.ts` already calls the real search endpoint;
it 403s today because of the plan, not the code. The daily cycle's
"prospecting" step picks discovery back up automatically once it stops
403-ing.

Setup:
1. **Apollo** → Settings → Integrations → API Keys → Create a new key
   (leave "Set as master key" on or off, doesn't matter on Free — the
   search endpoints are locked either way). Put the key in `APOLLO_API_KEY`
   now anyway, so it's ready the moment you upgrade.
2. **Hunter** → hunter.io → API → API Key → put it in `HUNTER_API_KEY`.
3. Set `PROSPECT_REGIONS` (default `IN,US,EU,AE`) and
   `GTM_LIMIT_PROSPECTS_QUALIFIED_PER_DAY` (default `20`, split evenly
   across your regions) — these apply once automated search is active.

**Geographic honesty:** Apollo's database skews US-strong; European
coverage exists but is thinner on phone numbers, and UAE-specific depth is
unverified. At $0 budget this is the practical tradeoff — a
properly-built-for-Europe provider (Cognism) runs $15–25K/year.

**Compliance note (not legal advice):** cold outreach to individuals in the
EU (GDPR) and UAE (PDPL) carries real consent/legitimate-interest
obligations that don't apply the same way in the US or India. This build
defaults new-prospect outreach to **email** when available (most
jurisdiction-neutral B2B first touch, easiest opt-out) rather than
WhatsApp/phone, and every message is Founder-reviewed before sending
regardless of region (Level C). Worth a real legal check before scaling

volume in any one region.

## 2b. Automated email sending (Resend)

Uses your existing Resend account — no new service. Setup:

1. **Fastest path (zero new setup):** set `GTM_EMAIL_FROM` to an address on
   whatever domain your main app already sends from (it's already verified
   in Resend, since that's how magic-link emails work today).
2. **Better long-term (recommended, ~10 min):** in Resend → Domains → Add
   Domain, verify a subdomain like `hello.quorumvault.org` (adds a couple
   of DNS records wherever quorumvault.org's DNS is managed). This isolates
   cold-outreach bounce/spam-complaint rates from the domain your real
   users' login emails depend on — worth doing before volume gets real,
   not required to start.
3. **Set `GTM_EMAIL_REPLY_TO` to a real inbox you actually check.** This
   matters: `GTM_EMAIL_FROM` (e.g. `auth@quorumvault.org`) is very likely a
   send-only address with no monitored inbox behind it — a common pattern
   for transactional senders. Without a reply-to, a reply may go nowhere.
   Point it at your own email and replies land where you'll see them,
   independent of whatever `GTM_EMAIL_FROM` is.
4. Set `GTM_EMAIL_AUTONOMOUS=true` in Railway. Leave `GTM_EMAIL_FOOTER`
   unset for a plain opt-out line, or set your own (consider adding a
   physical postal address if you'll be sending real volume — a CAN-SPAM
   requirement in the US).

**Every email now carries exactly one CTA, so it's measurable —** the
Outreach Agent no longer has the option to send a bare "just asking"
message. It always includes the free or paid session link, tagged with
`utm_source=gtm_head&utm_medium=<channel>&utm_campaign=cold_outreach&pid=<prospect_id>`
so a booking can (in principle) be traced back to the specific email that
drove it. **Honest caveat:** whether that actually shows up as a number on
this dashboard depends on whether `/kunal` and `/kunal_elite` bookings
capture UTM params anywhere I can read from Supabase — I don't know how
that booking flow is implemented on the main app's side. If it writes to a
table, tell me which one and I'll wire the Analytics Agent to report
real per-email conversion; if it's an external calendar tool (Calendly,
etc.) with no webhook into Supabase, that's a separate integration.

**What actually happens once this is on:** the Outreach Agent drafts the
email as before, then sends it via Resend's API scheduled a few hours out
to a rough regional business-hour slot (`lib/sendTiming.ts` — approximate,
not timezone-precise) rather than firing the instant the cron runs, so a
day's sends don't land in one obvious burst. It no longer sits in "Send
today" waiting for you — it shows up in the activity log as `done` once
sent, with the Resend schedule time in the result. LinkedIn/WhatsApp/
Instagram are unaffected — those still land in the dashboard queue exactly
as before, since there's no compliant way to automate them yet.

**If a specific person asks to stop hearing from you:** there's no inbound-
reply automation yet (that would need an inbox-parsing integration, not
built — though Resend does support this natively via inbound webhooks if
you want it built next: a dedicated receiving subdomain + a webhook route,
surfaced as a "Replies" section on this dashboard), so for now this is
manual — in Supabase, run
`update gtm_prospects set status = 'blocked' where email = '...'` and
they'll never be re-selected for outreach again.

## 2c. The full attribution loop (this pass)

Every tracked link now uses `utm_content = <prospect id>` (not a separate
`pid` param — the website only reads `utm_source`/`utm_campaign`/`utm_content`,
confirmed by reading its code directly). Three sources get checked every
cycle by the new Attribution Agent, all filtered to `utm_source = 'gtm_head'`:

| Source | Where | What it proves |
|---|---|---|
| `card_visit_log` (website, new) | logged on every `/kunal` and `/kunal_elite` page load | They clicked through |
| `decision_session_payments` (main app, **already existed**) | already captured utm on the ₹299 flow before this project touched anything | They paid |
| `user_profiles.signup_utm_*` (main app, new) | first-touch only, never overwritten by a later login | They signed up for the free tier |

Matches get written back onto the `gtm_prospects` row (`card_visited_at`,
`paid_at`, `paid_amount_inr`, `signed_up_at`) and summarized in the
dashboard's **🎯 Attribution** section — lifetime-to-date, not just today.

**Known gap, now partially closed (§A):** `/kunal_elite` bookings happen
entirely inside an embedded Google Calendar widget — there is no
equivalent to `decision_session_payments` for the free session. With the
Google Calendar setup below, bookings there ARE now readable — matched by
**email address**, not utm params (that widget has no param passthrough).
`card_visit_log` remains the fallback signal for anyone who clicked
through but hasn't (or hasn't yet) actually booked.

**📊 Performance Log** (dashboard section) — since LinkedIn/Instagram/
WhatsApp Status have no connected API tokens, impressions/engagement/link
clicks are typed in by hand against each posted item. A **weekly digest**
(Mondays, piggybacked on the daily cron — no second cron job needed) reads
7 days of this data and writes ONE real learning back into memory if the
data actually supports a pattern — stays quiet otherwise rather than
forcing a conclusion from 3 data points.

### A. Google Calendar setup (free session attribution)

Uses a service account — one-time setup, no repeated OAuth consent flow.

1. [console.cloud.google.com](https://console.cloud.google.com) → create/pick a project → **APIs & Services → Library** → enable **Google Calendar API**.
2. **IAM & Admin → Service Accounts → Create Service Account** → any name → Create and Continue → Done.
3. Click into it → **Keys** tab → **Add Key → Create new key → JSON** → downloads automatically.
4. **calendar.google.com** → find the calendar behind the `/kunal_elite` Appointment Schedule → **⋮ → Settings and sharing** → under "Share with specific people" → add the service account's email (from the JSON's `client_email`) with **"See all event details"**.
5. Same page, under "Integrate calendar" → copy the **Calendar ID**.
6. Railway → set `GOOGLE_SERVICE_ACCOUNT_EMAIL` (the JSON's `client_email`), `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` (the JSON's `private_key`, pasted whole — headers, footers, and `\n`s exactly as downloaded), and `GOOGLE_CALENDAR_ID_KUNAL_ELITE`.

All three unset (or the calendar not shared yet) → this is a documented no-op, not a crash — everything else keeps working.

### B. Existing-user nurture agent (top pick #1) — now built

Deliberately narrow, to guarantee zero overlap with your main app's five
existing nudge crons:

- **Audience:** users with **exactly 1 or 2** completed sessions, no active
  `mirror_access`. 0-session users are `daily-nudge`'s territory; ≥3-session
  users are `mirror-insight-email`'s territory — this is the one segment
  neither touches.
- **Frequency:** one-time, ever, per user (`gtm_nurture_log` is the
  permanent idempotency guard) — not a recurring decaying sequence.
- **Safety:** before sending, reads (never writes) your main app's shared
  `notification_log` to confirm no other nudge went out to that person in
  the last 3 days.
- **Message:** a short, personal, founder-voice direct ask — deliberately
  different in kind from `mirror-insight-email`'s value-teaser — using the
  same free/paid CTA logic and Resend infra already built for cold outreach.
- **Volume:** capped by `GTM_LIMIT_NURTURE_EMAILS` (default 5/day).
- **Attribution:** a nurture-driven ₹299 payment is tracked too (tagged
  `utm_source=gtm_head_nurture`, recorded against `gtm_nurture_log` since
  `decision_session_payments` has no user_id to join a prospect-style
  record on).

Runs automatically every cycle once `GTM_EMAIL_AUTONOMOUS=true` is set —
no separate flag needed, same master switch as cold outreach.

### D. Clean links + footer fix

Two small but real production issues, fixed:

- **Footer spacing bug** — `resendProvider.ts` was concatenating your
  `GTM_EMAIL_FOOTER` straight onto the message with zero separator when a
  custom value was set (the blank-line default was only baked into the
  *unset* case). Now always exactly one blank line before the footer,
  regardless of what's in that variable.
- **Raw tracking URLs removed from what recipients see.** Every
  outreach/nurture link used to look like
  `quorumvault.org/kunal_elite?utm_source=gtm_head&utm_campaign=cold_outreach_email`
  — a dead giveaway of automation before the recipient even clicks. Now
  every link is created as a row in a new `gtm_short_links` table and sent
  as `quorumvault.org/go/aB3xK9` instead — clean, on your own trusted
  domain, still fully tracked underneath (the website's new `GET /go/:code`
  route resolves it server-side and 302-redirects, logging the click into
  `card_visit_log` along the way — more reliable than the client-side
  script too, since it fires even if the recipient's email client blocks
  scripts).

**This needs one more website deploy:** `website-patch-v2.zip` (this pass)
adds the `/go/:code` route to `server.js` and one new migration
(`add_gtm_short_links.sql`). Nothing else in the website changes.

### C. Closing the learning loop (so it doesn't need rework later)

Attribution data used to just sit there. Now, weekly (same Monday run as
the content digest), a new **ICP Learning Agent** turns it into two things
that actually change future behavior:

- **Who gets targeted:** every prospect is now tagged with the ICP
  hypothesis that drove its search (`gtm_prospects.icp_hypothesis_id`,
  previously always null — fixed). Once a hypothesis has ≥10 contacted
  prospects, its real conversion rate vs. the overall baseline adjusts that
  hypothesis's `confidence`/`status` directly — which `icpAgent.ts` was
  already reading, so search terms shift toward what's actually converting
  without any other code needing to change.
- **How it's worded:** every outreach/nurture send now records which CTA
  it used (`cta_type_used`). Once each side (free vs paid) has ≥10 sends,
  the real conversion rate gets written to memory as a `messaging`
  learning — which `outreachAgent.ts`, `nurtureAgent.ts`, and
  `contentAgent.ts` (a genuine bug fix — it wasn't reading this category at
  all before) now all read before drafting, and are told explicitly to
  weight real data over the hardcoded default rule when they conflict.

Cold outreach and nurture are scored **separately** — a stranger and an
existing user are different enough audiences that combining them would
hide the real signal. Below the sample-size threshold, this agent writes
nothing — same "don't manufacture a pattern from 3 data points" rule as
everywhere else in this project. The threshold (10) is a judgment call for
early-stage volume — raise `MIN_SAMPLE` in `icpLearningAgent.ts` once lead
volume is consistently higher.

## 3. Deploy

**This pass touches three codebases, not just this one.** Deploy in this
order — each is additive-only, but the GTM Head assumes the other two are
in place for real attribution to work:

1. **Main app (`quorum-clean-patch-vN.zip`)** — copy the revised/new files
   over your app's codebase (`lib/storage.ts`, `components/AuthPanel.tsx`,
   `app/api/auth/route.ts`, `app/auth/callback/page.tsx`, the new
   `app/api/auth/link-utm/route.ts`), run `add_signup_utm_to_user_profiles.sql`
   in Supabase, deploy. This alone gets you first-touch signup attribution
   for ANY marketing source (not just this project — Meta ads, organic
   content, anything with a `utm_source`).
2. **Website (`website-patch-vN.zip`)** — copy over `server.js`,
   `card-kunal.html`, `card-kunal-elite.html`, run `add_card_visit_log.sql`
   in Supabase (same project), deploy. Adds visit-level logging to both
   founder-card pages, fully separate from the existing visit-counter (that
   one is untouched).
3. **This project** — run `gtm_schema.sql` again (adds attribution columns
   to `gtm_prospects` and the new `gtm_content_performance` table), redeploy.

**Full first-time GTM Head setup** (skip to step 4 below if you've already deployed this project before):

1. Push this folder to a new GitHub repo (e.g. `quorum-gtm-head`).
2. Railway → New Project → **Deploy from GitHub repo** → select it.
3. Railway → your new service → **Variables** → paste in everything from
   `.env.example` with real values. `SUPABASE_URL` and
   `SUPABASE_SERVICE_ROLE_KEY` are the **same values** as the main Quorum
   app's own Railway variables — copy them across, don't create a new
   Supabase project.
4. Supabase Dashboard (same project as the main app) → SQL Editor → paste
   and run `supabase/gtm_schema.sql`. Additive only — it does not touch any
   existing table, safe to re-run.
5. Once deployed, run the one-time seed locally (or via Railway's shell):
   `SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npm run seed:memory`
6. Railway → your service → **Settings → Cron Schedule** (or a separate
   Railway Cron service hitting the same repo) →
   `0 2 * * *` (2:00 AM UTC = 7:30 AM IST) →
   `curl -s -X POST https://<your-domain>/api/cron/daily-cycle -H "Authorization: Bearer $CRON_SECRET"`
7. Open `https://<your-domain>/`, enter your `ADMIN_CODE` → dashboard.

You can trigger a cycle manually any time with that same curl command
while testing.

## 4. The dashboard

Sections, kept deliberately separate because they're different kinds of work:

- **📤 Post today** — broadcast content, grouped by channel: LinkedIn post,
  Instagram post, WhatsApp Status. Copy button for exact text, then Mark
  posted / Skip / Reject.
- **💬 Send today** — targeted 1:1 outreach to a specific real prospect,
  grouped by channel: LinkedIn DM, WhatsApp message, Email. Shows who, why
  them, why this message, recommended timing. Copy button, then Mark sent /
  Reject / Not relevant / Snooze.
- **🛠️ Product recommendations** — the one place the agent surfaces a
  PRODUCT opinion (pricing/onboarding/UX/positioning/feature) rather than a
  marketing action — things it can't execute itself, only flag. Stays empty
  most days on purpose; it's told not to manufacture a recommendation just
  to have one. Mark actioned / Dismiss.
- **What the agent did** — full activity log/audit trail for the day, each
  row timestamped (your browser's local time) so you can see roughly when
  each action ran, not just that it ran.

Every Reject / Not relevant / Dismiss tap feeds the Learning Agent, which
writes a `founder_preference` row to `gtm_memory` — the agent's future
qualification and content decisions are meant to shift based on this over
time.

## 5. How the agent knows what users actually did

The Analytics Agent (`lib/agents/analyticsAgent.ts`) reads the main app's
real Supabase tables every cycle — not a guess, not cached, live each run:
- `auth.users` → signups in the trailing 24h
- `sessions` → decisions started (first_decision), and users with more than
  one session (second_decision / repeat usage)
- `decision_session_payments` + `mirror_access` → paid conversions
- `mirror_access` (unexpired, elite/private tier) → active paying users

That snapshot is what `diagnoseBottleneck()` reasons over to pick
traffic/activation/second_decision/conversion/retention as today's
priority — it's real product usage, not an assumption.

## 6. Architecture

```
app/
  page.tsx                             Founder Dashboard (admin-code gated)
  api/cron/daily-cycle/route.ts        Runs the full daily loop
  api/dashboard/route.ts               Dashboard data
  api/founder-actions/[id]/route.ts    Mark sent/rejected/etc -> feeds learning
  api/content-queue/[id]/route.ts      Mark posted/rejected/skipped
  api/prospects/import/route.ts        Paste-CSV import (Apollo Free-plan workaround)
  api/product-recommendations/[id]/route.ts  Mark actioned/dismissed
  api/content-performance/route.ts     GET posted items + latest stats, POST to log stats
lib/
  supabase.ts       Service client — same Supabase project as the main app
  ai-client.ts      LLM abstraction (default: DeepSeek V4 Pro)
  config.ts         All caps/autonomy mode/regions, from Railway env vars
  limits.ts         Atomic daily-cap enforcement
  types.ts          Shared types
  adminAuth.ts       Bearer ADMIN_CODE / CRON_SECRET checks
  providers/
    types.ts               ProspectSearchProvider / EmailFinderProvider interfaces
    apolloProvider.ts       Apollo People Search (discovery only)
    hunterProvider.ts       Hunter email finder (enrichment, qualified-only)
    resendProvider.ts       Actually sends outreach email via Resend
    googleCalendarProvider.ts  Reads /kunal_elite bookings (service-account JWT)
  sendTiming.ts       Approximate regional business-hour scheduling helper
  shortLink.ts        Creates quorumvault.org/go/xxxxx links (clean, hides tracking)
  agents/
    gtmHead.ts              Orchestrator — the daily loop
    analyticsAgent.ts       Reads the main app's real funnel data
    dailyPlanningAgent.ts   Scores candidate actions
    icpAgent.ts             Self-generates ICP hypotheses + search terms
    contentAgent.ts         Drafts broadcast content
    researchAgent.ts        Competitor/community research (needs TAVILY_API_KEY)
    experimentAgent.ts      Proposes/evaluates experiments
    prospectingAgent.ts     Discover -> qualify -> enrich pipeline
    outreachAgent.ts        Drafts targeted outreach, routes to Founder Action
    learningAgent.ts        Only agent that writes to gtm_memory
    productAgent.ts         Surfaces product/pricing/UX recommendations (rare, on purpose)
    attributionAgent.ts     Closes the loop: card visits, paid sessions, signups traced to outreach
    digestAgent.ts          Weekly synthesis of manually-logged content performance
    nurtureAgent.ts         Top pick #1 — one-time email for 1-2 session, no-Mirror existing users
    icpLearningAgent.ts     Turns real conversions into updated ICP confidence + CTA guidance (weekly)
supabase/
  gtm_schema.sql    New tables — run once in the existing Supabase project
scripts/
  seed-memory.ts    One-time bootstrap with real quorumvault.org facts
```

## 7. Next passes worth prioritizing (not built yet)

1. Splitting `runDailyCycle()` into separate morning/midday/evening cron
   hits (each phase is already its own function — config change, not a
   rewrite) for the full spec's intraday adaptation behavior.
2. Activity detail pages, an experiment tracking view, and a channel
   controls UI (currently Railway variables only).
3. A real WhatsApp Business / Instagram Graph API integration once you have
   official access, to move those channels from Level C to Level B within
   caps.
4. Revisit Apollo/Hunter volume once the free allowances are the binding
   constraint — upgrade the specific bottleneck rather than pre-buying
   headroom you don't need yet.
