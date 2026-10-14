import fs from 'node:fs';
import readline from 'node:readline';

export interface JsonlNode {
  id: string;
  __parentId?: string;
  [k: string]: unknown;
}

/**
 * Read a bulk JSONL file and group child rows under their parent via __parentId.
 * Returns the list of ROOT objects (no __parentId), each with a `_children` map
 * keyed by the child's GID resource type (e.g. "ProductVariant", "MediaImage", "Metafield").
 *
 * Bulk JSONL is not guaranteed to be ordered, so we index everything first, then stitch.
 */
export async function readBulkJsonl(filePath: string): Promise<Map<string, JsonlNode>> {
  const byId = new Map<string, JsonlNode>();
  if (!fs.existsSync(filePath)) return byId;

  const rl = readline.createInterface({ input: fs.createReadStream(filePath), crlfDelay: Infinity });
  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const node = JSON.parse(trimmed) as JsonlNode;
    if (node.id) byId.set(node.id, node);
  }
  return byId;
}

/** Resource type from a GID, e.g. gid://shopify/ProductVariant/1 -> "ProductVariant". */
function typeOf(gid: string): string {
  const parts = gid.split('/');
  return parts[parts.length - 2] ?? '';
}

/**
 * Turn the flat id->node map into roots with grouped children.
 * Only two levels are possible in bulk queries, so a single grouping pass suffices.
 */
export function stitch(byId: Map<string, JsonlNode>): Array<JsonlNode & { _children: Record<string, JsonlNode[]> }> {
  const roots: Array<JsonlNode & { _children: Record<string, JsonlNode[]> }> = [];
  const childrenByParent = new Map<string, JsonlNode[]>();

  for (const node of byId.values()) {
    if (node.__parentId) {
      const arr = childrenByParent.get(node.__parentId) ?? [];
      arr.push(node);
      childrenByParent.set(node.__parentId, arr);
    }
  }

  for (const node of byId.values()) {
    if (node.__parentId) continue;
    const children: Record<string, JsonlNode[]> = {};
    for (const child of childrenByParent.get(node.id) ?? []) {
      const t = typeOf(child.id);
      (children[t] ??= []).push(child);
    }
    roots.push({ ...node, _children: children });
  }

  return roots;
}
