import { useCallback, useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './lib/supabase'

type Review = { rating: number; author_id: string }
type Credit = { artists: { name: string } | null; ensembles: { name: string } | null }
type Recording = {
  id: string
  year_recorded: number | null
  label: string | null
  credits: Credit[]
  reviews: Review[]
}
type Work = { id: string; title: string; catalog_system: string | null; catalog_number: string | null; recordings: Recording[] }
type Composer = { id: string; name: string; era: string | null; birth_year: number | null; death_year: number | null; works: Work[] }

const CATALOG_SELECT = `id, name, era, birth_year, death_year,
  works ( id, title, catalog_system, catalog_number,
    recordings ( id, year_recorded, label,
      credits ( artists ( name ), ensembles ( name ) ),
      reviews ( rating, author_id )
    )
  )`

const performers = (r: Recording) =>
  r.credits.map((c) => c.artists?.name ?? c.ensembles?.name).filter(Boolean).join(' · ')

function score(r: Recording) {
  const ratings = r.reviews.map((x) => x.rating)
  const count = ratings.length
  const avg = count ? ratings.reduce((a, b) => a + b, 0) / count : null
  const pct = avg == null ? null : Math.round(((avg - 1) / 4) * 100)
  return { count, avg, pct }
}

function Meter({ pct, count }: { pct: number | null; count: number }) {
  if (pct == null) {
    return (
      <div>
        <div className="meter meter--none"><span className="dash">–</span></div>
        <span className="rec-count">no reviews</span>
      </div>
    )
  }
  const tier = pct >= 75 ? 'green' : pct >= 50 ? 'amber' : 'red'
  return (
    <div>
      <div className={`meter meter--${tier}`}>
        <span className="pct">{pct}<sup>%</sup></span>
      </div>
      <span className="rec-count">{count} review{count === 1 ? '' : 's'}</span>
    </div>
  )
}

function Stars({ value, onRate }: { value: number; onRate: (n: number) => void }) {
  return (
    <span className="stars">
      {[1, 2, 3, 4, 5].map((n) => (
        <button key={n} type="button" className={`star${n <= value ? ' on' : ''}`} onClick={() => onRate(n)} title={`${n} star${n > 1 ? 's' : ''}`}>★</button>
      ))}
    </span>
  )
}

function AuthBar({ session }: { session: Session | null }) {
  const [email, setEmail] = useState('alice@example.com')
  const [password, setPassword] = useState('password123')
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (session) {
    return (
      <div className="auth">
        <span className="who">Signed in as <strong>{session.user.email}</strong></span>
        <button type="button" className="btn btn--ghost" onClick={() => supabase.auth.signOut()}>Sign out</button>
      </div>
    )
  }
  async function go(kind: 'in' | 'up') {
    setBusy(true); setMsg(null)
    const { data, error } = await (kind === 'in'
      ? supabase.auth.signInWithPassword({ email, password })
      : supabase.auth.signUp({ email, password }))
    if (error) setMsg(error.message)
    else if (kind === 'up' && !data.session) setMsg('Created — confirm via email, or disable "Confirm email" in Supabase Auth settings.')
    setBusy(false)
  }
  return (
    <div className="auth">
      <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="email" />
      <input value={password} onChange={(e) => setPassword(e.target.value)} placeholder="password" type="password" />
      <button type="button" className="btn btn--light" disabled={busy} onClick={() => go('in')}>Sign in</button>
      <button type="button" className="btn btn--ghost" disabled={busy} onClick={() => go('up')}>Sign up</button>
      {msg && <span className="err">{msg}</span>}
    </div>
  )
}

export default function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [composers, setComposers] = useState<Composer[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const loadCatalog = useCallback(async () => {
    const { data, error } = await supabase.from('composers').select(CATALOG_SELECT).order('sort_name')
    if (error) setError(error.message)
    else setComposers((data as unknown as Composer[]) ?? [])
    setLoading(false)
  }, [])

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s)
      if (s?.user) {
        supabase.from('profiles').upsert(
          { id: s.user.id, handle: s.user.email!.split('@')[0], display_name: s.user.email!.split('@')[0] },
          { onConflict: 'id', ignoreDuplicates: true },
        ).then(() => {})
      }
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  useEffect(() => { loadCatalog() }, [loadCatalog])

  async function rate(recordingId: string, rating: number) {
    if (!session?.user) return
    const { error } = await supabase.from('reviews').upsert(
      { recording_id: recordingId, author_id: session.user.id, rating },
      { onConflict: 'recording_id,author_id' },
    )
    if (error) { setError(error.message); return }
    loadCatalog()
  }

  const myId = session?.user.id
  return (
    <>
      <header className="topbar">
        <div className="brand">
          <span className="brand-logo">🍅</span>
          <div>
            <h1 className="brand-name">Cannon</h1>
            <p className="brand-tag">Rotten Tomatoes for classical music</p>
          </div>
        </div>
        <AuthBar session={session} />
      </header>

      <main className="container">
        {loading && <p className="notice">Loading catalog…</p>}
        {error && <p className="err-block">Error: {error}</p>}

        {composers.map((c) => (
          <section className="composer" key={c.id}>
            <div className="composer-head">
              <h2 className="composer-name">{c.name}</h2>
              <span className="composer-meta">
                {c.era}{c.birth_year ? ` · ${c.birth_year}–${c.death_year ?? ''}` : ''}
              </span>
            </div>
            {c.works.map((w) => {
              const ranked = [...w.recordings].sort((a, b) => (score(b).avg ?? -1) - (score(a).avg ?? -1))
              return (
                <div className="work" key={w.id}>
                  <h3 className="work-title">
                    {w.title}{w.catalog_system ? <span className="work-cat"> {w.catalog_system} {w.catalog_number}</span> : null}
                  </h3>
                  <div className="recordings">
                    {ranked.map((r) => {
                      const s = score(r)
                      const mine = r.reviews.find((x) => x.author_id === myId)?.rating ?? 0
                      return (
                        <article className="rec-card" key={r.id}>
                          <Meter pct={s.pct} count={s.count} />
                          <div className="rec-main">
                            <div className="rec-performers">{performers(r)}</div>
                            <div className="rec-meta">{r.year_recorded ?? ''}{r.label ? ` · ${r.label}` : ''}</div>
                            {session && (
                              <div className="rec-rate">
                                your rating <Stars value={mine} onRate={(n) => rate(r.id, n)} />
                              </div>
                            )}
                          </div>
                        </article>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </section>
        ))}

        {!session && !loading && (
          <p className="notice" style={{ marginTop: 28 }}>
            Sign in (e.g. <strong>alice@example.com</strong> / <strong>password123</strong>) to rate recordings.
          </p>
        )}
      </main>
    </>
  )
}
