import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './lib/supabase'

type PWork = { id: string; title: string; catalog_system: string | null; catalog_number: string | null; composers: { name: string; era: string | null } | null }
type Program = { position: number; works: PWork }
type Concert = {
  id: string; title: string; venue: string | null; city: string | null; starts_at: string; ends_at: string; qr_code: string; description: string | null
  ensembles: { name: string } | null; concert_program: Program[]; concert_reviews: CReview[]
}
type PScore = { live_count: number; live_avg: number | null; live_fresh_pct: number | null; heard_count: number }
type Checkin = { before_start: boolean; pre_done: boolean; post_done: boolean } | null
type PieceResp = { heard_before: boolean | null; prior_rating: number | null; live_rating: number | null }
type CReview = { rating: number; body: string | null; created_at: string; profiles: { display_name: string; role: string } | null }

const SELECT = `id, title, venue, city, starts_at, ends_at, qr_code, description,
  ensembles ( name ),
  concert_program ( position, works ( id, title, catalog_system, catalog_number, composers ( name, era ) ) ),
  concert_reviews ( rating, body, created_at, profiles ( display_name, role ) )`

function Stars({ value, onRate, size = 20 }: { value: number; onRate: (n: number) => void; size?: number }) {
  return (
    <span className="stars">
      {[1, 2, 3, 4, 5].map((n) => (
        <button key={n} type="button" className={`star${n <= value ? ' on' : ''}`} style={{ fontSize: size }} onClick={() => onRate(n)}>★</button>
      ))}
    </span>
  )
}

