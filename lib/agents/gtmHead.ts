// lib/agents/gtmHead.ts
// ── GTM Head — orchestrating agent ─────────────────────────────────────
// Runs the full daily cycle. Kept as a single pass for this MVP (real spec
// suggests splitting ingest/plan/execute/report across separate cron times
// during the day — trivial to split later: each phase below is already an
// independent function you can hit from separate Railway cron schedules).

import 'server-only'
import { createServiceClient } from '../supabase'
import { getFunnelSnapshot, diagnoseBottleneck } from './analyticsAgent'
import { scoreCandidateActions } from './dailyPlanningAgent'
import { research } from './researchAgent'
import { generateIcpHypotheses, persistIcpHypotheses } from './icpAgent'
import { draftContent } from './contentAgent'
import { proposeExperiment, createExperiment } from './experimentAgent'
import { runProspectingPipeline } from './prospectingAgent'
import { queueOutreach } from './outreachAgent'
import { tryConsume, getRemaining } from '../limits'
import { getAutonomyMode } from '../config'
import type { ActivityLogEntry, ActionType, Channel, AutonomyLevel } from '../types'

async function logActivity(entry: Omit<ActivityLogEntry, 'id' | 'timestamp'>) {
  const supabase = createServiceClient()
  await supabase.from('gtm_activity_log').insert(entry)
}

const LEVEL_A: AutonomyLevel = 'A_FULLY_AUTONOMOUS'
const LEVEL_C: AutonomyLevel = 'C_FOUNDER_ACTION_REQUIRED'

export interface DailyCycleResult {
  date: string
  bottleneck: string
  actions_done: number
  actions_skipped: number
  founder_actions_queued: number
}

