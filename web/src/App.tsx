import { useCallback, useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './lib/supabase'

type Review = { rating: number; author_id: string }
type Credit = {
  artists: { name: string } | null
  ensembles: { name: string } | null
}
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

function ScoreBadge({ pct, count }: { pct: number | null; count: number }) {
  if (pct == null) return <span style={{ color: '#aaa', fontSize: 13 }}>not yet rated</span>
  const color = pct >= 75 ? '#1a7f37' : pct >= 50 ? '#bf8700' : '#c0392b'
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <span style={{ background: color, color: 'white', fontWeight: 700, fontSize: 13, borderRadius: 6, padding: '2px 7px', minWidth: 34, textAlign: 'center' }}>{pct}</span>
      <span style={{ color: '#888', fontSize: 12 }}>{count} review{count === 1 ? '' : 's'}</span>
    </span>
  )
}

function Stars({ value, onRate, disabled }: { value: number; onRate: (n: number) => void; disabled?: boolean }) {
  return (
    <span style={{ whiteSpace: 'nowrap' }}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          disabled={disabled}
          onClick={() => onRate(n)}
          title={`${n} star${n > 1 ? 's' : ''}`}
          style={{ border: 'none', background: 'none', cursor: disabled ? 'default' : 'pointer', fontSize: 18, padding: 0, color: n <= value ? '#e8a000' : '#ccc' }}
        >
          ★
        </button>
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
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 14 }}>
        <span style={{ color: '#444' }}>Signed in as <strong>{session.user.email}</strong></span>
        <button type="button" onClick={() => supabase.auth.signOut()}>Sign out</button>
      </div>
    )
  }
  async function go(kind: 'in' | 'up') {
    setBusy(true); setMsg(null)
    const fn = kind === 'in'
      ? supabase.auth.signInWithPassword({ email, password })
      : supabase.auth.signUp({ email, password })
    const { data, error } = await fn
    if (error) setMsg(error.message)
    else if (kind === 'up' && !data.session) setMsg('Account created — confirm via email, or disable "Confirm email" in Supabase Auth settings to log in instantly.')
    setBusy(false)
  }
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontSize: 14 }}>
      <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="email" style={{ padding: 4 }} />
      <input value={password} onChange={(e) => setPassword(e.target.value)} placeholder="password" type="password" style={{ padding: 4 }} />
      <button type="button" disabled={busy} onClick={() => go('in')}>Sign in</button>
      <button type="button" disabled={busy} onClick={() => go('up')}>Sign up</button>
      {msg && <span style={{ color: '#c0392b' }}>{msg}</span>}
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
        // make sure a profile row exists (don't clobber seeded roles)
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
    <main style={{ maxWidth: 800, margin: '0 auto', padding: '2rem 1.25rem', fontFamily: 'system-ui, sans-serif', color: '#222' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ margin: 0 }}>🍅 Cannon</h1>
          <p style={{ color: '#888', margin: '4px 0 0' }}>Rotten Tomatoes for classical music.</p>
        </div>
        <AuthBar session={session} />
      </div>

      {loading && <p>Loading catalog…</p>}
      {error && <p style={{ color: '#c0392b' }}>Error: {error}</p>}

      {composers.map((c) => (
        <section key={c.id} style={{ borderTop: '1px solid #eee', paddingTop: '1rem', marginTop: '1rem' }}>
          <h2 style={{ marginBottom: 2 }}>{c.name}</h2>
          <div style={{ color: '#888', fontSize: 13 }}>{c.era}{c.birth_year ? ` · ${c.birth_year}–${c.death_year ?? ''}` : ''}</div>
          {c.works.map((w) => {
            const ranked = [...w.recordings].sort((a, b) => (score(b).avg ?? -1) - (score(a).avg ?? -1))
            return (
              <div key={w.id} style={{ marginTop: 14 }}>
                <strong>{w.title}{w.catalog_system ? ` (${w.catalog_system} ${w.catalog_number})` : ''}</strong>
                <div style={{ marginTop: 6, display: 'grid', gap: 8 }}>
                  {ranked.map((r) => {
                    const s = score(r)
                    const mine = r.reviews.find((x) => x.author_id === myId)?.rating ?? 0
                    return (
                      <div key={r.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, background: '#fafafa', border: '1px solid #eee', borderRadius: 8, padding: '8px 12px' }}>
                        <div>
                          <div style={{ fontWeight: 600 }}>{performers(r)}</div>
                          <div style={{ color: '#888', fontSize: 12 }}>{r.year_recorded ?? ''}{r.label ? ` · ${r.label}` : ''}</div>
                          {session && (
                            <div style={{ marginTop: 4, fontSize: 12, color: '#666', display: 'flex', alignItems: 'center', gap: 6 }}>
                              your rating: <Stars value={mine} onRate={(n) => rate(r.id, n)} />
                            </div>
                          )}
                        </div>
                        <ScoreBadge pct={s.pct} count={s.count} />
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </section>
      ))}

      {!session && <p style={{ color: '#888', fontSize: 13, marginTop: 24 }}>Sign in (e.g. alice@example.com / password123) to rate recordings.</p>}
    </main>
  )
}
