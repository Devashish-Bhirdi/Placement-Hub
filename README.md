# Placement Dashboard

React + Vite app. Excel files live in a Supabase Storage bucket; the app reads them, builds one
**master sheet** and shows **insights**. There is no upload in the app: add or replace files in the
Supabase dashboard (Storage → your bucket), then press **Refresh** in the app.

## 1. Setup

```bash
npm install
cp .env.example .env      # then fill in the 3 values
npm run dev
```

If `npm install` fails on the `xlsx` line (it points to SheetJS's own CDN), run `npm install xlsx` instead; the code works with either.

`.env` values (Supabase dashboard → Project Settings → API / Data API):

| Variable | Value |
|---|---|
| `VITE_SUPABASE_URL` | Project URL, e.g. `https://abcd1234.supabase.co` (no `/rest/v1/`) |
| `VITE_SUPABASE_ANON_KEY` | anon / publishable key (never the service_role key) |
| `VITE_SUPABASE_BUCKET` | your bucket name |

Restart `npm run dev` after editing `.env`.

## 2. Allow the app to list files

Even for a public bucket, listing files needs a policy. Supabase → SQL Editor → run
(replace `placements` with your bucket name):

```sql
create policy "read placement files"
on storage.objects for select
using (bucket_id = 'placements');
```

When you make the bucket private and add login later, change `using (...)` to
`using (bucket_id = 'placements' and auth.role() = 'authenticated')`.

## 3. How files are matched to colleges

1. **Folder name** in the bucket wins: `JSPM/…`, `Cummins/…`, `DYP_DPU/…`, `Aravali College/…` (any of the college names in `src/data.js`).
2. Files at the bucket root are recognised by their content. Currently: the Cummins workbook (its Summary sheet mentions Cummins) and the DYP DPU workbook (sheets named "Prominent Placement …").
3. Anything else is listed under **Skipped** at the top of the page. Put it in a folder named after the college.

Colleges with several files (Aravali: one file per year) must be in one folder.

## 4. Project layout

| File | Purpose |
|---|---|
| `src/data.js` | Everything college-specific: importers, company-name cleaning, master builder, insight calculations |
| `src/loader.js` | Lists/downloads files from Supabase, parses them with SheetJS |
| `src/supabaseClient.js` | Supabase client from `.env` |
| `src/pages/MasterPage.jsx` | Master table with filters, search, pagination, Excel export |
| `src/pages/InsightsPage.jsx` | Unique companies per college, package comparison |

To support a new layout, add one function to `IMPORTERS` in `src/data.js` (and a name in `COLLEGES`).

## 5. Data rules used

- **DYP DPU:** only `Prominent Placement <year>` sheets are read (the `<year> Cleaned` sheets are the same data pre-aggregated). Students are grouped into one row per year / branch / company with a count and average CTC.
- **Cummins:** one row per company row in each year sheet. The Summary sheet is skipped. A company can appear several times in a year with different CTCs, as in the source.
- **CTC text:** `12.5*` → 12.5, `18 (Spread in 2 Year)` → 9, `24L for 3 years` → 8. Internship stipends, AED amounts, etc. are not CTC and show as –.
- **Company names:** case, spacing, hyphens and non-breaking spaces are ignored when matching, so `ACA GLOBAL` and `ACA Global` count as one company. Add known aliases (e.g. TCS) in `src/data.js`.
- **Average CTC** in Insights is weighted by student count.
