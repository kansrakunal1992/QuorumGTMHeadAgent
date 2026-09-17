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
  jurisdiction-neutral first touch — see compliance note below).
- **Experiment Agent** — proposes experiments, refuses to call a result
  "successful"/"failed" on too small a sample.
- **Learning/Memory Agent** — persists structured learnings + founder
  feedback from the dashboard buttons.
- **Founder Dashboard** with two clearly separate queues (see §4) + full
  activity log.
- Atomic daily-limit enforcement, safe under concurrent execution.

**Deliberately gated off (shown as explicit "skipped: reason", not hidden):**
- **LinkedIn autonomous actions** — no compliant official API exists for
  personal-profile DMs/posts/comments, so LinkedIn always produces a
  Founder Action. This project does not scrape or browser-automate LinkedIn.
- **WhatsApp / Instagram autonomous sends** — only activate once
  `WHATSAPP_BUSINESS_TOKEN` / `INSTAGRAM_GRAPH_TOKEN` are real official
  Business API tokens. Until then, drafts route to the dashboard queues.
- **Email autonomous sends** — off by default even with `RESEND_API_KEY`
  set, to protect the main app's transactional email deliverability. Flip
  `GTM_EMAIL_AUTONOMOUS=true` once you have a separate sending domain.
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

## 3. Deploy

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
