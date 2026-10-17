// All college-specific logic lives here: importers (sheets -> rows), company cleaning,
// the master-sheet builder and the insight calculations. No Excel/Supabase code in this file,
// so it can be tested on its own.
//
// "sheets" is an object { 'file.xlsx›Sheet name': rows[][] }  (rows = array of arrays, header first)

export const COLLEGES = {
  'Aravali College': 'One file per year (22–26): Student Name | Company',
  'Bharti Vidyapeeth': 'One sheet: Sr. No. | Company (no year)',
  'Dhole Patil': 'Workbook per year: student sheet + department company lists',
  JSPM: 'Sheet per batch: Company | Count | Package (LPA)',
  SIT: 'Sheet per program/year (e.g. B.Tech 2025): Company only',
  AIT: 'One workbook, sheet per year (2025-26): Name/Firm | one column per department | CTC last. Summary ignored',
  Cummins: 'One workbook, sheet per year (2025-26): Company | Count | CTC. Summary sheet ignored',
  'DYP DPU': 'Sheets "Prominent Placement 2025-26": Name | Branch | Company | Package. "... Cleaned" sheets ignored',
  'MIT WPU': 'One sheet, one column "Companies" (no year)',
  PCCOE: 'One workbook, one sheet: Company | Salary',
};

export const NOT_SPECIFIED = 'Not specified';

