import { useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import { COLLEGES, sortYears } from '../data';

const PAGE_SIZE = 100;
const dash = (v) => (v === null || v === undefined || v === '' ? '–' : v);
const fmtCtc = (v) => (v == null ? '–' : Number(v.toFixed(2)));

export default function MasterPage({ master }) {
  const [college, setCollege] = useState('');
  const [year, setYear] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);

  const years = useMemo(() => sortYears(new Set(master.map((r) => r.year))), [master]);

  // Colleges sorted alphabetically (case-insensitive)
  const collegeNames = useMemo(
    () => Object.keys(COLLEGES).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' })),
    []
  );

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return master.filter((r) =>
      (!college || r.college === college) &&
      (!year || r.year === year) &&
      (!q || r.company.toLowerCase().includes(q)));
  }, [master, college, year, search]);

  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const shown = rows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const onFilter = (set) => (e) => { set(e.target.value); setPage(0); };

  const download = () => {
    const data = rows.map((r) => ({
      College: r.college, Year: r.year, Department: r.dept || '', Company: r.company,
      'Student count': r.count ?? '', 'CTC (LPA)': r.ctc == null ? '' : Number(r.ctc.toFixed(2)),
    }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data), 'Master');
    XLSX.writeFile(wb, 'master_sheet.xlsx');
  };

  return (
    <section>
      <div className="toolbar">
        <select value={college} onChange={onFilter(setCollege)}>
          <option value="">All colleges</option>
          {collegeNames.map((c) => <option key={c}>{c}</option>)}
        </select>
        <select value={year} onChange={onFilter(setYear)}>
          <option value="">All years</option>
          {years.map((y) => <option key={y}>{y}</option>)}
        </select>
        <input type="search" placeholder="Search company…" value={search} onChange={onFilter(setSearch)} />
        <span className="muted grow">{rows.length.toLocaleString()} rows</span>
        <button className="btn" onClick={download} disabled={!rows.length}>Download .xlsx</button>
      </div>

      <div className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th>College</th><th>Year</th><th>Department</th><th>Company</th>
              <th className="num">Student count</th><th className="num">CTC (LPA)</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r, i) => (
              <tr key={i}>
                <td>{r.college}</td>
                <td className={r.year === 'Not specified' ? 'muted' : ''}>{r.year}</td>
                <td>{dash(r.dept)}</td>
                <td>{r.company}</td>
                <td className="num">{dash(r.count)}</td>
                <td className="num">{fmtCtc(r.ctc)}</td>
              </tr>
            ))}
            {!shown.length && <tr><td colSpan="6" className="muted center">No data to show.</td></tr>}
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