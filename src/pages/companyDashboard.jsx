import { Fragment, useMemo, useState } from 'react';
import { COLLEGES, buildCompanies } from '../data';

const PAGE_SIZE = 50;
const SORTS = [
  ['colleges', 'Most colleges'],
  ['students', 'Most students'],
  ['ctc', 'Highest CTC'],
  ['name', 'Name (A–Z)'],
];

/* ---- text helpers: every one returns null when the college does not report that item ---- */
const fmt = (n) => Number(n.toFixed(2));
const yearsText = (years) =>
  !years.length ? null : years.length <= 3 ? years.join(', ') : `${years[0]} to ${years[years.length - 1]} (${years.length} years)`;
const studentsText = (n) => (n == null ? null : `${n} student${n === 1 ? '' : 's'}`);
const ctcText = (min, max) =>
  max == null ? null : min === max ? `${fmt(max)} LPA` : `${fmt(min)} to ${fmt(max)} LPA`;

export default function CompanyDashboard({ master }) {
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState([]); // colleges chosen in the picker
  const [match, setMatch] = useState('any'); // any | all
  const [multiOnly, setMultiOnly] = useState(false);
  const [dataOnly, setDataOnly] = useState(false);
  const [sort, setSort] = useState('colleges');
  const [page, setPage] = useState(0);
  const [open, setOpen] = useState(() => new Set());

  const companies = useMemo(() => buildCompanies(master), [master]);
  const available = useMemo(() => {
    const have = new Set(master.map((r) => r.college));
    return Object.keys(COLLEGES).filter((c) => have.has(c));
  }, [master]);

  const list = useMemo(() => {
    const q = search.trim().toLowerCase();
    const has = (c, name) => c.colleges.some((b) => b.college === name);
    const out = companies.filter((c) =>
      (!q || c.name.toLowerCase().includes(q)) &&
      (!multiOnly || c.collegeCount >= 2) &&
      (!dataOnly || c.students != null || c.maxCtc != null) &&
      (!selected.length || (match === 'all' ? selected.every((s) => has(c, s)) : selected.some((s) => has(c, s)))));

    const value = { colleges: (c) => c.collegeCount, students: (c) => c.students, ctc: (c) => c.maxCtc }[sort];
    return out.sort((a, b) =>
      sort === 'name'
        ? a.name.localeCompare(b.name)
        : (value(b) ?? -1) - (value(a) ?? -1) || b.collegeCount - a.collegeCount || a.name.localeCompare(b.name));
  }, [companies, search, selected, match, multiOnly, dataOnly, sort]);

  const pages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
  const shown = list.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const commonCount = useMemo(() => companies.filter((c) => c.collegeCount >= 2).length, [companies]);
  const showExtra = sort === 'students' || sort === 'ctc';

  const change = (set) => (value) => { set(value); setPage(0); };
  const toggleCollege = (name) => {
    setSelected((s) => (s.includes(name) ? s.filter((x) => x !== name) : [...s, name]));
    setPage(0);
  };
  const toggleOpen = (key) =>
    setOpen((s) => { const n = new Set(s); n.has(key) ? n.delete(key) : n.add(key); return n; });

  return (
    <section>
      <div className="toolbar">
        <input type="search" placeholder="Search company…" value={search} onChange={(e) => change(setSearch)(e.target.value)} />

        <details className="picker">
          <summary className="btn">{selected.length ? `Colleges (${selected.length})` : 'All colleges'}</summary>
          <div className="picker-menu card">
            {available.map((c) => (
              <label key={c}><input type="checkbox" checked={selected.includes(c)} onChange={() => toggleCollege(c)} /> {c}</label>
            ))}
            {!available.length && <span className="muted">No colleges loaded</span>}
            {selected.length > 0 && <button className="btn" onClick={() => change(setSelected)([])}>Clear</button>}
          </div>
        </details>

        {selected.length > 1 && (
          <select value={match} onChange={(e) => change(setMatch)(e.target.value)}>
            <option value="any">Recruits at any of these</option>
            <option value="all">Recruits at all of these</option>
          </select>
        )}

        <label className="check"><input type="checkbox" checked={multiOnly} onChange={(e) => change(setMultiOnly)(e.target.checked)} /> 2+ colleges</label>
        <label className="check"><input type="checkbox" checked={dataOnly} onChange={(e) => change(setDataOnly)(e.target.checked)} /> Has student / CTC data</label>

        <span className="grow" />
        <select value={sort} onChange={(e) => change(setSort)(e.target.value)} aria-label="Sort by">
          {SORTS.map(([v, label]) => <option key={v} value={v}>Sort: {label}</option>)}
        </select>
      </div>

      <p className="muted small summary-line">
        {list.length.toLocaleString()} of {companies.length.toLocaleString()} companies · {commonCount.toLocaleString()} recruit at 2+ colleges
      </p>

      <div className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th>Company</th>
              <th>Recruits at</th>
              {showExtra && <th className="num">{sort === 'students' ? 'Total students' : 'Highest CTC (LPA)'}</th>}
            </tr>
          </thead>
          <tbody>
            {shown.map((c) => {
              const isOpen = open.has(c.key);
              return (
                <Fragment key={c.key}>
                  <tr className="clickable" onClick={() => toggleOpen(c.key)}>
                    <td>
                      <button className="chev-btn" aria-expanded={isOpen} aria-label={`${isOpen ? 'Hide' : 'Show'} details for ${c.name}`}>
                        <span className={`chev ${isOpen ? 'open' : ''}`}>▸</span>
                      </button>
                      {c.name}
                    </td>
                    <td>
                      <span className="badge">{c.collegeCount} college{c.collegeCount === 1 ? '' : 's'}</span>
                      <span className="chips">
                        {c.colleges.slice(0, 2).map((b) => <span className="chip" key={b.college}>{b.college}</span>)}
                        {c.collegeCount > 2 && <span className="chip more">+{c.collegeCount - 2} more</span>}
                      </span>
                    </td>
                    {showExtra && (
                      <td className="num">
                        {sort === 'students' ? (c.students ?? '–') : (c.maxCtc == null ? '–' : fmt(c.maxCtc))}
                      </td>
                    )}
                  </tr>
                  {isOpen && (
                    <tr className="detail-row">
                      <td colSpan={showExtra ? 3 : 2}>
                        <ul className="detail">
                          {c.colleges.map((b) => {
                            const parts = [yearsText(b.years), studentsText(b.students), ctcText(b.ctcMin, b.ctcMax)].filter(Boolean);
                            return (
                              <li key={b.college}>
                                <strong>{b.college}</strong>
                                <span className={parts.length ? '' : 'muted'}>{parts.length ? parts.join(' · ') : 'Listed as a recruiter'}</span>
                              </li>
                            );
                          })}
                        </ul>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
            {!shown.length && <tr><td colSpan="3" className="muted center">No companies match these filters.</td></tr>}
          </tbody>
        </table>
      </div>

      {pages > 1 && (
        <div className="pager">
          <button className="btn" onClick={() => setPage(page - 1)} disabled={page === 0}>Previous</button>
          <span className="muted">Page {page + 1} of {pages}</span>
          <button className="btn" onClick={() => setPage(page + 1)} disabled={page >= pages - 1}>Next</button>
        </div>
      )}
    </section>
  );
}