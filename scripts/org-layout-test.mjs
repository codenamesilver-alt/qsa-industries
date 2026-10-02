// Checks the organization chart's geometry without a browser or a bundler.
//
//   npm run test:org-layout
//
// org-tree.ts imports only the OrgChartRow type from data.ts, and a type-only
// import is erased, so node's own TypeScript stripping can load the module
// directly. That is the only reason this suite can exist without a test runner
// being added to the repository first; if org-tree.ts ever gains a runtime import,
// this file stops working and the runner has to come with it.
import {
  buildOrgTree,
  descendantCount,
  GAP_X,
  GAP_Y,
  layoutOrgChart,
  NODE_H,
  NODE_W,
} from "../web/src/lib/org-tree.ts";

let failures = 0;
function check(label, condition, detail = "") {
  if (condition) {
    console.log(`  ok   ${label}`);
  } else {
    failures += 1;
    console.log(`  FAIL ${label}${detail ? ` -- ${detail}` : ""}`);
  }
}

function row(id, parent_id, extra = {}) {
  return {
    id,
    title: id,
    parent_id,
    sort_order: 0,
    user_id: null,
    user_full_name: null,
    user_email: null,
    user_role: null,
    user_designation: null,
    user_is_active: null,
    ...extra,
  };
}

// ceo -> { ops, sales }, ops -> { plant, qc }, sales -> { north, south }
const tree = buildOrgTree([
  row("ceo", null),
  row("ops", "ceo"),
  row("sales", "ceo"),
  row("plant", "ops"),
  row("qc", "ops"),
  row("north", "sales"),
  row("south", "sales"),
]);

console.log("\nA single root with two branches");
check("builds one root", tree.length === 1, `got ${tree.length}`);
check("ceo is the root", tree[0].row.id === "ceo");

const { laid, width, height } = layoutOrgChart(tree);
check("lays out every post", laid.length === 7, `got ${laid.length}`);

const at = new Map(laid.map((item) => [item.node.row.id, item]));
const centre = (id) => at.get(id).x + NODE_W / 2;

check("parent is centred over its first and last child", Math.abs(centre("ops") - (centre("plant") + centre("qc")) / 2) < 0.001);
check("grandparent is centred over its children", Math.abs(centre("ceo") - (centre("ops") + centre("sales")) / 2) < 0.001);
check("depth sets the y axis", at.get("ceo").y === 0 && at.get("ops").y === NODE_H + GAP_Y && at.get("plant").y === 2 * (NODE_H + GAP_Y));
check(
  "every leaf sits on the bottom row",
  at.get("plant").y === at.get("qc").y &&
    at.get("qc").y === at.get("north").y &&
    at.get("north").y === at.get("south").y &&
    at.get("south").y === 2 * (NODE_H + GAP_Y),
);
check("an intermediate post sits above its leaves", at.get("sales").y + NODE_H + GAP_Y / 2 < at.get("north").y);

// No horizontal overlap between any two nodes on the same row.
let overlap = null;
for (const a of laid) {
  for (const b of laid) {
    if (a === b || a.y !== b.y) continue;
    if (a.x < b.x + NODE_W && b.x < a.x + NODE_W) overlap = `${a.node.row.id}/${b.node.row.id}`;
  }
}
check("no two posts overlap on the same row", overlap === null, overlap ? overlap : "");

check("width covers the right-most post", width === Math.max(...laid.map((i) => i.x + NODE_W)));
check("left-most post starts at the origin", Math.min(...laid.map((i) => i.x)) === 0);
check("height covers the deepest post", height === 2 * (NODE_H + GAP_Y) + NODE_H, `got ${height}`);
check("leaves are one column apart plus the gutter", centre("plant") + NODE_W / 2 + GAP_X === centre("qc") - NODE_W / 2, `${centre("qc") - centre("plant")}`);

console.log("\nCollapsing a post folds its subtree and counts it");
const folded = layoutOrgChart(tree, new Set(["ops"]));
check("the collapsed post is still drawn", folded.laid.length === 5, `got ${folded.laid.length}`);
check("its children are not laid out", !folded.laid.some((i) => i.node.row.id === "plant" || i.node.row.id === "qc"));
check("it reports what it hid", folded.laid.find((i) => i.node.row.id === "ops").hiddenCount === 2);
check("an expanded post hides nothing", folded.laid.find((i) => i.node.row.id === "ceo").hiddenCount === 0);
check("collapsed charts are narrower", folded.width < width, `${folded.width} vs ${width}`);
check("descendantCount agrees", descendantCount(tree[0].children.find((c) => c.row.id === "ops")) === 2);

console.log("\nEmpty and degenerate input");
const empty = layoutOrgChart([]);
check("no posts gives no size", empty.laid.length === 0 && empty.width === 0 && empty.height === 0);
const single = layoutOrgChart(buildOrgTree([row("solo", null)]));
check("a lone post is drawn", single.laid.length === 1 && single.width === NODE_W && single.height === NODE_H);

console.log("\nCycles and orphans cannot hang the walk");
// A parent that points at itself and a parent that points at nothing both have to
// terminate. buildOrgTree is what guards this, so the layout is checked after it.
const nasty = buildOrgTree([row("loop", "loop"), row("ghost", "missing-parent"), row("loop2", "loop")]);
check("a cyclic and an orphaned chart still returns", nasty.length >= 1, `${nasty.length} roots`);
check("and it still lays out", layoutOrgChart(nasty).laid.length === 3);

console.log(failures === 0 ? "\nall geometry checks passed" : `\n${failures} geometry checks failed`);
process.exitCode = failures === 0 ? 0 : 1;