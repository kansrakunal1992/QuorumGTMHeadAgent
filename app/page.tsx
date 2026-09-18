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
    exact_message: string; subject: string | null; why_this_person: string; why_this_message: string
    recommended_timing: string; expected_objective: string
  }>
  content_queue_pending: Array<{
    id: string; channel: 'linkedin_post' | 'instagram_post' | 'whatsapp_status'; category: string
    hook: string | null; body: string; cta: string | null
    uses_proof_point: boolean; source_evidence: string | null
  }>
  product_recommendations_pending: Array<{
    id: string; category: string; recommendation: string; rationale: string; confidence: number
  }>
  attribution: {
    total_contacted: number; visited: number; signed_up: number; paid: number; paid_amount_inr: number
  }
}

interface PerfItem {
  id: string; channel: string; category: string; hook: string | null; body: string; created_at: string
  latest_performance: { impressions: number | null; engagement: number | null; link_clicks: number | null; as_of_date: string } | null
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

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    })
  } catch {
    return iso
  }
}

export default function DashboardPage() {
  const [adminCode, setAdminCode] = useState('')
  const [entered, setEntered] = useState(false)
  const [data, setData] = useState<DashboardData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [perf, setPerf] = useState<PerfItem[]>([])
  const [perfDrafts, setPerfDrafts] = useState<Record<string, { impressions: string; engagement: string; link_clicks: string }>>({})

  const load = useCallback(async (code: string) => {
    setError(null)
    const res = await fetch('/api/dashboard', { headers: { Authorization: `Bearer ${code}` } })
    if (!res.ok) { setError('Unauthorized or server error.'); return }
    setData(await res.json())
    const perfRes = await fetch('/api/content-performance', { headers: { Authorization: `Bearer ${code}` } })
    if (perfRes.ok) setPerf((await perfRes.json()).items)
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

  const actRec = async (id: string, state: string) => {
    await fetch(`/api/product-recommendations/${id}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${adminCode}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ state }),
    })
    load(adminCode)
  }

  const [importCsv, setImportCsv] = useState('')
  const [importResult, setImportResult] = useState<string | null>(null)

  const runImport = async () => {
    setImportResult('Importing…')
    const res = await fetch('/api/prospects/import', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminCode}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ csv: importCsv }),
    })
    if (!res.ok) { setImportResult('Import failed — check the admin code and try again.'); return }
    const data = await res.json()
    setImportResult(`Parsed ${data.parsed}, added ${data.inserted}, skipped ${data.skipped} (dupes/blank).`)
    setImportCsv('')
  }

  const savePerf = async (contentId: string) => {
    const draft = perfDrafts[contentId] || { impressions: '', engagement: '', link_clicks: '' }
    await fetch('/api/content-performance', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminCode}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content_id: contentId,
        impressions: draft.impressions ? Number(draft.impressions) : null,
        engagement: draft.engagement ? Number(draft.engagement) : null,
        link_clicks: draft.link_clicks ? Number(draft.link_clicks) : null,
      }),
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
        <div><div className="stat-label">Product recs</div><div className="stat-value">{data.product_recommendations_pending.length}</div></div>
      </div>
      {data.plan && <p className="muted card">{data.plan.reasoning_summary}</p>}

      {/* Real outcomes, not fit-scores — lifetime-to-date, not just today.
          /kunal_elite (free session) has no equivalent to "paid" — a
          booking there only exists in Kunal's Google Calendar, invisible
          here until a Calendar API integration exists. */}
      <h2>🎯 Attribution (lifetime)</h2>
      <div className="card grid">
        <div><div className="stat-label">Contacted</div><div className="stat-value">{data.attribution.total_contacted}</div></div>
        <div><div className="stat-label">Visited a card</div><div className="stat-value">{data.attribution.visited}</div></div>
        <div><div className="stat-label">Signed up (free)</div><div className="stat-value">{data.attribution.signed_up}</div></div>
        <div><div className="stat-label">Paid</div><div className="stat-value">{data.attribution.paid}</div></div>
        <div><div className="stat-label">Revenue</div><div className="stat-value">₹{data.attribution.paid_amount_inr}</div></div>
      </div>

      {/* Free-plan workaround: Apollo's search API is paid-only, so search
          in Apollo's UI and paste the CSV export here — everything after
          (qualify/enrich/outreach) still runs automatically. */}
      <h2>🗂️ Import prospects (Apollo CSV export)</h2>
      <div className="card">
        <p className="muted" style={{ marginTop: 0 }}>
          Search in Apollo&apos;s web UI (free), export/copy results as CSV, paste below.
        </p>
        <textarea
          value={importCsv}
          onChange={(e) => setImportCsv(e.target.value)}
          placeholder="First Name,Last Name,Title,Company,Email,Person Linkedin Url,City,Country&#10;..."
          rows={6}
          style={{ width: '100%', background: 'var(--panel)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 8, padding: 10, fontFamily: 'monospace', fontSize: 12 }}
        />
        <div style={{ marginTop: 8 }}>
          <button onClick={runImport} disabled={!importCsv.trim()}>Import</button>
          {importResult && <span className="muted" style={{ marginLeft: 8 }}>{importResult}</span>}
        </div>
      </div>

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
            {fa.subject && <p style={{ margin: '4px 0 0' }}><strong>Subject:</strong> {fa.subject}</p>}
            <p style={{ whiteSpace: 'pre-wrap' }}>{fa.exact_message}</p>
            <p className="muted">Why: {fa.why_this_person}</p>
            <p className="muted">Timing: {fa.recommended_timing} · Goal: {fa.expected_objective}</p>
            <div>
              <CopyButton text={fa.subject ? `Subject: ${fa.subject}\n\n${fa.exact_message}` : fa.exact_message} />
              <button onClick={() => actFounder(fa.id, 'sent')}>Mark sent</button>
              <button className="secondary" onClick={() => actFounder(fa.id, 'rejected')}>Reject</button>
              <button className="secondary" onClick={() => actFounder(fa.id, 'not_relevant')}>Not relevant</button>
              <button className="secondary" onClick={() => actFounder(fa.id, 'snoozed')}>Snooze</button>
            </div>
          </div>
        ))
      )}

      {/* Product/pricing/UX opinions — not something the agent can execute itself */}
      <h2>🛠️ Product recommendations</h2>
      {data.product_recommendations_pending.length === 0 && <p className="muted">Nothing flagged right now.</p>}
      {data.product_recommendations_pending.map((rec) => (
        <div className="card" key={rec.id}>
          <strong>{rec.category}</strong> <span className="muted">· confidence {Math.round(rec.confidence * 100)}%</span>
          <p>{rec.recommendation}</p>
          <p className="muted">Why: {rec.rationale}</p>
          <div>
            <button onClick={() => actRec(rec.id, 'actioned')}>Mark actioned</button>
            <button className="secondary" onClick={() => actRec(rec.id, 'dismissed')}>Dismiss</button>
          </div>
        </div>
      ))}

      {/* Manual stats log — no API access exists for LinkedIn/Instagram/
          WhatsApp Status, so impressions/engagement/clicks are typed in
          here against each posted item. Feeds the weekly digest. */}
      <h2>📊 Performance log</h2>
      {perf.length === 0 && <p className="muted">Nothing posted in the last 30 days yet.</p>}
      {perf.map((item) => {
        const draft = perfDrafts[item.id] || {
          impressions: item.latest_performance?.impressions?.toString() ?? '',
          engagement: item.latest_performance?.engagement?.toString() ?? '',
          link_clicks: item.latest_performance?.link_clicks?.toString() ?? '',
        }
        const setField = (field: 'impressions' | 'engagement' | 'link_clicks', value: string) =>
          setPerfDrafts((prev) => ({ ...prev, [item.id]: { ...draft, ...prev[item.id], [field]: value } }))
        return (
          <div className="card" key={item.id}>
            <strong>{item.channel.replace(/_/g, ' ')}</strong>{' '}
            <span className="muted">· {item.category.replace(/_/g, ' ')} · posted {formatTime(item.created_at)}</span>
            <p className="muted" style={{ margin: '4px 0' }}>{(item.hook || item.body).slice(0, 120)}…</p>
            <div className="grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
              <div>
                <div className="stat-label">Impressions</div>
                <input value={draft.impressions} onChange={(e) => setField('impressions', e.target.value)} inputMode="numeric" />
              </div>
              <div>
                <div className="stat-label">Engagement</div>
                <input value={draft.engagement} onChange={(e) => setField('engagement', e.target.value)} inputMode="numeric" />
              </div>
              <div>
                <div className="stat-label">Link clicks</div>
                <input value={draft.link_clicks} onChange={(e) => setField('link_clicks', e.target.value)} inputMode="numeric" />
              </div>
            </div>
            {item.latest_performance && (
              <p className="muted" style={{ marginTop: 6 }}>Last logged: {item.latest_performance.as_of_date}</p>
            )}
            <div style={{ marginTop: 8 }}>
              <button onClick={() => savePerf(item.id)}>Save</button>
            </div>
          </div>
        )
      })}

      <h2>What the agent did</h2>
      <div className="card">
        {data.activity.length === 0 && <p className="muted">No activity logged yet today.</p>}
        {data.activity.map((a) => (
          <div className="activity-row" key={a.id}>
            <span className="muted">{formatTime(a.timestamp)}</span>{' '}
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
