import { writeFileSync, mkdirSync, existsSync } from "fs";
import { execFileSync } from "child_process";
import { join } from "path";
import { guides as handGuides } from "./guides-data.mjs";
import { MODULES } from "../src/lib/modules-config";

const imgDir = "C:\\Users\\syedm\\AppData\\Local\\Temp\\opencode\\screens";
const tmpDir = "C:\\Users\\syedm\\AppData\\Local\\Temp\\opencode\\guides";
if (!existsSync(tmpDir)) mkdirSync(tmpDir, { recursive: true });

const outDir = join(process.cwd(), "..", "docs", "guides");
if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

const edge = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";

function esc(s: any) { return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }

const autoGuides = MODULES.map((m) => ({
  file: "mod-" + m.slug,
  title: m.title,
  module: "Modules Hub",
  overview: `Manage ${m.title.toLowerCase()} records. View the register and create new entries.`,
  fields: m.fields.map((f) => ({ name: f.label, type: f.type || "text", required: !!f.required, description: f.options ? `Options: ${f.options.join(", ")}` : "" })),
  steps: [
    `Open Modules hub → ${m.title}.`,
    "View existing records in the register table.",
    "Fill the create form and submit to add a new record.",
  ],
  notes: [`API endpoint: ${m.endpoint}`, `Table: ${m.table}`],
}));

const guideSet = new Map<string, any>();
for (const g of autoGuides) guideSet.set(g.file, g);
for (const g of handGuides as any[]) guideSet.set(g.file, g);
const guides = [...guideSet.values()];

for (const g of guides) {
  const htmlPath = join(tmpDir, g.file + ".html");
  const pdfPath = join(outDir, g.file + ".pdf");
  const fieldsHtml = (g.fields || []).map((f: any) => `
    <tr><td><strong>${esc(f.name)}</strong></td><td>${esc(f.type || "")}</td><td>${f.required ? "Yes" : "No"}</td><td>${esc(f.description || "")}</td></tr>`).join("");
  const stepsHtml = (g.steps || []).map((s: string, i: number) => `<li>${esc(s)}</li>`).join("");
  const notesHtml = (g.notes || []).map((n: string) => `<li>${esc(n)}</li>`).join("");
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(g.title)}</title>
<style>body{font-family:"Segoe UI",Arial,sans-serif;margin:40px;color:#27312d;line-height:1.5}h1{color:#25311f;border-bottom:3px solid #baff48;padding-bottom:8px}h2{color:#6f8c3b;margin-top:24px}table{width:100%;border-collapse:collapse;margin:12px 0;font-size:13px}th,td{border:1px solid #dfe6dc;padding:8px 10px;text-align:left;vertical-align:top}th{background:#f2f3ed}ul{padding-left:20px}.meta{color:#718075;font-size:12px;margin-bottom:16px}.note{background:#fff7df;border-left:4px solid #e0a33e;padding:10px 14px;margin:12px 0;font-size:13px}</style></head><body>
<h1>${esc(g.title)}</h1>
<p class="meta">Module: ${esc(g.module || "")} | QSA Industries ERP — Data Entry Reference</p>
<h2>Overview</h2><p>${esc(g.overview || "")}</p>
${g.notes && g.notes.length ? `<h2>Notes</h2><ul>${notesHtml}</ul>` : ""}
${g.fields && g.fields.length ? `<h2>Fields</h2><table><thead><tr><th>Field</th><th>Type</th><th>Required</th><th>Description</th></tr></thead><tbody>${fieldsHtml}</tbody></table>` : ""}
${g.steps && g.steps.length ? `<h2>How to feed data</h2><ol>${stepsHtml}</ol>` : ""}
<p class="meta" style="margin-top:32px;">Generated for QSA ERP local reference.</p>
</body></html>`;
  writeFileSync(htmlPath, html, "utf8");
  execFileSync(edge, ["--headless", "--disable-gpu", `--print-to-pdf=${pdfPath}`, `file:///${htmlPath.replace(/\\/g, "/")}`], { stdio: "ignore", timeout: 60000 });
  console.log("generated", g.file + ".pdf");
}
console.log("ALL DONE, total:", guides.length);
