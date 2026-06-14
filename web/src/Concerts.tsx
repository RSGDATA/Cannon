import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './lib/supabase'

type C = { id: string; title: string; venue: string | null; city: string | null; starts_at: string; ends_at: string; qr_code: string; ensembles: { name: string } | null; concert_program: { works: { title: string } }[] }

const SELECT = `id, title, venue, city, starts_at, ends_at, qr_code, ensembles(name), concert_program(works(title))`
const phaseOf = (c: C) => { const now = Date.now(), s = new Date(c.starts_at).getTime(), e = new Date(c.ends_at).getTime(); return now > e ? 'past' : now >= s ? 'live' : 'upcoming' }
const LABEL: Record<string, string> = { past: 'Past', live: 'Now', upcoming: 'Upcoming' }
const pct = (a: number) => Math.round(((a - 1) / 4) * 100)

export default function Concerts({ session, onOpen }: { session: Session | null; onOpen: (id: string) => void }) {
  const [list, setList] = useState<C[]>([])
  const [q, setQ] = useState('')
  const [code, setCode] = useState('')
  const [codeMsg, setCodeMsg] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [scores, setScores] = useState<Record<string, { ratings: number; avg_rating: number }>>({})

  const load = useCallback(async () => {
    const [{ data, error }, { data: sc }] = await Promise.all([
      supabase.from('concerts').select(SELECT).order('starts_at'),
      supabase.from('concert_score').select('concert_id,ratings,avg_rating'),
    ])
    if (error) setErr(error.message); else setList((data as unknown as C[]) ?? [])
    const m: Record<string, { ratings: number; avg_rating: number }> = {}
    for (const r of (sc ?? []) as { concert_id: string; ratings: number; avg_rating: number }[]) m[r.concert_id] = { ratings: r.ratings, avg_rating: r.avg_rating }
    setScores(m)
  }, [])
  useEffect(() => { load() }, [load])

  async function enterCode() {
    setCodeMsg(null)
    const v = code.trim().toUpperCase()
    if (!v) return
    const { data, error } = await supabase.from('concerts').select('id,starts_at').eq('qr_code', v).maybeSingle()
    if (error) { setCodeMsg(error.message); return }
    if (!data) { setCodeMsg('No concert found for that code.'); return }
    const concert = data as { id: string; starts_at: string }
    if (session?.user) {
      const before = Date.now() < new Date(concert.starts_at).getTime()
      await supabase.from('concert_checkins').upsert({ concert_id: concert.id, user_id: session.user.id, before_start: before }, { onConflict: 'concert_id,user_id', ignoreDuplicates: true })
    }
    onOpen(concert.id)
  }

  const filtered = useMemo(() => {
    const n = q.trim().toLowerCase()
    return list.filter((c) => !n || `${c.title} ${c.ensembles?.name ?? ''} ${c.city ?? ''} ${c.venue ?? ''}`.toLowerCase().includes(n))
  }, [q, list])

  return (
    <div className="concerts">
      <section className="code-card">
        <div>
          <h2 className="code-title">Have a concert code?</h2>
          <p className="code-sub">Scan the QR in your program — or type the code — to check in and rate the program.</p>
        </div>
        <div className="code-entry">
          <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="e.g. VIENNA24" onKeyDown={(e) => e.key === 'Enter' && enterCode()} />
          <button className="btn btn--red btn--big" onClick={enterCode}>Check in</button>
        </div>
        {codeMsg && <div className="code-msg">{codeMsg}</div>}
        {!session && <div className="code-msg">Sign in first so we can save your responses.</div>}
      </section>

      <div className="row-head concerts-head">
        <h2 className="row-title">Concerts</h2>
        <input className="concert-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search concerts, cities, halls" />
      </div>
      {err && <p className="err-block">{err}</p>}
      <div className="concert-list">
        {filtered.map((c) => {
          const ph = phaseOf(c); const dt = new Date(c.starts_at)
          return (
            <article className={`concert-card ph-${ph}`} key={c.id} onClick={() => onOpen(c.id)}>
              <div className="concert-date">
                <div className="cd-month">{dt.toLocaleDateString(undefined, { month: 'short' })}</div>
                <div className="cd-day">{dt.getDate()}</div>
              </div>
              <div className="concert-info">
                <div className="concert-status"><span className={`status-dot ${ph}`} /> {LABEL[ph]} · {dt.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}</div>
                <div className="concert-title">{c.title}</div>
                <div className="concert-sub">{[c.ensembles?.name, c.venue, c.city].filter(Boolean).join(' · ')}</div>
                <div className="concert-prog">{c.concert_program.map((p) => p.works.title).join('  •  ')}</div>
              </div>
              <div className="concert-cta">
                {scores[c.id] && <span className="concert-score" title={`${scores[c.id].ratings} ratings`}>{pct(scores[c.id].avg_rating)}%</span>}
                <span className="cgo">→</span>
              </div>
            </article>
          )
        })}
        {filtered.length === 0 && <p className="notice">No concerts found.</p>}
      </div>
    </div>
  )
}
