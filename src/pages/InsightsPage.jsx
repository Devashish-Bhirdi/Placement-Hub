import { useMemo } from 'react';
import { packageComparison, uniqueCompaniesByCollege } from '../data';

export default function InsightsPage({ master }) {
  const unique = useMemo(() => uniqueCompaniesByCollege(master), [master]);
  const packages = useMemo(() => packageComparison(master), [master]);
  const max = Math.max(1, ...unique.map((u) => u.value));
  const overall = useMemo(() => new Set(master.map((r) => r.key)).size, [master]);
  const withData = unique.filter((u) => u.value > 0).length;

  return (
    <section>
      <div className="stats">
        <div className="card stat"><span>{master.length.toLocaleString()}</span>Master rows</div>
        <div className="card stat"><span>{withData}</span>Colleges with data</div>
        <div className="card stat"><span>{overall.toLocaleString()}</span>Unique companies (overall)</div>
      </div>

      <div className="card">
        <h2>Unique companies per college</h2>
        {unique.map((u) => (
          <div className="bar-row" key={u.college}>
            <span className="bar-label">{u.college}</span>
            <div className="bar-track"><div className="bar" style={{ width: `${(u.value / max) * 100}%` }} /></div>
            <strong className="bar-value">{u.value}</strong>
          </div>
        ))}
      </div>

      <div className="card">
        <h2>Package comparison <small>(colleges that report CTC)</small></h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>College</th><th className="num">Rows with CTC</th><th className="num">Average (LPA)</th><th className="num">Highest (LPA)</th></tr>
            </thead>
            <tbody>
              {packages.map((p) => (
                <tr key={p.college}>
                  <td>{p.college}</td>
                  <td className="num">{p.rows || '–'}</td>
                  <td className={`num ${p.avg == null ? 'muted' : ''}`}>{p.avg == null ? 'not reported' : p.avg.toFixed(1)}</td>
                  <td className="num">{p.max == null ? '–' : p.max.toFixed(1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="muted small">Average is weighted by student count. Text packages such as internship stipends are not counted as CTC.</p>
      </div>
    </section>
  );
}
