import { readFileSync } from "node:fs";

const sql = readFileSync("supabase/tests/stage18_dealer_onboarding_test.sql", "utf8");
const lines = sql.split("\n");

const assertRe = /^select\s+(is|isnt|ok|is_empty|like|unlike|matches|throws_ok|lives_ok|results_eq|set_eq|col_is_eq|hasnt_function|has_function|hasnt_table|has_table)\s*\(/i;

let section = "(preamble)";
let counts = new Map([["(preamble)", 0]]);
let total = 0;

for (const line of lines) {
  if (/^-- [A-Z]\. /.test(line)) {
    section = line.slice(3).trim();
    if (!counts.has(section)) counts.set(section, 0);
  }
  if (assertRe.test(line.trim())) {
    counts.set(section, counts.get(section) + 1);
    total += 1;
  }
}

for (const [k, v] of counts) console.log(String(v).padStart(3) + "  " + k);
console.log("---");
console.log(String(total).padStart(3) + "  TOTAL (plan says 122)");
