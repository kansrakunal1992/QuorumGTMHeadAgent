// lib/types.ts
// Shared types for the Quorum GTM Head agent.

export type AutonomyMode = 'full' | 'conservative' | 'research_only'

export type AutonomyLevel = 'A_FULLY_AUTONOMOUS' | 'B_AUTONOMOUS_CAPPED' | 'C_FOUNDER_ACTION_REQUIRED'

export type Channel =
  | 'linkedin'
  | 'whatsapp'
  | 'email'
  | 'instagram'
  | 'internal' // research, analytics, memory, planning — no external channel

export type ActionType =
  | 'research'
  | 'icp_update'
  | 'content_draft'
  | 'prospect_discovery'
  | 'outreach_draft'
  | 'experiment_analysis'
  | 'funnel_diagnosis'
  | 'daily_plan'
  | 'end_of_day_report'
  | 'memory_update'
  | 'product_recommendation'
  | 'attribution'

export type ActivityStatus = 'done' | 'failed' | 'skipped' | 'queued_for_founder'

export interface FunnelSnapshot {
  date: string // YYYY-MM-DD
  signups: number
  first_decision: number
  second_decision: number
  paid_conversions: number // decision_session_payments (paid) + new mirror_access rows
  active_paying_users: number // current count of unexpired elite/founding rows
}

export type FunnelBottleneck = 'traffic' | 'activation' | 'second_decision' | 'conversion' | 'retention'

export interface ICPHypothesis {
  id: string
  description: string
  pain: string
  trigger: string
  likely_decision_types: string[]
  value_proposition: string
  channels: string[]
  confidence: number // 0-1
  evidence: string[]
  objections: string[]
  status: 'testing' | 'promising' | 'weak' | 'rejected'
  source: 'site' | 'agent_generated' | 'founder_stated'
  created_at: string
  updated_at: string
}

export interface Prospect {
  id: string
  name: string
  company: string | null
  role: string | null
  geography: string | null
  email: string | null
  phone: string | null
  linkedin_url: string | null
  linkedin_handle: string | null
  instagram_handle: string | null
  whatsapp: string | null
  source: string
  icp_hypothesis_id: string | null
  fit_score: number | null
  trigger: string | null
  pain_signal: string | null
  status: 'new' | 'queued' | 'contacted' | 'replied' | 'no_response' | 'not_relevant' | 'blocked'
  last_contacted_at: string | null
  next_action: string | null
  response: string | null
  objection: string | null
  notes: string | null
  provenance: string
  confidence: number
  created_at: string
}

export interface Experiment {
  id: string
  name: string
  hypothesis: string
  problem: string
  audience: string
  channel: Channel
  variant: string
  action: string
  metric: string
  baseline: number | null
  target: number | null
  result: number | null
  confidence: number | null
  conclusion: string | null
  status: 'proposed' | 'running' | 'successful' | 'inconclusive' | 'failed' | 'retired' | 'scaled'
  created_at: string
  updated_at: string
}

export interface GtmMemoryItem {
  id: string
  category:
    | 'product'
    | 'positioning'
    | 'icp'
    | 'customer'
    | 'objection'
    | 'channel'
    | 'messaging'
    | 'experiment'
    | 'competitor'
    | 'founder_preference'
    | 'operational_rule'
    | 'learning'
  content: string
  source: string
  confidence: number
  evidence: string[]
  status: 'active' | 'superseded' | 'rejected'
  created_at: string
  last_validated_at: string
}

export interface ActivityLogEntry {
  id: string
  timestamp: string
  action_type: ActionType
  channel: Channel
  autonomy_level: AutonomyLevel
  target: string | null
  reason: string
  hypothesis: string | null
  content: string | null
  status: ActivityStatus
  result: string | null
  metric: string | null
  cost: number
  confidence: number | null
  follow_up: string | null
  experiment_id: string | null
}

export type FounderActionChannel = Channel
export type FounderActionState =
  | 'pending'
  | 'sent'
  | 'rejected'
  | 'snoozed'
  | 'edited'
  | 'wrong_target'
  | 'not_relevant'
  | 'blocked_type'
  | 'done'

export interface FounderAction {
  id: string
  created_at: string
  channel: FounderActionChannel
  target_name: string
  target_destination: string // phone / URL / email / handle
  exact_message: string
  subject: string | null // email only
  why_this_person: string
  why_this_message: string
  recommended_timing: string
  expected_objective: string
  state: FounderActionState
  prospect_id: string | null
  experiment_id: string | null
}

export interface DailyPlan {
  id: string
  date: string
  objective: string
  bottleneck: FunnelBottleneck
  candidate_actions: string[]
  chosen_actions: string[]
  reasoning_summary: string
  created_at: string
}

export interface DailyLimits {
  total_actions: number
  prospects_researched: number
  prospects_qualified: number
  outreach_messages: number
  follow_ups: number
  linkedin_comments: number
  linkedin_posts: number
  instagram_posts: number
  whatsapp_outreach: number
  whatsapp_status: number
  email_outreach: number
  experiments: number
  competitor_research: number
}

// ── Lead sourcing ──────────────────────────────────────────────────────
export type ProspectRegion = 'IN' | 'US' | 'EU' | 'AE'

// Broadcast content — goes to gtm_content_queue (not a specific person),
// distinct from FounderAction (targeted 1:1 outreach to a specific prospect).
export type ContentChannel = 'linkedin_post' | 'instagram_post' | 'whatsapp_status'
export type ContentState = 'pending' | 'posted' | 'rejected' | 'skipped'

export interface ContentQueueItem {
  id: string
  created_at: string
  date: string
  channel: ContentChannel
  category: string
  hook: string | null
  body: string
  cta: string | null
  uses_proof_point: boolean
  source_evidence: string | null
  state: ContentState
  bottleneck: string | null
}

// ── Product recommendations ──────────────────────────────────────────────
// Distinct from a GTM action: something the GTM Head believes the PRODUCT
// itself (pricing, onboarding, UX, positioning, a feature) should change —
// nothing the agent can execute itself, surfaced for the founder to decide.
export type ProductRecCategory = 'pricing' | 'onboarding' | 'ux' | 'positioning' | 'feature' | 'other'
export type ProductRecState = 'pending' | 'actioned' | 'dismissed'

export interface ProductRecommendation {
  id: string
  created_at: string
  date: string
  category: ProductRecCategory
  recommendation: string
  rationale: string
  evidence: string[]
  confidence: number
  state: ProductRecState
}

// ── Content performance (manual log) ─────────────────────────────────────
export interface ContentPerformance {
  id: string
  content_id: string
  as_of_date: string
  impressions: number | null
  engagement: number | null
  link_clicks: number | null
  notes: string | null
  created_at: string
}

// ── Attribution summary (Attribution Agent's daily output) ──────────────
export interface AttributionSummary {
  card_visits: number       // new card_visit_log rows with utm_source='gtm_head' since last run
  paid_conversions: number  // decision_session_payments status='paid', utm_source='gtm_head', matched to a prospect
  paid_amount_inr: number
  signups: number           // user_profiles rows with signup_utm_source='gtm_head', matched to a prospect
}
