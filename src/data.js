// All college-specific logic lives here: importers (sheets -> rows), company cleaning,
// the master-sheet builder and the insight calculations. No Excel/Supabase code in this file,
// so it can be tested on its own.
//
// "sheets" is an object { 'file.xlsx›Sheet name': rows[][] }  (rows = array of arrays, header first)

export const COLLEGES = {
  'Aravali College': 'One file per year (22–26): Student Name | Company',
  'Bharti Vidyapeeth': 'One sheet: Sr. No. | Company (no year)',
  'Dhole Patil': 'One file per year (2023-24_...xlsx): sheet "student data" / "student record" with Name | Branch | Company | Package. Company Count and department company lists are ignored',
  JSPM: 'Sheets "Batch 2025-26": Company | Students | Package in LPA. The "5 Years of Placement Excellence" summary sheet is ignored',
  SIT: 'Sheet per program/year (e.g. B.Tech 2025): Company only',
  AIT: 'One workbook, sheet per year (2025-26): Sr No | Name of the Firm | one count column per department | Total | CTC. Summary sheet ignored',
  Cummins: 'One workbook, sheet per year (2025-26): Company | Count | CTC. Summary sheet ignored',
  'DYP DPU': 'Sheets "Prominent Placement 2025-26": Name | Branch | Company | Package. "... Cleaned" sheets ignored',
  'MIT WPU': 'One sheet, one column "Companies" (no year)',
  'MIT Alandi': 'Sheet "Placement & Internships": Full Name | Degree | Specializations | Name of Company | Salary Offered (no year). "Company Count" sheet ignored',
  PCCOE: 'One sheet: Company Name | Type | Package (LPA) | Total students recruited (no year)',
  'Canara College': 'One sheet: Company Name | Type | Package (LPA) | Total students recruited (no year)',
  'IIIT Pune': 'One sheet, one column "Company" (no year)',
  NMIET: 'One sheet: Company | CTC (no year, no student count)',
};

export const NOT_SPECIFIED = 'Not specified';

