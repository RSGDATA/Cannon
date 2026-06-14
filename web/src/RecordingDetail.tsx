import { useCallback, useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './lib/supabase'
import { freshPct } from './lib/score'

type RevAuthor = { handle: string; display_name: string; role: string } | null
type DetailReview = { id: string; rating: number; body: string | null; created_at: string; author_id: string; profiles: RevAuthor }
type Composer = { name: string; era: string | null; birth_year: number | null; death_year: number | null; nationality: string | null } | null
type DWork = { title: string; key: string | null; form: string | null; catalog_system: string | null; catalog_number: string | null; year_composed: number | null; nicknames: string[]; composer: Composer } | null
type Credit = { role: string; is_primary: boolean; artists: { name: string } | null; ensembles: { name: string } | null }
type Detail = {
  id: string; year_recorded: number | null; label: string | null; venue: string | null; recording_type: string
  work: DWork; credits: Credit[]; reviews: DetailReview[]
}

const DETAIL_SELECT = `id, year_recorded, label, venue, recording_type,
  work:works ( title, key, form, catalog_system, catalog_number, year_composed, nicknames,
    composer:composers ( name, era, birth_year, death_year, nationality ) ),
  credits ( role, is_primary, artists ( name ), ensembles ( name ) ),
  reviews ( id, rating, body, created_at, author_id, profiles!reviews_author_id_fkey ( handle, display_name, role ) )`

const pct = freshPct // Rotten-Tomatoes-style: % of reviews that are good (see lib/score.ts)

function Stars({ value, onRate, readOnly }: { value: number; onRate?: (n: number) => void; readOnly?: boolean }) {
  return (
    <span className="stars">
      {[1, 2, 3, 4, 5].map((n) => (
        <button key={n} type="button" className={`star${n <= value ? ' on' : ''}`} disabled={readOnly} onClick={() => onRate?.(n)}>★</button>
      ))}
    </span>
  )
}

export default function RecordingDetail({ id, session, onBack }: { id: string; session: Session | null; onBack: () => void }) {
  const [d, setD] = useState<Detail | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [myRating, setMyRating] = useState(0)
  const [body, setBody] = useState('')
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('recordings').select(DETAIL_SELECT).eq('id', id).single()
    if (error) { setErr(error.message); return }
    const det = data as unknown as Detail
    setD(det)
    const mine = det.reviews.find((r) => r.author_id === session?.user.id)
    if (mine) { setMyRating(mine.rating); setBody(mine.body ?? '') }
  }, [id, session?.user.id])

  useEffect(() => { load() }, [load])

  async function submit() {
    if (!session?.user || !myRating) return
    setSaving(true)
    const { error } = await supabase.from('reviews').upsert(
      { recording_id: id, author_id: session.user.id, rating: myRating, body: body.trim() || null },
      { onConflict: 'recording_id,author_id' },
    )
    setSaving(false)
    if (error) setErr(error.message)
    else load()
  }

  if (err) return <div className="detail"><button className="detail-back" onClick={onBack}>← All recordings</button><p className="err-block">Error: {err}</p></div>
  if (!d) return <div className="detail"><button className="detail-back" onClick={onBack}>← All recordings</button><p className="notice" style={{ padding: 0 }}>Loading…</p></div>

  const ratings = d.reviews.map((r) => r.rating)
  const critic = pct(d.reviews.filter((r) => r.profiles?.role === 'critic').map((r) => r.rating))
  const audience = pct(d.reviews.filter((r) => r.profiles?.role !== 'critic').map((r) => r.rating))
  const era = d.work?.composer?.era ?? 'default'
  const performers = d.credits.map((c) => `${c.artists?.name ?? c.ensembles?.name}${c.role ? ` (${c.role})` : ''}`).join(' · ')
  const dist = [5, 4, 3, 2, 1].map((star) => ({ star, n: ratings.filter((r) => r === star).length }))
  const written = d.reviews.filter((r) => r.body && r.body.trim())

  return (
    <div className="detail">
      <button className="detail-back" onClick={onBack}>← All recordings</button>

      <section className={`detail-hero hero--${era}`}>
        <div className={`detail-cover cover--${era}`}>♪</div>
        <div className="detail-head">
          <div className="hero-eyebrow"><span className="dot" /> Recording</div>
          <h1 className="detail-title">{d.work?.title}{d.work?.nicknames?.length ? <span className="nick"> “{d.work.nicknames[0]}”</span> : null}</h1>
          <div className="detail-perf">{performers}</div>
          <div className="detail-meta">{[d.work?.composer?.name, d.year_recorded, d.recording_type, d.label, d.venue].filter(Boolean).join(' · ')}</div>
          <div className="detail-scores">
            <div className="stat"><div className="num">{critic == null ? '—' : `${critic}%`}</div><div className="lab">🎼 Critics</div></div>
            <div className="stat"><div className="num">{audience == null ? '—' : `${audience}%`}</div><div className="lab">🎧 Listeners</div></div>
            <div className="stat"><div className="num">{d.reviews.length}</div><div className="lab">{d.reviews.length === 1 ? 'Rating' : 'Ratings'}</div></div>
          </div>
        </div>
      </section>

      <div className="detail-body">
        <section className="panel">
          <h2 className="panel-title">About the piece</h2>
          <div className="about-grid">
            <div><dt>Composer</dt><dd>{d.work?.composer?.name}{d.work?.composer?.birth_year ? ` (${d.work.composer.birth_year}–${d.work.composer.death_year ?? ''})` : ''}</dd></div>
            <div><dt>Era</dt><dd className="cap">{d.work?.composer?.era ?? '—'}</dd></div>
            <div><dt>Form</dt><dd className="cap">{d.work?.form ?? '—'}</dd></div>
            <div><dt>Key</dt><dd>{d.work?.key ?? '—'}</dd></div>
            <div><dt>Catalogue</dt><dd>{d.work?.catalog_system ? `${d.work.catalog_system} ${d.work.catalog_number}` : '—'}</dd></div>
            <div><dt>Composed</dt><dd>{d.work?.year_composed ?? '—'}</dd></div>
          </div>
        </section>

        <section className="panel">
          <h2 className="panel-title">Rating breakdown <span className="count-badge">{ratings.length} votes</span></h2>
          {ratings.length === 0 ? <p className="notice" style={{ padding: 0 }}>No ratings yet.</p> : (
            <div className="dist">
              {dist.map(({ star, n }) => (
                <div className="dist-row" key={star}>
                  <span className="dist-star">{star}★</span>
                  <span className="dist-track"><span className="dist-fill" style={{ width: `${ratings.length ? (n / ratings.length) * 100 : 0}%` }} /></span>
                  <span className="dist-n">{n}</span>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="panel">
          <h2 className="panel-title">Write a review</h2>
          {session ? (
            <div className="write">
              <div className="write-stars">Your rating <Stars value={myRating} onRate={setMyRating} /></div>
              <textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="Share your thoughts on this performance…" rows={4} />
              <button className="btn btn--red btn--big" disabled={!myRating || saving} onClick={submit}>{saving ? 'Saving…' : 'Post review'}</button>
            </div>
          ) : <p className="notice" style={{ padding: 0 }}>Sign in to rate and review this recording.</p>}
        </section>

        <section className="panel">
          <h2 className="panel-title">Reviews <span className="count-badge">{written.length}</span></h2>
          {written.length === 0 ? <p className="notice" style={{ padding: 0 }}>No written reviews yet — be the first.</p> : (
            <div className="review-list">
              {written.map((r) => (
                <article className="review" key={r.id}>
                  <div className="review-head">
                    <span className="review-avatar">{(r.profiles?.display_name ?? '?').charAt(0).toUpperCase()}</span>
                    <div className="review-who">
                      <div className="review-author">{r.profiles?.display_name ?? 'Anonymous'}{r.profiles?.role === 'critic' && <span className="badge-critic">Critic</span>}</div>
                      <div className="review-date">{new Date(r.created_at).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}</div>
                    </div>
                    <Stars value={r.rating} readOnly />
                  </div>
                  <p className="review-body">{r.body}</p>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
