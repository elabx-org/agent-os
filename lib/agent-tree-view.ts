/**
 * Walking the agent tree on the client: shared by the tree (closed and
 * open Duo), the desktop graph and the detail pane. Pure, no server imports.
 */

import type { AgentTreeResponse, TreeNode } from "./agent-tree-types";

/** The root with its top level under it, as one tree */
export function rootWithChildren(tree: AgentTreeResponse): TreeNode {
  return { ...tree.root, children: tree.children };
}

/** Finished: done, failed or stopped (Show finished hides these) */
export function isFinished(node: TreeNode): boolean {
  return (
    node.state === "done" || node.state === "error" || node.state === "stopped"
  );
}

/**
 * The nodes under `nodes` without the finished ones, keeping a finished
 * workflow or phase while anything under it still runs
 */
export function withoutFinished(nodes: TreeNode[]): TreeNode[] {
  const out: TreeNode[] = [];
  for (const node of nodes) {
    const children = withoutFinished(node.children);
    if (isFinished(node) && children.length === 0) continue;
    out.push(children === node.children ? node : { ...node, children });
  }
  return out;
}

/** The node with this id and the path to it from the top level; null if gone */
export function findNode(
  tree: AgentTreeResponse,
  id: string
): { node: TreeNode; path: TreeNode[] } | null {
  if (tree.root.id === id) return { node: tree.root, path: [] };
  const walk = (
    nodes: TreeNode[],
    path: TreeNode[]
  ): { node: TreeNode; path: TreeNode[] } | null => {
    for (const node of nodes) {
      if (node.id === id) return { node, path };
      const found = walk(node.children, [...path, node]);
      if (found) return found;
    }
    return null;
  };
  return walk(tree.children, []);
}

/**
 * The crumb above the detail: the session, then each workflow and phase
 * down to the node ("Agent-OS redesign › agentos-feature-mocks › Design")
 */
export function crumbsFor(tree: AgentTreeResponse, id: string): string[] {
  const found = findNode(tree, id);
  if (!found) return [tree.root.title];
  return [tree.root.title, ...found.path.map((n) => n.title)];
}

/** Every node depth first, with its depth under the root (top level is 0) */
export function flattenTree(
  nodes: TreeNode[],
  depth = 0
): { node: TreeNode; depth: number }[] {
  return nodes.flatMap((node) => [
    { node, depth },
    ...flattenTree(node.children, depth + 1),
  ]);
}