/* ---------------------------------------------------------------- helpers */
const tidy = (s) => String(s ?? '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
// "Bharat Forge Limited, Baramati" -> "Bharat Forge"; "Duroshox Private Limited Pune" -> "Duroshox";
// "LG pvt ltd, Pune" -> "LG", "TCS (Ninja / Digital / Prime)" -> "TCS". Everything after a comma, a bracket
// or a legal suffix (Pvt / Ltd / Limited ...) is dropped.
const cleanName = (s) => {
  let t = tidy(s).split(',')[0];
  const br = t.indexOf('(');
  if (br > 0) t = t.slice(0, br);
  const m = t.search(/\b(pvt|private|ltd|limited|llp|inc|opc)\b/i);
  if (m > 0) t = t.slice(0, m);
  return t.replace(/[\s.\-&]+$/, '').trim() || tidy(s);
};
const companyBase = (s) => cleanName(s).toLowerCase().replace(/[^a-z0-9]/g, '');

// Same department spelled differently across colleges -> one name
// (Comp / Computer Engineering, E&TC / ENTC, Mech / Mechanical Engineering, Civil Engg. ...)
const DEPT = {
  comp: 'Computer', computer: 'Computer', cse: 'Computer', computerscience: 'Computer',
  it: 'IT', informationtechnology: 'IT',
  etc: 'ENTC', entc: 'ENTC', electronicstelecommunication: 'ENTC', electronicsandtelecommunication: 'ENTC',
  mech: 'Mechanical', mechanical: 'Mechanical',
  auto: 'Automobile', automobile: 'Automobile',
  civil: 'Civil', electrical: 'Electrical', mba: 'MBA', aids: 'AI&DS',
};
const deptName = (s) => {
  const t = tidy(s).replace(/\b(and\s+)?(engineering|engg|engineer)\b\.?/gi, '').replace(/\s+/g, ' ').trim();
  return DEPT[norm(t)] || t;
};

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
//   10, "3LPA", "4.5L", "3PLA"     -> number as is (unit text is ignored, typos included)
//   "4-6LPA", "1.44-3.0LPA"        -> middle of the range (5, 2.22)
//   "5.5 / 4.50", "3.46 / 7 / 9"   -> several tiers for one company: average of them (5, 6.49)
//   "12.5*"                        -> 12.5
//   "18 (Spread in 2 Year)"        -> 18 / 2 = 9      (same treatment as the "Cleaned" sheets)
//   "24L for 3 years"              -> 24 / 3 = 8
//   internships, stipends, AED...  -> null
const PKG = /^(\d+(?:\.\d+)?)(?:\s*[-–]\s*(\d+(?:\.\d+)?))?\s*(?:lpa|pla|lac|lakh|l)?\s*\*?\s*(?:\(?\s*(?:spread\s*in|for)\s*(\d+)\s*years?\s*\)?)?$/i;
const pkgOne = (text) => {
  const m = text.match(PKG);
  if (!m) return null;
  const amount = m[2] ? (+m[1] + +m[2]) / 2 : +m[1];
  return m[3] ? amount / +m[3] : amount;
};
export const pkg = (v) => {
  if (typeof v === 'number') return v;
  const text = tidy(v);
  if (!text.includes('/')) return pkgOne(text);
  const tiers = text.split('/').map((p) => pkgOne(p.trim()));
  return tiers.every((t) => t != null) ? tiers.reduce((a, b) => a + b, 0) / tiers.length : null;
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
// Company-only lists (no year, count or CTC). A company written twice in the list is kept once.
const companyList = (S) => {
  const seen = new Set();
  return Object.values(S).flatMap((rows) => {
    const c = col(rows, /compan/i);
    if (c < 0) return [];
    return rows.slice(1).filter((r) => r[c]).map((r) => mk({ raw: String(r[c]) }))
      .filter((r) => { const k = ck(r.raw); return k && !seen.has(k) && seen.add(k); });
  });
};

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

  // One file per year; the year is read from the file name (2023-24_more_cleaned.xlsx).
  // Only the student sheet is read (it has a "Selected Students" column). The "Company Count" sheet is
  // derived from it and the department company lists have no counts, so both are skipped.
  'Dhole Patil': (S) =>
    Object.entries(S).flatMap(([k, rows]) => {
      const y = range(k) || ((m) => (m ? yr(m[1]) : null))(String(k).match(/(20\d{2})/));
      const c = col(rows, /company/i), st = col(rows, /student/i);
      if (c < 0 || st < 0 || !y) return [];
      const b = col(rows, /branch/i), p = col(rows, /package|ctc|lpa|salary/i);
      return rows.slice(1).filter((r) => r[c]).map((r) =>
        mk({ year: y, dept: b >= 0 ? String(r[b] ?? '') : '', raw: String(r[c]), count: 1, ctc: p >= 0 ? pkg(r[p]) : null, agg: true }));
    }),

  // Sheets "Batch 2025-26": Company | Students | Package in LPA. A company can appear on several rows in a
  // batch (one per package tier), so rows are kept as they are. A student count that is not a whole number
  // (a typo in the source) is treated as unknown.
  JSPM: (S) =>
    Object.entries(S).flatMap(([k, rows]) => {
      const y = range(sheetOf(k));
      if (!y) return [];
      const c = col(rows, /company/i), n = col(rows, /student|count/i), p = col(rows, /package|ctc|lpa/i);
      if (c < 0) return [];
      return rows.slice(1).filter((r) => r[c]).map((r) => {
        const count = n >= 0 ? num(r[n]) : null;
        return mk({ year: y, raw: String(r[c]), count: Number.isInteger(count) ? count : null, ctc: p >= 0 ? pkg(r[p]) : null });
      });
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
        // firms listed with a CTC but nobody placed (0 in every department) are kept with count 0
        return hits.length ? hits.map(([h, n]) => mk({ year: y, dept: h, raw, count: n, ctc })) : [mk({ year: y, raw, count: depts.length ? 0 : null, ctc })];
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
  'IIIT Pune': companyList,

  // One row per offer: Full Name | Degree | Specializations | Name of Company | Salary Offered. No year in the file.
  // A student with several offers appears once per company. The "Company Count" sheet is derived from this
  // sheet and has no student-name column, so it is skipped.
  'MIT Alandi': (S) =>
    Object.values(S).flatMap((rows) => {
      const st = col(rows, /full name|student/i), c = col(rows, /company/i);
      if (st < 0 || c < 0) return [];
      const d = col(rows, /special|branch/i), p = col(rows, /salary|ctc|package|lpa/i);
      return rows.slice(1).filter((r) => r[c]).map((r) =>
        mk({ dept: d >= 0 ? String(r[d] ?? '') : '', raw: String(r[c]), count: 1, ctc: p >= 0 ? pkg(r[p]) : null, agg: true }));
    }),

  // Same layout as PCCOE (Company | package; a student count column is used if there is one)
  'Canara College': (S) => IMPORTERS.PCCOE(S),
  NMIET: (S) => IMPORTERS.PCCOE(S),

  // Company | Type | Package | Total students recruited. No year in the file.
  PCCOE: (S) =>
    Object.values(S).flatMap((rows) => {
      const c = col(rows, /compan/i);
      if (c < 0) return [];
      const p = col(rows, /salary|ctc|package|lpa/i);
      let n = col(rows, /student|count|recruit|placed/i);
      if (n === c) n = -1;
      return rows.slice(1).filter((r) => r[c]).map((r) =>
        mk({ raw: String(r[c]), count: n >= 0 ? num(r[n]) : null, ctc: p >= 0 ? pkg(r[p]) : null }));
    }),
};

/* ------------------------------------------------ which college is a file? */
// Names that may appear in a folder or file name, besides the full college name.
const NAME_HINTS = [['aravali', 'Aravali College'], ['bharti', 'Bharti Vidyapeeth'], ['bharati', 'Bharti Vidyapeeth'],
  ['dhole', 'Dhole Patil'], ['dyp', 'DYP DPU'], ['mit', 'MIT WPU'], ['wpu', 'MIT WPU'], ['canara', 'Canara College'], ['iiit', 'IIIT Pune'], ['iiitp', 'IIIT Pune'],
  ['rscoe', 'JSPM'], ['rajarshi', 'JSPM'], ['mitaoe', 'MIT Alandi'], ['alandi', 'MIT Alandi'],
  ['nutan', 'NMIET']];
const words = (s) => ' ' + String(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim() + ' ';
// Longest names first, so "dyp dpu" wins over "dyp".
const NAMES = [...Object.keys(COLLEGES).map((c) => [words(c), c]), ...NAME_HINTS.map(([h, c]) => [words(h), c])]
  .sort((a, b) => b[0].length - a[0].length);
const nameMatch = (text) => (NAMES.find(([w]) => words(text).includes(w)) || [])[1] || null;

// Order: 1) folder name in the bucket, 2) file name ("AIT.xlsx", "Bharti Vidyapeeth.xlsx"),
// 3) what is inside the workbook (only possible for AIT, Cummins, DYP DPU, Dhole Patil, JSPM and MIT Alandi).
// Returns null when nothing matches; the app then lists the file as skipped.
export function detectCollege(folder, sheets) {
  const fromFolder = folder && nameMatch(folder);
  if (fromFolder) return fromFolder;

  const entries = Object.entries(sheets);
  const fileName = entries.length ? entries[0][0].split('›')[0].replace(/\.[^.]+$/, '') : '';
  const fromFile = fileName && nameMatch(fileName);
  if (fromFile) return fromFile;

  const summaryText = entries.filter(([k]) => isSummary(k)).flatMap(([, rows]) => rows.slice(0, 3).flat()).join(' ');
  if (/cummins/i.test(summaryText)) return 'Cummins';
  if (/\bAIT\b|army institute/i.test(summaryText)) return 'AIT';
  if (entries.some(([k]) => /prominent placement/i.test(sheetOf(k)))) return 'DYP DPU';
  if (entries.some(([k]) => /^batch\s*20\d{2}/i.test(sheetOf(k)))) return 'JSPM';
  if (entries.some(([, rows]) => (rows[0] || []).some((h) => /specialization/i.test(String(h))) && (rows[0] || []).some((h) => /full name/i.test(String(h))))) return 'MIT Alandi';
  if (entries.some(([, rows]) => (rows[0] || []).some((h) => /selected students/i.test(String(h))))) return 'Dhole Patil';
  return null;
}

/* ----------------------------------------------------------- master sheet */
// Raw importer rows for one college. Student-level rows are grouped into one row per
// year / department / company with a student count and the average CTC.
export function convert(college, sheets) {
  const out = [], groups = {};
  IMPORTERS[college](sheets).forEach((r) => {
    const o = { college, ...r, raw: tidy(r.raw), dept: deptName(r.dept) };
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
    const shown = cleanName(r.raw);
    variants[k][shown] = (variants[k][shown] || 0) + 1;
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
// Rows with 0 students placed are ignored: nobody received that package.
export const packageComparison = (master) =>
  collegeOrder.map((college) => {
    const rows = master.filter((r) => r.college === college && r.ctc != null && r.count !== 0);
    const weight = rows.reduce((s, r) => s + (r.count ?? 1), 0);
    return {
      college,
      rows: rows.length,
      avg: weight ? rows.reduce((s, r) => s + r.ctc * (r.count ?? 1), 0) / weight : null,
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