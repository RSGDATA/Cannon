import { useEffect, useState } from 'react'
import { supabase } from './lib/supabase'

type Review = { rating: number }
type Credit = {
  role: string
  is_primary: boolean
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
type Work = {
  id: string
  title: string
  catalog_system: string | null
  catalog_number: string | null
  recordings: Recording[]
}
type Composer = {
  id: string
  name: string
  era: string | null
  birth_year: number | null
  death_year: number | null
  works: Work[]
}

const performers = (r: Recording) =>
  r.credits.map((c) => c.artists?.name ?? c.ensembles?.name).filter(Boolean).join(' · ')

// average rating (1–5) -> 0–100 score
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
      <span
        style={{
          background: color, color: 'white', fontWeight: 700, fontSize: 13,
          borderRadius: 6, padding: '2px 7px', minWidth: 34, textAlign: 'center',
        }}
      >
        {pct}
      </span>
      <span style={{ color: '#888', fontSize: 12 }}>{count} review{count === 1 ? '' : 's'}</span>
    </span>
  )
}

export default function App() {
  const [composers, setComposers] = useState<Composer[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase
      .from('composers')
      .select(
        `id, name, era, birth_year, death_year,
         works ( id, title, catalog_system, catalog_number,
           recordings ( id, year_recorded, label,
             credits ( role, is_primary, artists ( name ), ensembles ( name ) ),
             reviews ( rating )
           )
         )`,
      )
      .order('sort_name')
      .then(({ data, error }) => {
        if (error) setError(error.message)
        else setComposers((data as unknown as Composer[]) ?? [])
        setLoading(false)
      })
  }, [])

  return (
    <main style={{ maxWidth: 780, margin: '0 auto', padding: '2rem 1.25rem', fontFamily: 'system-ui, sans-serif', color: '#222' }}>
      <h1 style={{ marginBottom: 0 }}>🍅 Cannon</h1>
      <p style={{ color: '#888', marginTop: 4 }}>Rotten Tomatoes for classical music — ratings live from Supabase/Postgres.</p>

      {loading && <p>Loading catalog…</p>}
      {error && <p style={{ color: '#c0392b' }}>Error: {error}</p>}
      {!loading && !error && composers.length === 0 && <p>No composers yet.</p>}

      {composers.map((c) => (
        <section key={c.id} style={{ borderTop: '1px solid #eee', paddingTop: '1rem', marginTop: '1rem' }}>
          <h2 style={{ marginBottom: 2 }}>{c.name}</h2>
          <div style={{ color: '#888', fontSize: 13 }}>
            {c.era}{c.birth_year ? ` · ${c.birth_year}–${c.death_year ?? ''}` : ''}
          </div>
          {c.works.map((w) => {
            const ranked = [...w.recordings].sort((a, b) => (score(b).avg ?? -1) - (score(a).avg ?? -1))
            return (
              <div key={w.id} style={{ marginTop: 14 }}>
                <strong>
                  {w.title}{w.catalog_system ? ` (${w.catalog_system} ${w.catalog_number})` : ''}
                </strong>
                <div style={{ marginTop: 6, display: 'grid', gap: 8 }}>
                  {ranked.map((r) => {
                    const s = score(r)
                    return (
                      <div key={r.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, background: '#fafafa', border: '1px solid #eee', borderRadius: 8, padding: '8px 12px' }}>
                        <div>
                          <div style={{ fontWeight: 600 }}>{performers(r)}</div>
                          <div style={{ color: '#888', fontSize: 12 }}>
                            {r.year_recorded ?? ''}{r.label ? ` · ${r.label}` : ''}
                          </div>
                        </div>
                        <ScoreBadge pct={s.pct} count={s.count} />
                      </div>
                    )
                  })}
                  {ranked.length === 0 && <div style={{ color: '#aaa' }}>no recordings yet</div>}
                </div>
              </div>
            )
          })}
        </section>
      ))}
    </main>
  )
}
