import { useEffect, useState } from 'react'
import { supabase } from './lib/supabase'

export default function AuthModal({ mode: initialMode, onClose }: { mode: 'in' | 'up'; onClose: () => void }) {
  const [mode, setMode] = useState<'in' | 'up'>(initialMode)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [username, setUsername] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const switchMode = (m: 'in' | 'up') => { setMode(m); setErr(null); setInfo(null) }

  async function submit() {
    setErr(null); setInfo(null); setBusy(true)
    try {
      if (mode === 'in') {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
        if (error) { setErr(error.message); return }
        onClose()
      } else {
        const u = username.trim()
        if (u.length < 2) { setErr('Pick a username (at least 2 characters).'); return }
        if (!email.trim()) { setErr('Enter an email.'); return }
        if (password.length < 6) { setErr('Password must be at least 6 characters.'); return }
        // soft availability check (the DB also enforces uniqueness)
        const { data: taken } = await supabase.from('profiles').select('id').eq('handle', u).maybeSingle()
        if (taken) { setErr('That username is taken — try another.'); return }
        const { data, error } = await supabase.auth.signUp({
          email: email.trim(), password, options: { data: { username: u } },
        })
        if (error) { setErr(error.message); return }
        if (data.session) onClose()
        else setInfo('Account created! Check your email to confirm, then sign in. (For instant access, disable "Confirm email" in the Supabase Auth settings.)')
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <button className="modal-x" onClick={onClose} aria-label="Close">×</button>
        <div className="modal-tabs">
          <button className={`modal-tab${mode === 'in' ? ' active' : ''}`} onClick={() => switchMode('in')}>Sign in</button>
          <button className={`modal-tab${mode === 'up' ? ' active' : ''}`} onClick={() => switchMode('up')}>Create account</button>
        </div>
        <div className="modal-body">
          {mode === 'up' && (
            <label className="field">
              <span>Username</span>
              <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="quietcadenza" autoFocus />
            </label>
          )}
          <label className="field">
            <span>Email</span>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" autoFocus={mode === 'in'} />
          </label>
          <label className="field">
            <span>Password</span>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" onKeyDown={(e) => e.key === 'Enter' && submit()} />
          </label>
          {err && <div className="modal-err">{err}</div>}
          {info && <div className="modal-info">{info}</div>}
          <button className="btn btn--red btn--big modal-submit" disabled={busy} onClick={submit}>
            {busy ? 'Please wait…' : mode === 'in' ? 'Sign in' : 'Create account'}
          </button>
          {mode === 'in'
            ? <p className="modal-foot">New here? <button className="linkish" onClick={() => switchMode('up')}>Create an account</button></p>
            : <p className="modal-foot">Already have an account? <button className="linkish" onClick={() => switchMode('in')}>Sign in</button></p>}
        </div>
      </div>
    </div>
  )
}
