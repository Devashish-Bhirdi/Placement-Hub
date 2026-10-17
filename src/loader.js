// Reads every Excel file in the Supabase bucket, works out which college each file belongs to,
// and returns the master sheet.
import * as XLSX from 'xlsx';
import { supabase, BUCKET } from './supabaseClient';
import { buildMaster, convert, detectCollege } from './data';

// Lists .xlsx/.xls files, going into folders (up to 2 levels deep).
async function listFiles(bucket, prefix = '', depth = 0) {
  const { data, error } = await bucket.list(prefix, { limit: 1000, sortBy: { column: 'name', order: 'asc' } });
  if (error) throw error;
  const out = [];
  for (const item of data || []) {
    if (item.name.startsWith('.') || item.name.startsWith('~$')) continue;
    const path = prefix ? `${prefix}/${item.name}` : item.name;
    if (item.id === null) {
      if (depth < 2) out.push(...(await listFiles(bucket, path, depth + 1)));
    } else if (/\.xlsx?$/i.test(item.name)) {
      out.push({ path, name: item.name, folder: path.includes('/') ? path.split('/')[0] : '' });
    }
  }
  return out;
}

// Public bucket -> plain fetch. Private bucket -> authenticated download().
async function fetchBytes(bucket, path) {
  try {
    const res = await fetch(bucket.getPublicUrl(path).data.publicUrl);
    if (res.ok) return await res.arrayBuffer();
  } catch { /* fall through to download() */ }
  const { data, error } = await bucket.download(path);
  if (error) throw error;
  return await data.arrayBuffer();
}

function readWorkbook(buffer, fileName) {
  const wb = XLSX.read(buffer, { type: 'array' });
  const sheets = {};
  wb.SheetNames.forEach((name) => {
    sheets[`${fileName}›${name}`] = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '' });
  });
  return sheets;
}

export async function loadMaster() {
  if (!supabase) throw new Error('Supabase is not configured. Copy .env.example to .env and fill in the values, then restart npm run dev.');
  const bucket = supabase.storage.from(BUCKET);

  const files = await listFiles(bucket);
  const skipped = [];
  const byCollege = {};

  for (const f of files) {
    try {
      const sheets = readWorkbook(await fetchBytes(bucket, f.path), f.name);
      const college = detectCollege(f.folder, sheets);
      if (!college) { skipped.push({ file: f.path, reason: 'Could not tell which college this is. Put it in a folder named after the college.' }); continue; }
      Object.assign((byCollege[college] ??= { files: [], sheets: {} }).sheets, sheets);
      byCollege[college].files.push(f.path);
    } catch (e) {
      skipped.push({ file: f.path, reason: e.message || String(e) });
    }
  }

  const rows = [];
  for (const [college, { sheets }] of Object.entries(byCollege)) {
    try { rows.push(...convert(college, sheets)); }
    catch (e) { skipped.push({ file: college, reason: `Layout not understood: ${e.message}` }); }
  }

  return {
    master: buildMaster(rows),
    fileCount: files.length,
    colleges: Object.keys(byCollege),
    skipped,
  };
}
