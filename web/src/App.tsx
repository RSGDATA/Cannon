import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './lib/supabase'

type Review = { rating: number; author_id: string; profiles: { role: string } | null }
type Credit = { artists: { name: string } | null; ensembles: { name: string } | null }
type Recording = { id: string; year_recorded: number | null; label: string | null; credits: Credit[]; reviews: Review[] }
type Work = { id: string; title: string; catalog_system: string | null; catalog_number: string | null; recordings: Recording[] }
type Composer = { id: string; name: string; era: string | null; birth_year: number | null; death_year: number | null; works: Work[] }
type Item = { rec: Recording; work: Work; composer: Composer }

const CATALOG_SELECT = `id, name, era, birth_year, death_year,
  works ( id, title, catalog_system, catalog_number,
    recordings ( id, year_recorded, label,
      credits ( artists ( name ), ensembles ( name ) ),
      reviews ( rating, author_id, profiles!reviews_author_id_fkey ( role ) )
    )
  )`

const performers = (r: Recording) =>
  r.credits.map((c) => c.artists?.name ?? c.ensembles?.name).filter(Boolean).join(' · ')
const surname = (name: string) => name.split(' ').pop() ?? name
const pctOf = (arr: number[]) => (arr.length ? Math.round(((arr.reduce((a, b) => a + b, 0) / arr.length - 1) / 4) * 100) : null)

function scores(r: Recording) {
  const critic = r.reviews.filter((x) => x.profiles?.role === 'critic').map((x) => x.rating)
  const audience = r.reviews.filter((x) => x.profiles?.role !== 'critic').map((x) => x.rating)
  const overall = r.reviews.length ? r.reviews.reduce((a, b) => a + b.rating, 0) / r.reviews.length : -1
  return { critic: pctOf(critic), audience: pctOf(audience), overall }
}

function Pill({ icon, pct }: { icon: string; pct: number | null }) {
  const cls = pct == null ? 'none' : pct >= 60 ? 'fresh' : 'rotten'
  return (
    <span className={`pill ${cls}`}>
      <span className="ic">{icon}</span>
      <span className="v">{pct == null ? '—' : `${pct}%`}</span>
    </span>
  )
}

function Stars({ value, onRate }: { value: number; onRate: (n: number) => void }) {
  return (
    <span className="stars">
      {[1, 2, 3, 4, 5].map((n) => (
        <button key={n} type="button" className={`star${n <= value ? ' on' : ''}`} onClick={() => onRate(n)} title={`${n}`}>★</button>
      ))}
    </span>
  )
}

function Card({ item, myId, session, onRate }: { item: Item; myId?: string; session: Session | null; onRate: (id: string, n: number) => void }) {
  const { rec, work, composer } = item
  const s = scores(rec)
  const era = composer.era ?? 'default'
  const mine = rec.reviews.find((x) => x.author_id === myId)?.rating ?? 0
  return (
    <div className="card">
      <div className={`cover cover--${era}`}>
        <div className="cover-top">
          <span className="cover-glyph">♪</span>
          {work.catalog_system && <span className="cover-cat">{work.catalog_system} {work.catalog_number}</span>}
        </div>
        <div>
          <div className="cover-work">{work.title}</div>
          <div className="cover-composer">{surname(composer.name)}</div>
        </div>
      </div>
      <div className="scores">
        <Pill icon="🍅" pct={s.critic} />
        <Pill icon="🎧" pct={s.audience} />
      </div>
      <div className="card-title">{performers(rec)}</div>
      <div className="card-sub">{rec.year_recorded ?? ''}{rec.label ? ` · ${rec.label}` : ''}</div>
      {session && (
        <div className="card-rate">rate <Stars value={mine} onRate={(n) => onRate(rec.id, n)} /></div>
      )}
    </div>
  )
}

