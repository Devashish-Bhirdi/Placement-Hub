import { useCallback, useEffect, useState } from 'react';
import { HashRouter, NavLink, Route, Routes } from 'react-router-dom';
import { loadMaster } from './loader';
import MasterPage from './pages/MasterPage';
import InsightsPage from './pages/InsightsPage';
import CompanyDashboard from './pages/companyDashboard';

export default function App() {
  const [state, setState] = useState({ status: 'loading', master: [], skipped: [], colleges: [], fileCount: 0, error: null });

  const load = useCallback(async () => {
    setState((s) => ({ ...s, status: 'loading', error: null }));
    try {
      setState({ status: 'ready', error: null, ...(await loadMaster()) });
    } catch (e) {
      setState((s) => ({ ...s, status: 'error', error: e.message || String(e) }));
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const { status, master, skipped, colleges, fileCount, error } = state;

  return (
    <HashRouter>
      <header className="top">
        <h1>Placement Dashboard</h1>
        <nav>
          <NavLink to="/" end>Master sheet</NavLink>
          <NavLink to="/companies">Companies</NavLink>
          <NavLink to="/insights">Insights</NavLink>
        </nav>
        <button className="btn" onClick={load} disabled={status === 'loading'}>
          {status === 'loading' ? 'Loading…' : 'Refresh'}
        </button>
      </header>

      <main>
        {status === 'error' && (
          <div className="notice error">
            <strong>Could not load data.</strong> {error}
            <div className="hint">Check <code>.env</code>, the bucket name, and that a read policy exists on <code>storage.objects</code> (see README).</div>
          </div>
        )}
        {status === 'ready' && fileCount === 0 && (
          <div className="notice warn">
            No Excel files found in the bucket. If you have uploaded files, add the read policy described in the README.
          </div>
        )}
        {status === 'ready' && fileCount > 0 && (
          <div className="notice info">
            Loaded {fileCount} file{fileCount > 1 ? 's' : ''} · {colleges.length} college{colleges.length === 1 ? '' : 's'}: {colleges.join(', ') || 'none'}
          </div>
        )}
        {skipped.length > 0 && (
          <div className="notice warn">
            <strong>Skipped:</strong>
            <ul>{skipped.map((s) => <li key={s.file}><code>{s.file}</code>: {s.reason}</li>)}</ul>
          </div>
        )}

        {status === 'loading' && master.length === 0 ? (
          <p className="muted">Loading files from Supabase…</p>
        ) : (
          <Routes>
            <Route path="/" element={<MasterPage master={master} />} />
            <Route path="/insights" element={<InsightsPage master={master} />} />
            <Route path="/companies" element={<CompanyDashboard master={master} />} />
          </Routes>
        )}
      </main>
    </HashRouter>
  );
}