/* ---------------------------------------------------------------- helpers */
const tidy = (s) => String(s ?? '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
const companyBase = (s) =>
  tidy(s).toLowerCase().replace(/\b(ltd|limited|pvt|private|inc|llp)\b/g, '').replace(/[^a-z0-9]/g, '');

const col = (rows, re) => (rows[0] || []).findIndex((h) => re.test(String(h)));
const yr = (y) => `${y}-${String((+y + 1) % 100).padStart(2, '0')}`;
const range = (s) => {
  const m = String(s).match(/(20\d{2})\s*[-–]\s*(\d{2})/);
  return m ? `${m[1]}-${m[2]}` : null;
};
const num = (v) => (v === '' || v == null || isNaN(+v) ? null : +v);
const sheetOf = (k) => String(k).split('›').pop(); // keys look like "file›sheet"
const isSummary = (k) => /summary/i.test(sheetOf(k));
const isNote = (v) => /^\s*note\b/i.test(String(v ?? ''));
const mk = (o) => ({ year: NOT_SPECIFIED, dept: '', raw: '', count: null, ctc: null, agg: false, ...o });

// Package cell -> LPA number, or null when it is not a yearly CTC.
//   10, "12.5*"                   -> number as is
//   "18 (Spread in 2 Year)"       -> 18 / 2 = 9      (same treatment as the "Cleaned" sheets)
//   "24L for 3 years"             -> 24 / 3 = 8
//   internships, stipends, AED... -> null
const PKG = /^(\d+(?:\.\d+)?)\s*(?:lpa|lac|lakh|l)?\s*\*?\s*(?:\(?\s*(?:spread\s*in|for)\s*(\d+)\s*years?\s*\)?)?$/i;
export const pkg = (v) => {
  if (typeof v === 'number') return v;
  const m = tidy(v).match(PKG);
  if (!m) return null;
  return m[2] ? +m[1] / +m[2] : +m[1];
};

/* ----------------------------------------------------- company cleaning */
const ALIAS = {}; // companyBase(variant) -> canonical name
const DISPLAY = {}; // companyBase(canonical) -> canonical name
[
  ['TCS', 'tcs', 'tata consultancy services'],
  ['Infosys', 'infosys'],
  ['Wipro', 'wipro'],
  ['Cognizant', 'cognizant', 'cts'],
  ['Capgemini', 'capgemini'],
  ['Accenture', 'accenture'],
  ['Persistent', 'persistent systems'],
  ['Tech Mahindra', 'tech mahindra', 'techm'],
  ['Zensar', 'zensar'],
  ['KPIT', 'kpit'],
].forEach(([c, ...a]) => {
  DISPLAY[companyBase(c)] = c;
  a.forEach((x) => (ALIAS[companyBase(x)] = c));
});

// Key that identifies "the same company" regardless of case, spaces, hyphens or aliases.
const ck = (raw) => {
  const k = companyBase(raw);
  return ALIAS[k] ? companyBase(ALIAS[k]) : k;
};
const shouting = (s) => (s.length > 4 && s === s.toUpperCase() ? 1 : 0);

/* ----------------------------------------------------------- importers */
const companyList = (S) =>
  Object.values(S).flatMap((rows) => {
    const c = col(rows, /compan/i);
    if (c < 0) return [];
    return rows.slice(1).filter((r) => r[c]).map((r) => mk({ raw: String(r[c]) }));
  });

const IMPORTERS = {
  // year comes from the file name (22 -> 2022-23); one row per student
  'Aravali College': (S) =>
    Object.entries(S).flatMap(([k, rows]) => {
      const m = k.split('›')[0].match(/(\d{4}|\d{2})/);
      if (!m) return [];
      const y = yr(+m[1] < 100 ? 2000 + +m[1] : +m[1]);
      const c = col(rows, /company/i);
      if (c < 0) return [];
      return rows.slice(1).filter((r) => r[c]).map((r) => mk({ year: y, raw: String(r[c]), count: 1, agg: true }));
    }),

  'Bharti Vidyapeeth': companyList,

  // student sheets only; department company lists are skipped to avoid double counting
  'Dhole Patil': (S) =>
    Object.entries(S).flatMap(([k, rows]) => {
      const c = col(rows, /company/i), st = col(rows, /student/i), y = (k.match(/(20\d{2})/) || [])[1];
      if (c < 0 || st < 0 || !y) return [];
      const b = col(rows, /branch/i), t = col(rows, /ctc/i);
      return rows.slice(1).filter((r) => r[c]).map((r) =>
        mk({ year: yr(y), dept: b >= 0 ? String(r[b]) : '', raw: String(r[c]), count: 1, ctc: t >= 0 ? pkg(r[t]) : null, agg: true }));
    }),

  JSPM: (S) =>
    Object.entries(S).flatMap(([k, rows]) => {
      const y = range(sheetOf(k));
      if (!y) return [];
      const c = col(rows, /company/i), n = col(rows, /count/i), p = col(rows, /package|ctc|lpa/i);
      if (c < 0) return [];
      return rows.slice(1).filter((r) => r[c]).map((r) => mk({ year: y, raw: String(r[c]), count: num(r[n]), ctc: p >= 0 ? pkg(r[p]) : null }));
    }),

  SIT: (S) =>
    Object.entries(S).flatMap(([k, rows]) => {
      const m = k.match(/([BM]\.?\s?Tech)\s*(\d{4})/i);
      if (!m) return [];
      const c = col(rows, /company/i);
      if (c < 0) return [];
      return rows.slice(1).filter((r) => r[c]).map((r) => mk({ year: yr(m[2]), raw: String(r[c]) }));
    }),

  // Sheet per year. Company, then one column per department holding a count, CTC in the last column.
  // One row per company x department with a non-zero count.
  AIT: (S) =>
    Object.entries(S).flatMap(([k, rows]) => {
      const y = range(sheetOf(k));
      if (!y || isSummary(k) || rows.length < 2) return [];
      const c = col(rows, /name|firm|company/i);
      if (c < 0) return [];
      const last = rows[0].length - 1;
      const depts = rows[0].map((h, i) => [String(h).trim(), i])
        .filter(([h, i]) => h && i !== c && i !== last && !/^(total|sr\.?|s\.?\s?no\.?|sl\.?)/i.test(h));
      return rows.slice(1).filter((r) => r[c] && !/^total$/i.test(String(r[c]).trim())).flatMap((r) => {
        const ctc = pkg(r[last]), raw = String(r[c]);
        const hits = depts.map(([h, i]) => [h, num(r[i])]).filter(([, n]) => n > 0);
        return hits.length ? hits.map(([h, n]) => mk({ year: y, dept: h, raw, count: n, ctc })) : [mk({ year: y, raw, ctc })];
      });
    }),

  // Sheet per year: Company | Count | CTC   (the "Summary" sheet is skipped)
  Cummins: (S) =>
    Object.entries(S).flatMap(([k, rows]) => {
      const y = range(sheetOf(k));
      if (!y || isSummary(k) || rows.length < 2) return [];
      const c = col(rows, /name|firm|company/i);
      if (c < 0) return [];
      let n = col(rows, /student|count|^\s*no/i);
      const p0 = col(rows, /ctc|package|lpa|salary/i);
      const p = p0 >= 0 ? p0 : rows[0].length - 1;
      if (n === c) n = -1;
      return rows.slice(1).filter((r) => r[c] && !/^total$/i.test(String(r[c]).trim()))
        .map((r) => mk({ year: y, raw: String(r[c]), count: n >= 0 ? num(r[n]) : null, ctc: pkg(r[p]) }));
    }),

  // Student-level rows, only from the "Prominent Placement(s) <year>" sheets.
  // The "<year> Cleaned" sheets are the same data already aggregated, so they are ignored.
  'DYP DPU': (S) =>
    Object.entries(S).flatMap(([k, rows]) => {
      const name = sheetOf(k);
      const y = range(name);
      if (!/prominent/i.test(name) || !y || rows.length < 2) return [];
      const c = col(rows, /company/i);
      if (c < 0) return [];
      const b = col(rows, /branch/i), p = col(rows, /package|ctc|lpa|salary/i);
      return rows.slice(1).filter((r) => r[c] && !r.some(isNote)).map((r) =>
        mk({ year: y, dept: b >= 0 ? String(r[b] ?? '') : '', raw: String(r[c]), count: 1, ctc: p >= 0 ? pkg(r[p]) : null, agg: true }));
    }),

  'MIT WPU': companyList,

  PCCOE: (S) =>
    Object.values(S).flatMap((rows) => {
      const c = col(rows, /compan/i), p = col(rows, /salary|ctc|package|lpa/i);
      if (c < 0) return [];
      return rows.slice(1).filter((r) => r[c]).map((r) => mk({ raw: String(r[c]), ctc: p >= 0 ? pkg(r[p]) : null }));
    }),
};

/* ------------------------------------------------ which college is a file? */
const FOLDER_ALIAS = { aravali: 'Aravali College', bharti: 'Bharti Vidyapeeth', dhole: 'Dhole Patil', dyp: 'DYP DPU', mit: 'MIT WPU' };

// 1) folder name in the bucket (e.g. "JSPM/" or "DYP_DPU/"), 2) what is inside the workbook.
export function detectCollege(folder, sheets) {
  const f = norm(folder || '');
  if (f) {
    const hit = Object.keys(COLLEGES).find((c) => norm(c) === f) || FOLDER_ALIAS[f];
    if (hit) return hit;
  }
  const entries = Object.entries(sheets);
  const summaryText = entries.filter(([k]) => isSummary(k)).flatMap(([, rows]) => rows.slice(0, 3).flat()).join(' ');
  if (/cummins/i.test(summaryText)) return 'Cummins';
  if (entries.some(([k]) => /prominent placement/i.test(sheetOf(k)))) return 'DYP DPU';
  return null;
}

/* ----------------------------------------------------------- master sheet */
// Raw importer rows for one college. Student-level rows are grouped into one row per
// year / department / company with a student count and the average CTC.
export function convert(college, sheets) {
  const out = [], groups = {};
  IMPORTERS[college](sheets).forEach((r) => {
    const o = { college, ...r, raw: tidy(r.raw), dept: tidy(r.dept) };
    if (!o.raw) return;
    if (!r.agg) return out.push(o);
    const key = [o.year, o.dept, ck(o.raw)].join('|');
    if (!groups[key]) { groups[key] = { ...o, count: 0, _c: [] }; out.push(groups[key]); }
    groups[key].count++;
    if (r.ctc != null) groups[key]._c.push(r.ctc);
  });
  out.forEach((o) => {
    if (o._c) {
      o.ctc = o._c.length ? o._c.reduce((a, b) => a + b, 0) / o._c.length : null;
      delete o._c;
    }
  });
  return out;
}

const collegeOrder = Object.keys(COLLEGES);
const byYearDesc = (a, b) => (a === b ? 0 : a === NOT_SPECIFIED ? 1 : b === NOT_SPECIFIED ? -1 : a < b ? 1 : -1);

// Rows from all colleges -> final master rows. Spelling variants of one company
// (ACA GLOBAL / ACA Global, "7- Eleven" / "7-Eleven") get a single display name.
export function buildMaster(rows) {
  const variants = {};
  rows.forEach((r) => {
    const k = ck(r.raw);
    variants[k] ??= {};
    variants[k][r.raw] = (variants[k][r.raw] || 0) + 1;
  });
  const display = {};
  Object.entries(variants).forEach(([k, v]) => {
    display[k] = DISPLAY[k] ||
      Object.entries(v).sort((a, b) => b[1] - a[1] || shouting(a[0]) - shouting(b[0]))[0][0];
  });
  return rows
    .map((r) => ({ college: r.college, year: r.year, dept: r.dept, company: display[ck(r.raw)], count: r.count, ctc: r.ctc, key: ck(r.raw) }))
    .sort((a, b) =>
      collegeOrder.indexOf(a.college) - collegeOrder.indexOf(b.college) ||
      byYearDesc(a.year, b.year) ||
      a.company.localeCompare(b.company) ||
      a.dept.localeCompare(b.dept));
}

export const sortYears = (years) => [...years].sort(byYearDesc);

/* --------------------------------------------------------------- insights */
export const uniqueCompaniesByCollege = (master) =>
  collegeOrder.map((college) => ({
    college,
    value: new Set(master.filter((r) => r.college === college).map((r) => r.key)).size,
  }));

// Average is weighted by student count (a row without a count counts as 1).
export const packageComparison = (master) =>
  collegeOrder.map((college) => {
    const rows = master.filter((r) => r.college === college && r.ctc != null);
    const weight = rows.reduce((s, r) => s + (r.count || 1), 0);
    return {
      college,
      rows: rows.length,
      avg: weight ? rows.reduce((s, r) => s + r.ctc * (r.count || 1), 0) / weight : null,
      max: rows.length ? Math.max(...rows.map((r) => r.ctc)) : null,
    };
  });

/* -------------------------------------------------------- company roll-up */
// One entry per unique company across all colleges. Each college inside it only carries
// what that college actually reports: years, student count and CTC are null/empty when absent,
// so a names-only college is just { college, rows } with nothing else filled in.
export function buildCompanies(master) {
  const map = {};
  master.forEach((r) => {
    const c = (map[r.key] ??= { key: r.key, name: r.company, byCollege: {} });
    const b = (c.byCollege[r.college] ??= { college: r.college, rows: 0, years: new Set(), students: null, ctcMin: null, ctcMax: null });
    b.rows++;
    if (r.year !== NOT_SPECIFIED) b.years.add(r.year);
    if (r.count != null) b.students = (b.students ?? 0) + r.count;
    if (r.ctc != null) {
      b.ctcMin = b.ctcMin == null ? r.ctc : Math.min(b.ctcMin, r.ctc);
      b.ctcMax = b.ctcMax == null ? r.ctc : Math.max(b.ctcMax, r.ctc);
    }
  });

  return Object.values(map).map((c) => {
    const colleges = Object.values(c.byCollege)
      .map((b) => ({ ...b, years: [...b.years].sort() })) // oldest -> newest
      .sort((a, b) => collegeOrder.indexOf(a.college) - collegeOrder.indexOf(b.college));
    const reported = colleges.filter((b) => b.students != null);
    const ctcs = colleges.filter((b) => b.ctcMax != null).map((b) => b.ctcMax);
    return {
      key: c.key,
      name: c.name,
      colleges,
      collegeCount: colleges.length,
      students: reported.length ? reported.reduce((s, b) => s + b.students, 0) : null, // null = nobody reports it
      maxCtc: ctcs.length ? Math.max(...ctcs) : null,
    };
  });
}