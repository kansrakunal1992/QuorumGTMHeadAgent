// lib/positioning.ts
// ── Shared positioning directive + founder-preference feed ──────────────
//
// Founder instruction (stated directly, this is not GTM Head's own
// judgment): the six-persona/Council/"AI advisor" framing is now a
// crowded, undifferentiated space (multi-AI-advisor "board" apps are
// common). Quorum's real differentiation is the engineering underneath —
// decision ontology scoring, bias parameter tagging, rule/context recall,
// and Mirror's cross-session pattern surfacing. Every content/outreach/
// nurture prompt should lead with THAT, not the personas.
//
// The facts below were read directly out of the quorum_clean codebase
// (components/ and supabase/*.sql), not invented — same discipline as the
// rest of this project's proof points. Use them as available vocabulary;
// never state a number or mechanic that isn't here.

import 'server-only'
import { createServiceClient } from './supabase'

export const POSITIONING_DIRECTIVE = `POSITIONING RULE (founder instruction — follow this over any older habit):
Do NOT lead with, or foreground, the "six AI personas" / "Council" / "AI
advisors" framing. That space is now crowded (multi-AI-advisor "board of
advisors" apps are common) and it undersells what actually makes Quorum
different. Lead instead with the underlying engineering — pick ONE of
these real mechanics per draft, don't list them all every time:

- DECISION ONTOLOGY: every decision gets scored across 14 structural
  dimensions (e.g. reversibility, time horizon, stakes magnitude, value
  conflict, regret asymmetry, emotional intensity) — 1-5 score + confidence
  + rationale per dimension. This is what decides whether the decision is
  even ready to bring to advisors, or gets redirected/gated first.
- RULE ENGINE: the ontology feeds a rule engine that can REDIRECT (send the
  user back to clarify something first), GATE (block until a condition is
  met), or OPEN (proceed) — the system can tell someone their decision
  isn't well-formed yet, before wasting their time on advice.
- RULE RECALL: before you even finish answering this time, Quorum can
  surface a rule or pattern it recalled from YOUR OWN past decisions —
  structural memory, not generic advice.
- BIAS FINGERPRINT: every session gets tagged for bias signals
  (distorting / neutral / adaptive), building a personal bias fingerprint
  over many decisions — not a one-off "here's a cognitive bias" tip.
- MIRROR INSIGHT: one synthesized observation per visit, derived from
  patterns across multiple modules at once — an observation no single
  piece of the system could produce alone.
- CALIBRATION TRACKING: tracks pre-decision confidence vs. retrospective
  confidence over time, so a person can see whether they're actually
  over- or under-confident as a pattern, not just this one time.
- DECISION GRAPH: an actual visual map/network of a person's own decision
  history, showing how decisions connect.

The personas still exist technically and can be mentioned in passing, but
never as the hook or the headline claim. The hook is the engineering.`

/**
 * Founder feedback on rejected/dismissed content or outreach (from the
 * dashboard buttons) — was being written to gtm_memory but nothing
 * actually read it back before this. Now every content/outreach/nurture
 * draft call includes it.
 */
export async function getFounderPreferences(): Promise<string[]> {
  const supabase = createServiceClient()
  const { data } = await supabase
    .from('gtm_memory')
    .select('content')
    .eq('category', 'founder_preference')
    .eq('status', 'active')
    .order('last_validated_at', { ascending: false })
    .limit(10)
  return (data ?? []).map((r) => r.content)
}
