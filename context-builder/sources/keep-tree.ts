// The local Keep node tree, rebuilt from the server's `changes` pages. Pure and I/O free: a port of the
// read path of gkeepapi 0.17.1 (node parsing, list-item indentation and ordering, text rendering) so
// KeepNote output stays byte-compatible with what the Python fetch produced.

export interface KeepNote {
  id: string;
  title: string;
  text: string;
  labels: string[];
  isPinned: boolean;
  isArchived: boolean;
  /** UTC, in Python's `datetime.isoformat()` shape: `2024-01-02T03:04:05.123000+00:00`. */
  updatedAt: string;
}

export interface RawNode {
  id: string;
  type?: string;
  /** Absent means the node was deleted on the server. */
  parentId?: string;
  sortValue?: string | number;
  text?: string;
  title?: string;
  isArchived?: boolean;
  isPinned?: boolean;
  checked?: boolean;
  superListItemId?: string;
  labelIds?: { labelId: string }[];
  timestamps?: { updated?: string; deleted?: string };
}

export interface RawLabel {
  mainId: string;
  name: string;
}

type NodeType = "NOTE" | "LIST" | "LIST_ITEM" | "BLOB" | "ROOT";

interface TreeNode {
  id: string;
  type: NodeType;
  parentId: string;
  parent: TreeNode | null;
  sort: number;
  text: string;
  title: string;
  archived: boolean;
  pinned: boolean;
  labelIds: string[];
  /** Raw `updated` string; kept verbatim until rendering so microseconds survive. */
  updated: string;
  deleted: boolean;
  checked: boolean;
  superListItemId: string | null;
  prevSuperListItemId: string | null;
  parentItem: TreeNode | null;
  subitems: Map<string, TreeNode>;
  /** Insertion order is the output order, as with Python's dict. */
  children: Map<string, TreeNode>;
}

const ROOT_ID = "root";
const KNOWN_TYPES = new Set<string>(["NOTE", "LIST", "LIST_ITEM", "BLOB"]);
const TIMESTAMP = /^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d):(\d\d)(?:\.(\d{1,6}))?Z$/;

function parseTimestamp(raw: string): { ms: number; micros: string; base: string } {
  const m = TIMESTAMP.exec(raw);
  if (!m) throw new Error(`Unparseable Keep timestamp: ${raw}`);
  const [, y, mo, d, h, mi, s, frac = ""] = m;
  const micros = frac.padEnd(6, "0");
  return { ms: Date.UTC(+y!, +mo! - 1, +d!, +h!, +mi!, +s!), micros, base: `${y}-${mo}-${d}T${h}:${mi}:${s}` };
}

/** Python's `datetime.isoformat()` for a UTC datetime: the fraction is omitted when it is zero. */
function isoFormat(raw: string): string {
  const { micros, base } = parseTimestamp(raw);
  return `${base}${micros === "000000" ? "" : `.${micros}`}+00:00`;
}

/** Epoch zero is how the server writes "not deleted"; only a later time counts. */
function isDeleted(raw: string | undefined): boolean {
  return raw !== undefined && parseTimestamp(raw).ms > 0;
}

function newNode(id: string, type: NodeType): TreeNode {
  return {
    id, type, parentId: "", parent: null, sort: 0, text: "", title: "", archived: false, pinned: false, labelIds: [],
    updated: "1970-01-01T00:00:00.000Z", deleted: false, checked: false, superListItemId: null, prevSuperListItemId: null,
    parentItem: null, subitems: new Map(), children: new Map(),
  };
}

/** Overwrites what the server sent and keeps the rest, as gkeepapi's `_load` does. */
function load(node: TreeNode, raw: RawNode): void {
  if (!raw.timestamps?.updated) throw new Error(`Keep node ${raw.id} has no updated timestamp`);
  node.parentId = raw.parentId ?? node.parentId;
  if (raw.sortValue !== undefined) node.sort = Number(raw.sortValue) || 0;
  node.text = raw.text ?? node.text;
  node.updated = raw.timestamps.updated;
  node.deleted = isDeleted(raw.timestamps.deleted);
  if (node.type === "NOTE" || node.type === "LIST") {
    node.title = raw.title ?? "";
    node.archived = raw.isArchived ?? false;
    node.pinned = raw.isPinned ?? false;
    node.labelIds = (raw.labelIds ?? []).map((l) => l.labelId);
  }
  if (node.type === "LIST_ITEM") {
    node.prevSuperListItemId = node.superListItemId;
    node.superListItemId = raw.superListItemId || null;
    node.checked = raw.checked ?? false;
  }
}

