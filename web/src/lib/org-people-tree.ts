import type { OrgPersonRow } from "./data";
import type { OrgTreeNode } from "./org-tree";

// The people chart, as a tree, from the flat rows org_people_tree returns.
//
// This is org-tree.ts's buildOrgTree with the other two columns: a person is
// identified by user_id rather than id, and hangs off reports_to_id rather than
// parent_id. The walk is otherwise the same one, including the two defensive
// moves, and they are defensible for the same reason: a reporting line is a
// self-referencing column with no cycle constraint, and the guard against a cycle
// is in admin_set_reports_to rather than in the database, so it stops a loop
// arriving through the portal and not a loop arriving by any other route. A read
// that cannot hang is worth twenty lines.
//
// Sorting is sort_order then full_name, which is the order getOrgPeople already
// asked for, so the walk preserves the query's order rather than re-sorting and
// disagreeing with it. sort_order is what lets two partners be drawn in the order
// the company reads them rather than alphabetically.
export function buildPeopleTree(rows: OrgPersonRow[]): OrgTreeNode<OrgPersonRow>[] {
  const byParent = new Map<string | null, OrgPersonRow[]>();
  for (const row of rows) {
    const key = row.reports_to_id;
    const bucket = byParent.get(key) ?? [];
    bucket.push(row);
    byParent.set(key, bucket);
  }

  const visited = new Set<string>();
  const orphans: OrgPersonRow[] = [];

  const walk = (parentId: string | null, depth: number): OrgTreeNode<OrgPersonRow>[] => {
    const children = byParent.get(parentId) ?? [];
    const nodes: OrgTreeNode<OrgPersonRow>[] = [];
    for (const row of children) {
      if (visited.has(row.user_id)) continue;
      visited.add(row.user_id);
      nodes.push({ row, depth, children: walk(row.user_id, depth + 1) });
    }
    return nodes;
  };

  const roots = walk(null, 0);

  // A person whose reports_to_id points at somebody who is not in the row set --
  // a dealer login, or an account deleted by some route other than the cascade --
  // is promoted to the top rather than dropped. They are still an employee and
  // dropping them would quietly take a person off the company's own chart.
  for (const row of rows) {
    if (visited.has(row.user_id)) continue;
    visited.add(row.user_id);
    orphans.push(row);
  }

  for (const row of orphans) {
    roots.push({ row, depth: 0, children: walk(row.user_id, 1) });
  }

  return roots;
}

// Every person, flattened, with its depth, in the order the chart draws them. The
// builder's list is this rather than the tree, for the same reason the post
// builder's was: the chart above is where the shape is read, and the list is where
// the shape is edited.
export function flattenPeopleTree(
  rows: OrgPersonRow[],
): Array<{ row: OrgPersonRow; depth: number }> {
  const flat: Array<{ row: OrgPersonRow; depth: number }> = [];
  const visit = (nodes: OrgTreeNode<OrgPersonRow>[]) => {
    for (const node of nodes) {
      flat.push({ row: node.row, depth: node.depth });
      visit(node.children);
    }
  };
  visit(buildPeopleTree(rows));
  return flat;
}

// Everyone at or below one person, which is what the "reports to" picker has to
// leave out. A picker that offered a person's own report would let an admin write
// a loop; admin_set_reports_to refuses one, so this is the same refusal a moment
// earlier rather than a different answer.
export function descendantPeopleIds(rows: OrgPersonRow[], rootId: string): Set<string> {
  const childrenOf = new Map<string, string[]>();
  for (const row of rows) {
    if (!row.reports_to_id) continue;
    const bucket = childrenOf.get(row.reports_to_id) ?? [];
    bucket.push(row.user_id);
    childrenOf.set(row.reports_to_id, bucket);
  }

  const found = new Set<string>();
  const walk = (id: string) => {
    for (const child of childrenOf.get(id) ?? []) {
      if (found.has(child)) continue;
      found.add(child);
      walk(child);
    }
  };
  walk(rootId);
  // The person themself counts as forbidden, so the picker reads as "everything at
  // or below" without needing a separate check at the call site.
  found.add(rootId);
  return found;
}

// How many people report directly to this one, for the picker label and the detail
// panel. A count and not a list, because the list is what the chart is for.
export function directReportCount(rows: OrgPersonRow[], userId: string): number {
  let total = 0;
  for (const row of rows) {
    if (row.reports_to_id === userId) total += 1;
  }
  return total;
}