function Row({ title, sub, items, ...rest }: { title: string; sub?: string; items: Item[]; myId?: string; session: Session | null; onRate: (id: string, n: number) => void }) {
  if (items.length === 0) return null
  return (
    <section className="row">
      <div className="row-head">
        <h2 className="row-title">{title}</h2>
        {sub && <span className="row-sub">{sub}</span>}
      </div>
      <div className="carousel">
        {items.map((it) => <Card key={it.rec.id} item={it} {...rest} />)}
      </div>
    </section>
  )
}

function NavAuth({ session }: { session: Session | null }) {
  const [email, setEmail] = useState('alice@example.com')
  const [password, setPassword] = useState('password123')
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  if (session) {
    return (
      <div className="nav-auth">
        <span className="who">{session.user.email}</span>
        <button type="button" className="btn btn--ghost" onClick={() => supabase.auth.signOut()}>Sign out</button>
      </div>
    )
  }
  async function go(kind: 'in' | 'up') {
    setBusy(true); setErr(null)
    const { data, error } = await (kind === 'in'
      ? supabase.auth.signInWithPassword({ email, password })
      : supabase.auth.signUp({ email, password }))
    if (error) setErr(error.message)
    else if (kind === 'up' && !data.session) setErr('Confirm via email or disable email confirmation.')
    setBusy(false)
  }
  return (
    <div className="nav-auth">
      <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="email" />
      <input value={password} onChange={(e) => setPassword(e.target.value)} placeholder="password" type="password" />
      <button type="button" className="btn btn--red" disabled={busy} onClick={() => go('in')}>Sign in</button>
      <button type="button" className="btn btn--ghost" disabled={busy} onClick={() => go('up')}>Join</button>
      {err && <span className="auth-err">{err}</span>}
    </div>
  )
}

export default function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [composers, setComposers] = useState<Composer[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')

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
    if (error) setError(error.message)
    else loadCatalog()
  }

  const allItems = useMemo<Item[]>(() => {
    const out: Item[] = []
    for (const composer of composers)
      for (const work of composer.works)
        for (const rec of work.recordings) out.push({ rec, work, composer })
    return out
  }, [composers])

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    if (!needle) return null
    return allItems.filter((it) =>
      `${it.composer.name} ${it.work.title} ${performers(it.rec)}`.toLowerCase().includes(needle),
    )
  }, [q, allItems])

  const topRated = useMemo(
    () => [...allItems].filter((i) => i.rec.reviews.length).sort((a, b) => scores(b.rec).overall - scores(a.rec).overall),
    [allItems],
  )
  const myId = session?.user.id
  const shared = { myId, session, onRate: rate }

  return (
    <>
      <nav className="nav">
        <div className="nav-brand"><span className="logo">🍅</span> <span>Ca<span className="rt">nn</span>on</span></div>
        <div className="nav-links">
          <a className="nav-link" href="#">Recordings</a>
          <a className="nav-link" href="#">Composers</a>
        </div>
        <div className="nav-search">
          <span className="mag">🔍</span>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search composers, works, performers" />
        </div>
        <NavAuth session={session} />
      </nav>

      {loading && <p className="notice" style={{ paddingTop: 24 }}>Loading catalog…</p>}
      {error && <p className="err-block" style={{ paddingTop: 24 }}>Error: {error}</p>}

      {filtered ? (
        <Row title={`Results for “${q}”`} sub={`${filtered.length} recording${filtered.length === 1 ? '' : 's'}`} items={filtered} {...shared} />
      ) : (
        <>
          <Row title="Top Rated" sub="ranked by score" items={topRated} {...shared} />
          {composers.map((c) => (
            <Row
              key={c.id}
              title={c.name}
              sub={c.era ?? undefined}
              items={c.works.flatMap((w) => w.recordings.map((rec) => ({ rec, work: w, composer: c })))}
              {...shared}
            />
          ))}
        </>
      )}

      {!session && !loading && (
        <p className="notice" style={{ padding: '8px clamp(14px,4vw,40px) 40px' }}>
          Sign in (<strong>alice@example.com</strong> / <strong>password123</strong>) to rate recordings.
        </p>
      )}
    </>
  )
}