export async function runDailyCycle(): Promise<DailyCycleResult> {
  const supabase = createServiceClient()
  const today = new Date().toISOString().slice(0, 10)
  const mode = getAutonomyMode()

  // ── 1. Ingest + diagnose ────────────────────────────────────────────
  const snapshot = await getFunnelSnapshot()
  const { bottleneck, reasoning } = diagnoseBottleneck(snapshot)

  await logActivity({
    action_type: 'funnel_diagnosis' as ActionType,
    channel: 'internal' as Channel,
    autonomy_level: LEVEL_A,
    target: null,
    reason: reasoning,
    hypothesis: null,
    content: JSON.stringify(snapshot),
    status: 'done',
    result: bottleneck,
    metric: null,
    cost: 0,
    confidence: snapshot.signups > 20 ? 0.7 : 0.3,
    follow_up: null,
    experiment_id: null,
  })

  let actionsDone = 0
  let actionsSkipped = 0
  let founderActionsQueued = 0

  // research_only mode: diagnose + plan only, execute nothing further.
  if (mode === 'research_only') {
    await supabase.from('gtm_daily_plans').upsert(
      {
        date: today,
        objective: 'Diagnose only (autonomy = research_only)',
        bottleneck,
        candidate_actions: [],
        chosen_actions: [],
        reasoning_summary: reasoning,
      },
      { onConflict: 'date' }
    )
    return { date: today, bottleneck, actions_done: 0, actions_skipped: 0, founder_actions_queued: 0 }
  }

  // ── 2. Plan ──────────────────────────────────────────────────────────
  const candidates = await scoreCandidateActions(bottleneck)
  const chosen = mode === 'conservative' ? candidates.slice(0, 2) : candidates

  await supabase.from('gtm_daily_plans').upsert(
    {
      date: today,
      objective: `Address bottleneck: ${bottleneck}`,
      bottleneck,
      candidate_actions: candidates,
      chosen_actions: chosen,
      reasoning_summary: reasoning,
    },
    { onConflict: 'date' }
  )

  // ── 3. Execute within caps ───────────────────────────────────────────
  for (const action of chosen) {
    try {
      switch (action.action_type) {
        case 'research': {
          const check = await tryConsume('competitor_research')
          if (!check.allowed) {
            actionsSkipped++
            await logActivity({
              action_type: 'research', channel: 'internal', autonomy_level: LEVEL_A,
              target: null, reason: 'Daily competitor_research cap reached', hypothesis: null,
              content: action.action, status: 'skipped', result: null, metric: null, cost: 0,
              confidence: null, follow_up: null, experiment_id: null,
            })
            continue
          }
          const finding = await research(action.action, action.action)
          actionsDone++
          await logActivity({
            action_type: 'research', channel: 'internal', autonomy_level: LEVEL_A,
            target: finding.topic, reason: action.reasoning, hypothesis: null,
            content: finding.summary, status: 'done', result: finding.summary,
            metric: null, cost: 0, confidence: finding.confidence, follow_up: null, experiment_id: null,
          })
          break
        }
        case 'icp': {
          const hypotheses = await generateIcpHypotheses()
          const count = await persistIcpHypotheses(hypotheses)
          actionsDone++
          await logActivity({
            action_type: 'icp_update', channel: 'internal', autonomy_level: LEVEL_A,
            target: null, reason: action.reasoning, hypothesis: null,
            content: `Generated ${count} ICP hypothesis update(s)`, status: 'done',
            result: `${count} hypotheses`, metric: null, cost: 0, confidence: 0.5,
            follow_up: null, experiment_id: null,
          })
          break
        }
        case 'content': {
          const drafts = await draftContent(bottleneck)
          for (const draft of drafts) {
            const capKey =
              draft.channel === 'linkedin_post' ? 'linkedin_posts' :
              draft.channel === 'instagram_post' ? 'instagram_posts' : 'whatsapp_status'
            const check = await tryConsume(capKey)
            if (!check.allowed) {
              actionsSkipped++
              await logActivity({
                action_type: 'content_draft', channel: 'internal', autonomy_level: LEVEL_C,
                target: draft.channel, reason: `Daily ${capKey} cap reached`, hypothesis: null,
                content: null, status: 'skipped', result: null, metric: null, cost: 0,
                confidence: null, follow_up: null, experiment_id: null,
              })
              continue
            }
            await supabase.from('gtm_content_queue').insert({
              channel: draft.channel,
              category: draft.category,
              hook: draft.hook,
              body: draft.body,
              cta: draft.cta,
              uses_proof_point: draft.uses_proof_point,
              source_evidence: draft.source_evidence,
              bottleneck,
            })
            founderActionsQueued++
            actionsDone++
            await logActivity({
              action_type: 'content_draft', channel: 'internal', autonomy_level: LEVEL_C,
              target: draft.channel, reason: action.reasoning, hypothesis: null,
              content: draft.hook, status: 'queued_for_founder', result: null, metric: null, cost: 0,
              confidence: draft.uses_proof_point ? 0.6 : 0.4, follow_up: 'Founder to post', experiment_id: null,
            })
          }
          break
        }
        case 'experiment': {
          const check = await tryConsume('experiments')
          if (!check.allowed) { actionsSkipped++; continue }
          const proposal = await proposeExperiment(bottleneck)
          const id = await createExperiment(proposal)
          actionsDone++
          await logActivity({
            action_type: 'experiment_analysis', channel: 'internal', autonomy_level: LEVEL_A,
            target: null, reason: action.reasoning, hypothesis: proposal.hypothesis ?? null,
            content: proposal.name ?? null, status: 'done', result: 'proposed', metric: proposal.metric ?? null,
            cost: 0, confidence: 0.4, follow_up: 'Founder review before running', experiment_id: id,
          })
          break
        }
        case 'prospecting': {
          const { remaining } = await getRemaining('prospects_qualified')
          if (remaining <= 0) {
            actionsSkipped++
            await logActivity({
              action_type: 'prospect_discovery', channel: 'internal', autonomy_level: LEVEL_A,
              target: null, reason: 'Daily prospects_qualified cap reached', hypothesis: null,
              content: null, status: 'skipped', result: null, metric: null, cost: 0,
              confidence: null, follow_up: null, experiment_id: null,
            })
            break
          }
          const result = await runProspectingPipeline(remaining)
          await tryConsume('prospects_researched', result.discovered) // may push researched over — that cap is soft/informational here
          if (result.inserted > 0) actionsDone++
          else actionsSkipped++
          await logActivity({
            action_type: 'prospect_discovery', channel: 'internal', autonomy_level: LEVEL_A,
            target: result.regions_run.join(', ') || null,
            reason: result.skippedReason ?? action.reasoning,
            hypothesis: null,
            content: `Discovered ${result.discovered}, qualified ${result.qualified}, enriched ${result.enriched_with_email}, inserted ${result.inserted}`,
            status: result.inserted > 0 ? 'done' : 'skipped',
            result: `${result.inserted} new prospects`, metric: null, cost: 0,
            confidence: result.inserted > 0 ? 0.5 : null, follow_up: null, experiment_id: null,
          })
          break
        }
        case 'outreach': {
          const check = await tryConsume('outreach_messages')
          if (!check.allowed) {
            actionsSkipped++
            await logActivity({
              action_type: 'outreach_draft', channel: 'internal', autonomy_level: LEVEL_C,
              target: null, reason: 'Daily outreach_messages cap reached', hypothesis: null,
              content: null, status: 'skipped', result: null, metric: null, cost: 0,
              confidence: null, follow_up: null, experiment_id: null,
            })
            break
          }

          const { data: candidates } = await supabase
            .from('gtm_prospects')
            .select('*')
            .eq('status', 'new')
            .order('fit_score', { ascending: false })
            .limit(1)

          const prospect = candidates?.[0]
          if (!prospect) {
            actionsSkipped++
            await logActivity({
              action_type: 'outreach_draft', channel: 'internal', autonomy_level: LEVEL_C,
              target: null, reason: 'No un-contacted prospect on file yet', hypothesis: null,
              content: null, status: 'skipped', result: null, metric: null, cost: 0,
              confidence: null, follow_up: 'Run prospecting first', experiment_id: null,
            })
            break
          }

          // Prefer email (safest, most jurisdiction-neutral for cold first
          // touch) > LinkedIn > WhatsApp, based on what's actually on file.
          const channel: Channel = prospect.email ? 'email' : prospect.linkedin_url ? 'linkedin' : prospect.whatsapp ? 'whatsapp' : 'email'
          if (channel === 'email' && !prospect.email) {
            actionsSkipped++
            break
          }

          const queued = await queueOutreach(prospect, channel as 'linkedin' | 'whatsapp' | 'email' | 'instagram')
          if (queued) {
            await supabase.from('gtm_prospects').update({ status: 'queued', last_contacted_at: new Date().toISOString() }).eq('id', prospect.id)
            founderActionsQueued++
            actionsDone++
            await logActivity({
              action_type: 'outreach_draft', channel, autonomy_level: LEVEL_C,
              target: prospect.name, reason: action.reasoning, hypothesis: null,
              content: null, status: 'queued_for_founder', result: null, metric: null, cost: 0,
              confidence: prospect.fit_score, follow_up: 'Founder to send', experiment_id: null,
            })
          } else {
            actionsSkipped++
          }
          break
        }
      }
    } catch (err) {
      actionsSkipped++
      await logActivity({
        action_type: 'research', channel: 'internal', autonomy_level: LEVEL_A,
        target: null, reason: `Error executing action: ${(err as Error).message}`, hypothesis: null,
        content: action.action, status: 'failed', result: null, metric: null, cost: 0,
        confidence: null, follow_up: null, experiment_id: null,
      })
    }
  }

  // ── 4. End-of-day report ─────────────────────────────────────────────
  const report = {
    objective: `Address bottleneck: ${bottleneck}`,
    result: snapshot,
    funnel: snapshot,
    what_gtm_head_did: chosen,
    actions_done: actionsDone,
    actions_skipped: actionsSkipped,
    founder_actions_queued: founderActionsQueued,
    tomorrow_priority: bottleneck,
    confidence: snapshot.signups > 20 ? 0.6 : 0.25,
  }
  await supabase.from('gtm_daily_reports').upsert({ date: today, report_json: report }, { onConflict: 'date' })

  return {
    date: today,
    bottleneck,
    actions_done: actionsDone,
    actions_skipped: actionsSkipped,
    founder_actions_queued: founderActionsQueued,
  }
}
