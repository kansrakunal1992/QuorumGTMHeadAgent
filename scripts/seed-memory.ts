// scripts/seed-memory.ts
// Run once after deploy: `npm run seed:memory` (needs SUPABASE_URL /
// SUPABASE_SERVICE_ROLE_KEY set in the environment you run it from).
//
// Bootstraps gtm_memory with facts actually pulled from the live
// quorumvault.org site on 2026-09-15 — not invented. This exists so the ICP
// and Content agents have real ground truth on day one instead of starting
// from a blank slate and having to hallucinate positioning. Re-running is
// safe — it only inserts rows that don't already exist by content match.

import { createClient } from '@supabase/supabase-js'

const url = process.env.SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) {
  console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in the environment.')
  process.exit(1)
}
const supabase = createClient(url, key)

const SEED_SOURCE = 'quorumvault.org (fetched 2026-09-15)'
const CODE_SOURCE = 'quorum_clean codebase, components/ + supabase/*.sql (read 2026-09-20)'

const seeds: Array<{ category: string; content: string; confidence: number; source?: string; evidence?: string[] }> = [
  {
    category: 'positioning',
    content:
      'Core positioning: "See what you\'re actually deciding." Quorum reads a decision structurally before ' +
      'any advisor responds, then challenges it — Decision → Examination → Challenge → Updated decision → ' +
      'Action → Learning. Explicitly differentiated from "General AI: Question → Answer." Site FAQ states ' +
      'outright: "Is Quorum just a chatbot? No."',
    confidence: 1,
  },
  {
    category: 'icp',
    content:
      'Stated ICP: "Founders, CXOs, and family office principals — people making decisions where being ' +
      'wrong is expensive." Decision fit: exit/liquidity decisions, capital allocation & investment, ' +
      'succession/ownership structure, key-people decisions (co-founder, leadership hire, separation).',
    confidence: 1,
  },
  {
    category: 'icp',
    content:
      'Explicit anti-ICP / not-a-fit: operational and tactical minutiae (vendor choice, feature names — ' +
      'reversible in hours); decisions with a clear right answer the person already knows; pure information ' +
      'deficits ("I don\'t know enough about X" is a research problem, not a decision problem).',
    confidence: 1,
  },
  {
    category: 'product',
    content:
      'Product structure: Free tier = Examiner + Structural Read + six-persona Council (Contrarian, Risk ' +
      'Architect, Pattern Analyst, Stakeholder Mirror, Elder, Competitor) + Challenge + Synthesis + Next ' +
      'Move. Elite adds Mirror (Judgment OS): bias fingerprint, contradiction detector, decision independence ' +
      'score, confidence calibration — compounds across a person\'s decision history. Private is self-hosted ' +
      '(Qwen or Mistral) enterprise deployment.',
    confidence: 1,
  },
  {
    category: 'positioning',
    content:
      'Pricing (as of 2026-09-15): Free — ₹0, always. Elite — ₹2,999/mo or ₹29,999/yr (2 months free annual). ' +
      'Private — from ₹9,999/user/mo, custom-scoped to org size, enterprise sales motion via a "Talk to us" ' +
      'request form, not self-serve.',
    confidence: 1,
  },
  {
    category: 'competitor',
    content:
      'Site runs a public comparison experiment: gave Gemini and Quorum the same five consequential decisions. ' +
      'Framing: they often agreed on the first answer; the differentiator was what happened when the ' +
      'recommendation was challenged. Published at quorumvault.org/insights/what-ai-misses-in-hard-decisions.',
    confidence: 0.9,
  },
  {
    category: 'customer',
    content:
      'Published anonymized decision record (consulting firm founder, Delhi NCR): considered across-the-board ' +
      'salary raises for a scaling phase; Quorum\'s Examiner flagged an unresolved question (seasonal vs ' +
      'structural demand) and the decision was held. Six weeks later they implemented variable compensation ' +
      'tied to performance instead of a fixed raise. Confidence score moved 6 → 8. Bias flagged: FOMO.',
    confidence: 0.9,
  },
  {
    category: 'customer',
    content:
      'Published anonymized decision record (senior professional, 25-year corporate career considering exit ' +
      'to coaching/wellness work): the decision to leave wasn\'t in question, but whether income could be ' +
      'replaced was. Advisors named a 40-75% income-replacement threshold and two time-boxed tests (60/90 ' +
      'days) before revisiting. Outcome still pending as of the site snapshot.',
    confidence: 0.9,
  },
  {
    category: 'operational_rule',
    content:
      'Marketing site (quorumvault.org) currently reports no analytics/marketing cookies or third-party ' +
      'tracking in use ("Analytics: Not in use", "Marketing: Not in use" in its cookie preferences). Any ' +
      'traffic-source attribution for this domain therefore has to come from UTM params on outbound links, ' +
      'not from a site-side analytics tool, unless/until one is added.',
    confidence: 0.9,
  },
  {
    category: 'channel',
    content:
      'Two distinct founder-led CTAs exist: (1) a FREE 30-minute live session at https://quorumvault.org/kunal_elite ' +
      '("Book My Free Decision Session", no payment) and (2) a paid ₹299 one-time Decision Session at ' +
      'https://quorumvault.org/kunal (no login required), both entered directly from the marketing site. These ' +
      'are real, working conversion points (not hypothetical). The free session is the lower-friction, better ' +
      'default CTA for cold first-touch outreach to strangers; the paid session suits warmer/re-engaged ' +
      'prospects, or as a natural next step after a good free call — better than asking someone to sign up ' +
      'for the free product tier cold.',
    confidence: 1,
  },

  // ── Real engineering differentiators, read directly from the codebase — ──
  // ── grounds the repositioning away from "six AI personas" (2026-09-20) ──
  {
    category: 'product',
    content:
      'Decision Ontology: every decision is scored across 14 structural dimensions (reversibility, time_horizon, ' +
      'stakes_magnitude, outcome_uncertainty, value_conflict, identity_alignment, regret_asymmetry, ' +
      'upstream_dependency, ambiguity, task_complexity, decision_discriminating_info, time_pressure, ' +
      'decision_unit, emotional_intensity), each with a 1-5 score, a confidence value, and a plain-English ' +
      'rationale. A rule engine reads this vector and can REDIRECT (send the user to clarify something first), ' +
      'GATE (block until a condition is met), or OPEN (proceed to advisors) — the system can tell someone their ' +
      'decision is not well-formed yet, before any advice happens. Shown to the user as a "Decision X-Ray" ' +
      '(OntologyRevealCard) on their first few sessions.',
    confidence: 1,
    source: CODE_SOURCE,
    evidence: ['supabase/sprint11a_14dim_ontology.sql', 'components/OntologyRevealCard.tsx'],
  },
  {
    category: 'product',
    content:
      'Rule Recall: before a returning user even finishes answering this time, Quorum can surface a rule or ' +
      'pattern it recalled from their OWN past decisions (RuleRecallBanner), timed to appear before they submit ' +
      'their answers so they can factor it in — structural memory of the person\'s own history, not generic advice.',
    confidence: 1,
    source: CODE_SOURCE,
    evidence: ['components/RuleRecallBanner.tsx'],
  },
  {
    category: 'product',
    content:
      'Bias Fingerprint (Mirror module): every session is tagged for a bias signal (distorting / neutral / ' +
      'adaptive), building a personal bias fingerprint across many decisions over time — plain-English bias ' +
      'feedback is also shown from session 1, no subscription required (BiasNoteCard), closing the gap before ' +
      'someone would otherwise have to wait for a Mirror unlock to see any bias insight at all.',
    confidence: 1,
    source: CODE_SOURCE,
    evidence: ['components/BiasFingerprint.tsx', 'components/BiasNoteCard.tsx', 'lib/bias-scorer.ts'],
  },
  {
    category: 'product',
    content:
      'Mirror Insight: one synthesized observation per visit, derived deterministically from patterns across ' +
      'multiple product modules at once — explicitly "an observation no single module can surface on its own." ' +
      'Requires at least 5 sessions of history; returns nothing before that rather than a weak guess.',
    confidence: 1,
    source: CODE_SOURCE,
    evidence: ['components/MirrorInsightCard.tsx'],
  },
  {
    category: 'product',
    content:
      'Calibration Sparkline (Mirror module): tracks a person\'s pre-decision confidence vs. their retrospective ' +
      'confidence over time, showing whether they are systematically over- or under-confident as a pattern — ' +
      'not a one-off score. Also: a Decision Graph (force-directed, components/DecisionGraph.tsx) renders an ' +
      'actual visual network of a person\'s own decision history.',
    confidence: 1,
    source: CODE_SOURCE,
    evidence: ['components/CalibrationSparkline.tsx', 'components/DecisionGraph.tsx'],
  },
  {
    category: 'founder_preference',
    content:
      'Founder instruction (2026-09-20): do not lead GTM messaging with the "six AI personas" / "Council" / ' +
      '"AI advisors" framing — that space is now crowded (comparable multi-AI-advisor "board" apps exist). Lead ' +
      'instead with the underlying engineering: decision ontology scoring, bias parameter tagging, rule/context ' +
      'recall, and Mirror\'s cross-session pattern surfacing (bias fingerprint, calibration tracking, decision ' +
      'graph). The personas still exist technically and can be mentioned in passing, never as the headline.',
    confidence: 1,
    source: 'founder, stated in chat (2026-09-20)',
    evidence: [],
  },
]

async function main() {
  let inserted = 0
  for (const seed of seeds) {
    const { data: existing } = await supabase
      .from('gtm_memory')
      .select('id')
      .eq('content', seed.content)
      .maybeSingle()
    if (existing) continue

    const { error } = await supabase.from('gtm_memory').insert({
      category: seed.category,
      content: seed.content,
      source: seed.source ?? SEED_SOURCE,
      confidence: seed.confidence,
      evidence: seed.evidence ?? ['https://quorumvault.org'],
    })
    if (error) {
      console.error('Failed to insert seed:', seed.content.slice(0, 60), error.message)
    } else {
      inserted++
    }
  }
  console.log(`Seeded ${inserted} new gtm_memory row(s) (${seeds.length - inserted} already present).`)
}

main()
