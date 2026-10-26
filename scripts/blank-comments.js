/*
 * Blank free-text comments that could identify a participant, before the data are committed.
 *
 * WHY: the repository is public, and the course guide says: "Read the free-text columns first
 * and blank anything a participant typed that could identify them." For Pilot B, two
 * comments contained personal health and medical-history details, so they are replaced by
 * the text below. The originals are still in Firebase; only the committed copies are changed.
 *
 * WHAT IT CHANGES: the "comments" answer of the feedback_text trial, for the participant ids
 * listed in IDS, in trials.csv and export.json. Nothing else is touched.
 *
 * USE (run after `npm run export`, before `git add`):
 *   node scripts/blank-comments.js osborne2026-pilot-b
 */
const fs = require("fs");
const path = require("path");

const EXPERIMENT = process.argv[2];
if (!EXPERIMENT) { console.error("Usage: node scripts/blank-comments.js <experiment-id>"); process.exit(1); }

// Participants whose comment contained identifying personal details (read manually).
const IDS = [
  "1pR79w9UCRhYxqySWNEpkYQPaI72-b8aec5e9",
  "wMpAJumcoghEC2YS3w9o7HHTpEm1-fb98fb72",
];
const REPLACEMENT = "[removed: personal details]";
const dir = path.join(__dirname, "..", "data", "raw", EXPERIMENT);

// ---- export.json: participants[].trials[] with response = { comments: "..." } ----
const jsonPath = path.join(dir, "export.json");
const data = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
let n = 0;
for (const p of data.participants) {
  if (!IDS.includes(p.participant_id)) continue;
  for (const t of p.trials) {
    if (t.task === "feedback_text" && t.response && t.response.comments) {
      t.response.comments = REPLACEMENT; n++;
    }
  }
}
fs.writeFileSync(jsonPath, JSON.stringify(data, null, 2));
console.log(`export.json: ${n} comment(s) blanked`);

// ---- trials.csv: the response column holds JSON text like {"comments":"..."} ----
const csvPath = path.join(dir, "trials.csv");
const lines = fs.readFileSync(csvPath, "utf8");
// Parse the CSV with a minimal state machine (handles quoted commas and doubled quotes).
function parse(text) {
  const rows = []; let row = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i+1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c; }
    else if (c === '"') q = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
    else if (c !== "\r") cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}
const rows = parse(lines);
const h = rows[0], iId = h.indexOf("participant_id"), iTask = h.indexOf("task"), iResp = h.indexOf("response");
let m = 0;
for (const r of rows.slice(1)) {
  if (IDS.includes(r[iId]) && r[iTask] === "feedback_text") {
    r[iResp] = JSON.stringify({ comments: REPLACEMENT }); m++;
  }
}
const esc = (v) => /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
fs.writeFileSync(csvPath, rows.map((r) => r.map(esc).join(",")).join("\n") + "\n");
console.log(`trials.csv: ${m} comment(s) blanked`);
