'use client'

import { useEffect, useState, useCallback } from 'react'

interface DashboardData {
  date: string
  autonomy_mode: string
  daily_limits: Record<string, number>
  usage: { action_key: string; used_count: number }[]
  plan: { objective: string; bottleneck: string; reasoning_summary: string } | null
  report: { report_json: Record<string, unknown> } | null
  activity: Array<{
    id: string; timestamp: string; action_type: string; status: string
    reason: string; content: string | null; result: string | null; target: string | null
  }>
  founder_actions_pending: Array<{
    id: string; channel: 'linkedin' | 'whatsapp' | 'email' | 'instagram'; target_name: string; target_destination: string
    exact_message: string; why_this_person: string; why_this_message: string
    recommended_timing: string; expected_objective: string
  }>
  content_queue_pending: Array<{
    id: string; channel: 'linkedin_post' | 'instagram_post' | 'whatsapp_status'; category: string
    hook: string | null; body: string; cta: string | null
    uses_proof_point: boolean; source_evidence: string | null
  }>
}

const FOUNDER_ACTION_LABELS: Record<string, string> = {
  linkedin: 'LinkedIn DM',
  whatsapp: 'WhatsApp message',
  email: 'Email',
  instagram: 'Instagram DM',
}

const CONTENT_LABELS: Record<string, string> = {
  linkedin_post: 'LinkedIn post',
  instagram_post: 'Instagram post',
  whatsapp_status: 'WhatsApp Status',
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      className="secondary"
      onClick={() => {
        navigator.clipboard.writeText(text)
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      }}
    >
      {copied ? 'Copied!' : 'Copy'}
    </button>
  )
}

function groupBy<T, K extends string>(items: T[], key: (t: T) => K): Record<string, T[]> {
  return items.reduce((acc, item) => {
    const k = key(item)
    acc[k] = acc[k] ?? []
    acc[k].push(item)
    return acc
  }, {} as Record<string, T[]>)
}

