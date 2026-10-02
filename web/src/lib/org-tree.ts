import type { OrgChartRow } from "./data";

export type OrgTreeNode<T = OrgChartRow> = {
  row: T;
  depth: number;
  children: OrgTreeNode<T>[];
};

// The chart as a tree, from the flat rows the view returns.
//
// Two things are defensive here, and neither should be reachable. A post whose
// parent is not in the row set is rendered at the top rather than dropped, and a
// post is never visited twice. Both exist because a recursive walk over a table
// with a foreign key and no cycle constraint is a stack overflow waiting for a bad
// row, and the migration's cycle guard is in admin_move_org_position: it stops a
// cycle being created through the portal, not one arriving by some other route. A
// read that cannot hang is worth twenty lines.
//
// Order is sort_order then title, which is the order the view already returns, so
// the walk preserves it rather than re-sorting and disagreeing with the query.
export function buildOrgTree(rows: OrgChartRow[]): OrgTreeNode[] {
  const byParent = new Map<string | null, OrgChartRow[]>();
  for (const row of rows) {
    const key = row.parent_id;
    const bucket = byParent.get(key) ?? [];
    bucket.push(row);
    byParent.set(key, bucket);
  }

  const visited = new Set<string>();
  const orphans: OrgChartRow[] = [];

  const walk = (parentId: string | null, depth: number): OrgTreeNode[] => {
    const children = byParent.get(parentId) ?? [];
    const nodes: OrgTreeNode[] = [];
    for (const row of children) {
      if (visited.has(row.id)) continue;
      visited.add(row.id);
      nodes.push({ row, depth, children: walk(row.id, depth + 1) });
    }
    return nodes;
  };

  const roots = walk(null, 0);

  for (const row of rows) {
    if (visited.has(row.id)) continue;
    visited.add(row.id);
    orphans.push(row);
  }

  for (const row of orphans) {
    roots.push({ row, depth: 0, children: walk(row.id, 1) });
  }

  return roots;
}

// Every post, flattened, with its depth, in the order the chart draws them. The
// builder's list is this rather than the tree, because a form per box in a nested
// tree is a form nobody can scan: the chart above it is where the shape is read,
// and the list is where the shape is edited.
export function flattenOrgTree(rows: OrgChartRow[]): Array<{ row: OrgChartRow; depth: number }> {
  const flat: Array<{ row: OrgChartRow; depth: number }> = [];
  const visit = (nodes: OrgTreeNode[]) => {
    for (const node of nodes) {
      flat.push({ row: node.row, depth: node.depth });
      visit(node.children);
    }
  };
  visit(buildOrgTree(rows));
  return flat;
}

// The chart's geometry, kept here rather than in the component because it is pure
// arithmetic over the tree and has nothing to do with drawing. It is the part of
// the chart that can be wrong in a way nobody sees, so it is the part worth
// testing without a browser.
export const NODE_W = 232;
export const NODE_H = 104;
export const GAP_X = 28;
export const GAP_Y = 68;

export type Laid<T = OrgChartRow> = {
  node: OrgTreeNode<T>;
  x: number;
  y: number;
  collapsed: boolean;
  hiddenCount: number;
};

// One post-order pass. Each leaf takes the next free column; a parent is centred on
// its first and last child, which is what keeps a subtree hanging under the post
// above it rather than drifting away from it. Nothing here is iterative, so the
// depth of the chart costs stack, not time.
//
// Collapsing a post is expressed as that post having no children for layout
// purposes, and the descendants it hides are counted rather than laid out, so the
// fold button can say how much is behind it.
//
// idOf rather than row.id, because the same arithmetic draws the post chart and the
// people chart and the two do not agree on which column holds the identifier: a
// post's is id, a person's is user_id. One pass over a tree is the only thing in
// this file that could be wrong in a way nobody sees, so it is written once.
export function layoutTree<T>(
  roots: OrgTreeNode<T>[],
  idOf: (row: T) => string,
  collapsed: ReadonlySet<string> = new Set(),
): { laid: Laid<T>[]; width: number; height: number } {
  const laid: Laid<T>[] = [];
  let cursor = 0;

  const visit = (node: OrgTreeNode<T>, depth: number): number => {
    const isCollapsed = collapsed.has(idOf(node.row));
    const children = isCollapsed ? [] : node.children;

    if (children.length === 0) {
      const centre = cursor + NODE_W / 2;
      cursor += NODE_W + GAP_X;
      laid.push({
        node,
        x: centre - NODE_W / 2,
        y: depth * (NODE_H + GAP_Y),
        collapsed: isCollapsed,
        hiddenCount: isCollapsed ? descendantCount(node) : 0,
      });
      return centre;
    }

    const centres = children.map((child) => visit(child, depth + 1));
    const centre = (centres[0] + centres[centres.length - 1]) / 2;
    laid.push({
      node,
      x: centre - NODE_W / 2,
      y: depth * (NODE_H + GAP_Y),
      collapsed: isCollapsed,
      hiddenCount: 0,
    });
    return centre;
  };

  for (const root of roots) visit(root, 0);

  if (laid.length === 0) return { laid, width: 0, height: 0 };

  const minX = Math.min(...laid.map((item) => item.x));
  for (const item of laid) item.x -= minX;

  const width = Math.max(...laid.map((item) => item.x + NODE_W));
  const height = Math.max(...laid.map((item) => item.y + NODE_H));
  return { laid, width, height };
}

// The post chart, which is layoutTree with the post's own id column.
export function layoutOrgChart(
  roots: OrgTreeNode<OrgChartRow>[],
  collapsed: ReadonlySet<string> = new Set(),
): { laid: Laid<OrgChartRow>[]; width: number; height: number } {
  return layoutTree(roots, (row) => row.id, collapsed);
}

export function descendantCount<T>(node: OrgTreeNode<T>): number {
  let total = 0;
  for (const child of node.children) total += 1 + descendantCount(child);
  return total;
}

export const roleLabels: Record<string, string> = {
  admin: "Admin",
  production_manager: "Production manager",
  inventory_manager: "Inventory manager",
  qc_staff: "QC staff",
  sales_director: "Sales director",
  sales_manager: "Sales manager",
  sales_rep: "Sales rep",
  logistics: "Logistics",
  finance: "Finance",
  dealer: "Dealer",
};

export function roleLabel(role: string | null): string {
  if (!role) return "";
  return roleLabels[role] ?? role.replace(/_/g, " ");
}