/** Both sort values are compared first; a lone parent sorts above its own indented children. */
function compareKeys(a: number[], b: number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i];
    const y = b[i];
    if (x === y) continue;
    if (x === undefined) return 1;
    if (y === undefined) return -1;
    return x - y;
  }
  return 0;
}

/** Highest sort value first; indented items follow their parent. */
function sortedItems(items: TreeNode[]): TreeNode[] {
  const key = (n: TreeNode) => (n.parentItem ? [n.parentItem.sort, n.sort] : [n.sort]);
  return [...items].sort((p, q) => compareKeys(key(q), key(p)));
}

function renderItem(item: TreeNode): string {
  return `${item.parentItem ? "  " : ""}${item.checked ? "☑" : "☐"} ${item.text}`;
}

/** A note keeps its body in its first list-item child (deleted or not); a list is its rendered items. */
function renderText(node: TreeNode): string {
  const children = [...node.children.values()].filter((c) => c.type === "LIST_ITEM");
  if (node.type === "NOTE") return children[0]?.text ?? node.text;
  return sortedItems(children.filter((c) => !c.deleted)).map(renderItem).join("\n");
}

export class KeepTree {
  private nodes = new Map<string, TreeNode>([[ROOT_ID, newNode(ROOT_ID, "ROOT")]]);
  private labels = new Map<string, string>();

  /** Replaces the label set: a label missing from the latest `userInfo` is gone. */
  setLabels(raw: RawLabel[]): void {
    this.labels = new Map(raw.map((l) => [l.mainId, l.name]));
  }

  /** Applies one `changes` page: create, update, delete, then (re)attach list items and new nodes. */
  applyNodes(raws: RawNode[]): void {
    const created: TreeNode[] = [];
    const deleted: TreeNode[] = [];
    const listItems: TreeNode[] = [];

    for (const raw of raws) {
      let node = this.nodes.get(raw.id);
      if (node) {
        if (raw.parentId !== undefined) load(node, raw);
        else deleted.push(node);
      } else if (raw.parentId !== undefined && raw.type && KNOWN_TYPES.has(raw.type)) {
        node = newNode(raw.id, raw.type as NodeType);
        load(node, raw);
        this.nodes.set(raw.id, node);
        created.push(node);
      }
      if (node?.type === "LIST_ITEM") listItems.push(node);
    }

    // Indented items point at their parent item, not at the list.
    for (const item of listItems) {
      const prev = item.prevSuperListItemId;
      const curr = item.superListItemId;
      if (prev === curr) continue;
      const prevParent = prev ? this.nodes.get(prev) : undefined;
      if (prevParent?.subitems.has(item.id)) {
        prevParent.subitems.delete(item.id);
        item.superListItemId = "";
        item.parentItem = null;
      }
      const currParent = curr ? this.nodes.get(curr) : undefined;
      // An item that already has subitems cannot be indented (one level only).
      if (currParent && item.subitems.size === 0) {
        currParent.subitems.set(item.id, item);
        item.superListItemId = currParent.id;
        item.parentItem = currParent;
      }
    }

    for (const node of created) {
      const parent = this.nodes.get(node.parentId);
      if (!parent) continue;
      parent.children.set(node.id, node);
      node.parent = parent;
    }

    for (const node of deleted) {
      node.parent?.children.delete(node.id);
      node.parent = null;
      this.nodes.delete(node.id);
    }
  }

  /**
   * Every top-level note and list. Trashed and deleted ones are included, as the Python fetch did.
   * Labels resolve here, against the final label set: an id with no known label is dropped.
   */
  notes(): KeepNote[] {
    const out: KeepNote[] = [];
    for (const node of this.nodes.get(ROOT_ID)!.children.values()) {
      if (node.type !== "NOTE" && node.type !== "LIST") continue;
      out.push({
        id: node.id,
        title: node.title,
        text: renderText(node),
        labels: node.labelIds.flatMap((id) => this.labels.get(id) ?? []),
        isPinned: node.pinned,
        isArchived: node.archived,
        updatedAt: isoFormat(node.updated),
      });
    }
    return out;
  }
}
