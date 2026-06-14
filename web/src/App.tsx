import { useEffect, useState } from 'react'
import { supabase } from './lib/supabase'

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

function performers(rec: Recording): string {
  return rec.credits
    .map((c) => c.artists?.name ?? c.ensembles?.name)
    .filter(Boolean)
    .join(' · ')
}

export default function App() {
  const [composers, setComposers] = useState<Composer[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // One relational query: composers → works → recordings → credits → artist/ensemble.
    supabase
      .from('composers')
      .select(
        `id, name, era, birth_year, death_year,
         works ( id, title, catalog_system, catalog_number,
           recordings ( id, year_recorded, label,
             credits ( role, is_primary, artists ( name ), ensembles ( name ) )
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
    <main style={{ maxWidth: 760, margin: '0 auto', padding: '2rem 1.25rem', fontFamily: 'system-ui, sans-serif' }}>
      <h1 style={{ marginBottom: 0 }}>Cannon</h1>
      <p style={{ color: '#888', marginTop: 4 }}>Rotten Tomatoes for classical music — connected to Supabase.</p>

      {loading && <p>Loading catalog…</p>}
      {error && (
        <p style={{ color: '#c0392b' }}>
          Error: {error}
        </p>
      )}
      {!loading && !error && composers.length === 0 && <p>No composers yet.</p>}

      {composers.map((c) => (
        <section key={c.id} style={{ borderTop: '1px solid #eee', paddingTop: '1rem', marginTop: '1rem' }}>
          <h2 style={{ marginBottom: 2 }}>{c.name}</h2>
          <div style={{ color: '#888', fontSize: 13 }}>
            {c.era}
            {c.birth_year ? ` · ${c.birth_year}–${c.death_year ?? ''}` : ''}
          </div>
          {c.works.map((w) => (
            <div key={w.id} style={{ marginTop: 12 }}>
              <strong>
                {w.title}
                {w.catalog_system ? ` (${w.catalog_system} ${w.catalog_number})` : ''}
              </strong>
              <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
                {w.recordings.map((r) => (
                  <li key={r.id} style={{ color: '#444' }}>
                    {performers(r)}
                    {r.year_recorded ? ` — ${r.year_recorded}` : ''}
                    {r.label ? ` (${r.label})` : ''}
                  </li>
                ))}
                {w.recordings.length === 0 && <li style={{ color: '#aaa' }}>no recordings yet</li>}
              </ul>
            </div>
          ))}
        </section>
      ))}
    </main>
  )
}