export default function DashboardPage() {
  const [adminCode, setAdminCode] = useState('')
  const [entered, setEntered] = useState(false)
  const [data, setData] = useState<DashboardData | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (code: string) => {
    setError(null)
    const res = await fetch('/api/dashboard', { headers: { Authorization: `Bearer ${code}` } })
    if (!res.ok) { setError('Unauthorized or server error.'); return }
    setData(await res.json())
  }, [])

  useEffect(() => { if (entered) load(adminCode) }, [entered, adminCode, load])

  const actFounder = async (id: string, state: string) => {
    await fetch(`/api/founder-actions/${id}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${adminCode}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ state }),
    })
    load(adminCode)
  }

  const actContent = async (id: string, state: string) => {
    await fetch(`/api/content-queue/${id}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${adminCode}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ state }),
    })
    load(adminCode)
  }

  if (!entered) {
    return (
      <div className="container">
        <h1>Quorum GTM Head</h1>
        <p className="muted">Enter the admin code (ADMIN_CODE Railway variable) to view the dashboard.</p>
        <div className="card">
          <input
            type="password"
            placeholder="Admin code"
            value={adminCode}
            onChange={(e) => setAdminCode(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && setEntered(true)}
          />
          <div style={{ marginTop: 12 }}>
            <button onClick={() => setEntered(true)}>Enter</button>
          </div>
        </div>
      </div>
    )
  }

  if (error) return <div className="container"><p style={{ color: 'var(--bad)' }}>{error}</p></div>
  if (!data) return <div className="container"><p className="muted">Loading…</p></div>

  const contentByChannel = groupBy(data.content_queue_pending, (c) => c.channel)
  const founderByChannel = groupBy(data.founder_actions_pending, (f) => f.channel)

  return (
    <div className="container">
      <h1>Quorum GTM Head</h1>
      <p className="muted">{data.date} · Autonomy: {data.autonomy_mode}</p>

      <h2>Today</h2>
      <div className="card grid">
        <div><div className="stat-label">Bottleneck</div><div className="stat-value">{data.plan?.bottleneck ?? '—'}</div></div>
        <div><div className="stat-label">Actions logged</div><div className="stat-value">{data.activity.length}</div></div>
        <div><div className="stat-label">To post</div><div className="stat-value">{data.content_queue_pending.length}</div></div>
        <div><div className="stat-label">To send</div><div className="stat-value">{data.founder_actions_pending.length}</div></div>
      </div>
      {data.plan && <p className="muted card">{data.plan.reasoning_summary}</p>}

      {/* Broadcast content: LinkedIn post / Instagram post / WhatsApp Status */}
      <h2>📤 Post today</h2>
      {data.content_queue_pending.length === 0 && <p className="muted">Nothing to post right now.</p>}
      {(['linkedin_post', 'instagram_post', 'whatsapp_status'] as const).map((channel) =>
        (contentByChannel[channel] ?? []).map((item) => (
          <div className="card" key={item.id}>
            <strong>{CONTENT_LABELS[channel]}</strong>{' '}
            <span className="muted">· {item.category.replace(/_/g, ' ')}</span>
            <p style={{ whiteSpace: 'pre-wrap', marginTop: 8 }}>
              {item.hook && <strong>{item.hook}{'\n\n'}</strong>}
              {item.body}
              {item.cta && `\n\n${item.cta}`}
            </p>
            <p className="muted">
              {item.uses_proof_point ? `Uses verified proof point: ${item.source_evidence}` : 'No proof point used — doesn\u2019t require one.'}
            </p>
            <div>
              <CopyButton text={[item.hook, item.body, item.cta].filter(Boolean).join('\n\n')} />
              <button onClick={() => actContent(item.id, 'posted')}>Mark posted</button>
              <button className="secondary" onClick={() => actContent(item.id, 'skipped')}>Skip</button>
              <button className="secondary" onClick={() => actContent(item.id, 'rejected')}>Reject</button>
            </div>
          </div>
        ))
      )}

      {/* Targeted 1:1 outreach: LinkedIn DM / WhatsApp message / Email */}
      <h2>💬 Send today</h2>
      {data.founder_actions_pending.length === 0 && <p className="muted">Nothing queued right now.</p>}
      {(['linkedin', 'whatsapp', 'email', 'instagram'] as const).map((channel) =>
        (founderByChannel[channel] ?? []).map((fa) => (
          <div className="card" key={fa.id}>
            <strong>{FOUNDER_ACTION_LABELS[channel]}</strong> → {fa.target_name}{' '}
            <span className="muted">({fa.target_destination})</span>
            <p style={{ whiteSpace: 'pre-wrap' }}>{fa.exact_message}</p>
            <p className="muted">Why: {fa.why_this_person}</p>
            <p className="muted">Timing: {fa.recommended_timing} · Goal: {fa.expected_objective}</p>
            <div>
              <CopyButton text={fa.exact_message} />
              <button onClick={() => actFounder(fa.id, 'sent')}>Mark sent</button>
              <button className="secondary" onClick={() => actFounder(fa.id, 'rejected')}>Reject</button>
              <button className="secondary" onClick={() => actFounder(fa.id, 'not_relevant')}>Not relevant</button>
              <button className="secondary" onClick={() => actFounder(fa.id, 'snoozed')}>Snooze</button>
            </div>
          </div>
        ))
      )}

      <h2>What the agent did</h2>
      <div className="card">
        {data.activity.length === 0 && <p className="muted">No activity logged yet today.</p>}
        {data.activity.map((a) => (
          <div className="activity-row" key={a.id}>
            <span className={`pill ${a.status}`}>{a.status}</span>{' '}
            <strong>{a.action_type}</strong>
            {a.target && <span className="muted"> · {a.target}</span>}
            <p className="muted" style={{ margin: '4px 0 0' }}>{a.reason}</p>
          </div>
        ))}
      </div>
    </div>
  )
}