export default function ConcertDetail({ id, session, onBack }: { id: string; session: Session | null; onBack: () => void }) {
  const [c, setC] = useState<Concert | null>(null)
  const [checkin, setCheckin] = useState<Checkin>(null)
  const [resp, setResp] = useState<Record<string, PieceResp>>({})
  const [overall, setOverall] = useState(0)
  const [body, setBody] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [score, setScore] = useState<{ ratings: number; avg_rating: number; fresh_pct: number } | null>(null)
  const [pieceScore, setPieceScore] = useState<Record<string, PScore>>({})

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('concerts').select(SELECT).eq('id', id).single()
    if (error) { setErr(error.message); return }
    setC(data as unknown as Concert)
    const [{ data: cs }, { data: cps }] = await Promise.all([
      supabase.from('concert_score').select('ratings,avg_rating,fresh_pct').eq('concert_id', id).maybeSingle(),
      supabase.from('concert_piece_score').select('work_id,live_count,live_avg,live_fresh_pct,heard_count').eq('concert_id', id),
    ])
    setScore((cs as { ratings: number; avg_rating: number; fresh_pct: number } | null) ?? null)
    const pm: Record<string, PScore> = {}
    for (const r of (cps ?? []) as ({ work_id: string } & PScore)[]) pm[r.work_id] = r
    setPieceScore(pm)
    if (session?.user) {
      const uid = session.user.id
      const [{ data: ck }, { data: pr }, { data: cr }] = await Promise.all([
        supabase.from('concert_checkins').select('before_start,pre_done,post_done').eq('concert_id', id).eq('user_id', uid).maybeSingle(),
        supabase.from('concert_piece_ratings').select('work_id,heard_before,prior_rating,live_rating').eq('concert_id', id).eq('user_id', uid),
        supabase.from('concert_reviews').select('rating,body').eq('concert_id', id).eq('user_id', uid).maybeSingle(),
      ])
      setCheckin((ck as Checkin) ?? null)
      const map: Record<string, PieceResp> = {}
      for (const r of (pr ?? []) as { work_id: string; heard_before: boolean | null; prior_rating: number | null; live_rating: number | null }[])
        map[r.work_id] = { heard_before: r.heard_before, prior_rating: r.prior_rating, live_rating: r.live_rating }
      setResp(map)
      if (cr) { setOverall((cr as { rating: number }).rating); setBody((cr as { body: string | null }).body ?? '') }
    }
  }, [id, session?.user])

  useEffect(() => { load() }, [load])

  const phase = useMemo(() => {
    if (!c) return 'upcoming'
    const now = Date.now(), s = new Date(c.starts_at).getTime(), e = new Date(c.ends_at).getTime()
    return now > e ? 'past' : now >= s ? 'live' : 'upcoming'
  }, [c])

  if (err) return <div className="detail"><button className="detail-back" onClick={onBack}>← Concerts</button><p className="err-block">Error: {err}</p></div>
  if (!c) return <div className="detail"><button className="detail-back" onClick={onBack}>← Concerts</button><p className="notice" style={{ padding: 0 }}>Loading…</p></div>

  const program = [...c.concert_program].sort((a, b) => a.position - b.position)
  const dt = new Date(c.starts_at)
  const when = dt.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }) + ' · ' + dt.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  const mode: 'pre' | 'post' = phase === 'past' ? 'post' : 'pre'
  const setPiece = (wid: string, patch: Partial<PieceResp>) =>
    setResp((r) => {
      const cur = r[wid] ?? { heard_before: null, prior_rating: null, live_rating: null }
      return { ...r, [wid]: { ...cur, ...patch } }
    })
  const beforeStart = Date.now() < new Date(c.starts_at).getTime()

  async function savePre() {
    if (!session?.user) return
    setBusy(true); setErr(null)
    const uid = session.user.id
    const rows = program.map((p) => ({
      concert_id: id, user_id: uid, work_id: p.works.id,
      heard_before: resp[p.works.id]?.heard_before ?? false,
      prior_rating: resp[p.works.id]?.heard_before ? resp[p.works.id]?.prior_rating ?? null : null,
    }))
    const { error } = await supabase.from('concert_piece_ratings').upsert(rows, { onConflict: 'concert_id,user_id,work_id' })
    if (!error) await supabase.from('concert_checkins').upsert({ concert_id: id, user_id: uid, before_start: beforeStart, pre_done: true }, { onConflict: 'concert_id,user_id' })
    setBusy(false)
    if (error) setErr(error.message); else { setDone(true); load() }
  }

  async function savePost() {
    if (!session?.user || !overall) return
    setBusy(true); setErr(null)
    const uid = session.user.id
    const rows = program.filter((p) => resp[p.works.id]?.live_rating).map((p) => ({ concert_id: id, user_id: uid, work_id: p.works.id, live_rating: resp[p.works.id]!.live_rating }))
    if (rows.length) await supabase.from('concert_piece_ratings').upsert(rows, { onConflict: 'concert_id,user_id,work_id' })
    const { error } = await supabase.from('concert_reviews').upsert({ concert_id: id, user_id: uid, rating: overall, body: body.trim() || null }, { onConflict: 'concert_id,user_id' })
    if (!error) await supabase.from('concert_checkins').upsert({ concert_id: id, user_id: uid, post_done: true }, { onConflict: 'concert_id,user_id' })
    setBusy(false)
    if (error) setErr(error.message); else { setDone(true); load() }
  }

  const statusLabel = phase === 'past' ? 'Past concert' : phase === 'live' ? 'Happening now' : 'Upcoming'
  const era = program[0]?.works.composers?.era ?? 'default'

  return (
    <div className="detail">
      <button className="detail-back" onClick={onBack}>← Concerts</button>

      <section className={`detail-hero hero--${era}`}>
        <div className="detail-head">
          <div className="hero-eyebrow"><span className="dot" /> {statusLabel}</div>
          <h1 className="detail-title">{c.title}</h1>
          <div className="detail-perf">{c.ensembles?.name ?? ''}</div>
          <div className="detail-meta">{[when, c.venue, c.city].filter(Boolean).join(' · ')}</div>
          {score && (
            <div className="detail-scores">
              <div className="stat"><div className="num">{score.fresh_pct}%</div><div className="lab">🎻 Concert</div></div>
              <div className="stat"><div className="num">{score.ratings}</div><div className="lab">{score.ratings === 1 ? 'Rating' : 'Ratings'}</div></div>
            </div>
          )}
          {checkin && <div className="checked-badge">✓ Checked in{checkin.before_start ? ' before the concert' : ''}</div>}
        </div>
      </section>

      <div className="detail-body">
        <section className="panel">
          <h2 className="panel-title">Program</h2>
          <ol className="program">
            {program.map((p) => {
              const ps = pieceScore[p.works.id]
              return (
                <li key={p.works.id}>
                  <span className="prog-title">{p.works.title}</span>
                  <span className="prog-composer">{p.works.composers?.name}{p.works.catalog_system ? ` · ${p.works.catalog_system} ${p.works.catalog_number}` : ''}</span>
                  {ps && ps.live_fresh_pct != null && (
                    <span className="prog-score">{ps.live_fresh_pct}% liked · {ps.live_count} rated</span>
                  )}
                </li>
              )
            })}
          </ol>
        </section>

        {!session ? (
          <section className="panel"><p className="notice" style={{ padding: 0 }}>Sign in to check in and respond to this concert.</p></section>
        ) : done ? (
          <section className="panel prompt-done">
            <div className="big-check">✓</div>
            <h2 className="panel-title" style={{ justifyContent: 'center' }}>{mode === 'pre' ? 'Thanks — enjoy the concert!' : 'Thanks for your review!'}</h2>
            <p className="notice" style={{ padding: 0, textAlign: 'center' }}>
              {mode === 'pre' ? 'We saved what you’ve heard. We’ll ask how it went once the concert is over.' : 'Your concert rating has been recorded.'}
            </p>
          </section>
        ) : mode === 'pre' ? (
          <section className="panel prompt">
            <h2 className="panel-title">Before the concert 🎫</h2>
            <p className="prompt-intro">Here’s tonight’s program. <strong>Have you heard any of these before?</strong> Mark the ones you know and rate them — we’ll ask what you thought afterward.</p>
            <div className="piece-list">
              {program.map((p) => {
                const r: PieceResp = resp[p.works.id] ?? { heard_before: null, prior_rating: null, live_rating: null }
                return (
                  <div className="piece" key={p.works.id}>
                    <div className="piece-head">
                      <div><div className="piece-title">{p.works.title}</div><div className="piece-by">{p.works.composers?.name}</div></div>
                      <div className="seg">
                        <button className={`seg-btn${r.heard_before === true ? ' active' : ''}`} onClick={() => setPiece(p.works.id, { heard_before: true })}>Heard it</button>
                        <button className={`seg-btn${r.heard_before === false ? ' active' : ''}`} onClick={() => setPiece(p.works.id, { heard_before: false, prior_rating: null })}>New to me</button>
                      </div>
                    </div>
                    {r.heard_before && (
                      <div className="piece-rate">Did you like it? <Stars value={r.prior_rating ?? 0} onRate={(n) => setPiece(p.works.id, { prior_rating: n })} size={18} /></div>
                    )}
                  </div>
                )
              })}
            </div>
            <button className="btn btn--red btn--big" disabled={busy} onClick={savePre}>{busy ? 'Saving…' : 'Save my responses'}</button>
          </section>
        ) : (
          <section className="panel prompt">
            <h2 className="panel-title">How was the concert? 🎻</h2>
            <p className="prompt-intro">You attended <strong>{c.title}</strong>. Rate the concert overall and tell us how each piece sounded live.</p>
            <div className="write-stars" style={{ fontSize: 14 }}>Overall <Stars value={overall} onRate={setOverall} size={26} /></div>
            <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={3} placeholder="How was the evening? The hall, the playing, the atmosphere…" />
            <div className="piece-list" style={{ marginTop: 4 }}>
              {program.map((p) => {
                const r: PieceResp = resp[p.works.id] ?? { heard_before: null, prior_rating: null, live_rating: null }
                return (
                  <div className="piece" key={p.works.id}>
                    <div className="piece-head">
                      <div><div className="piece-title">{p.works.title}</div><div className="piece-by">{p.works.composers?.name}</div></div>
                      <Stars value={r.live_rating ?? 0} onRate={(n) => setPiece(p.works.id, { live_rating: n })} size={18} />
                    </div>
                  </div>
                )
              })}
            </div>
            <button className="btn btn--red btn--big" disabled={busy || !overall} onClick={savePost}>{busy ? 'Saving…' : 'Post concert review'}</button>
          </section>
        )}
        {c.concert_reviews.some((r) => r.body && r.body.trim()) && (
          <section className="panel">
            <h2 className="panel-title">Concert reviews <span className="count-badge">{c.concert_reviews.filter((r) => r.body && r.body.trim()).length}</span></h2>
            <div className="review-list">
              {c.concert_reviews.filter((r) => r.body && r.body.trim()).map((r, i) => (
                <article className="review" key={i}>
                  <div className="review-head">
                    <span className="review-avatar">{(r.profiles?.display_name ?? '?').charAt(0).toUpperCase()}</span>
                    <div className="review-who">
                      <div className="review-author">{r.profiles?.display_name ?? 'Anonymous'}{r.profiles?.role === 'critic' && <span className="badge-critic">Critic</span>}</div>
                      <div className="review-date">{new Date(r.created_at).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}</div>
                    </div>
                    <Stars value={r.rating} onRate={() => {}} size={16} />
                  </div>
                  <p className="review-body">{r.body}</p>
                </article>
              ))}
            </div>
          </section>
        )}
        {err && <p className="err-block" style={{ padding: 0 }}>Error: {err}</p>}
      </div>
    </div>
  )
}
