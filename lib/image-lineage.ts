/**
 * Which pictures came from which: an edit records the picture it started from,
 * so a gallery can show the original behind an edit and the edits made from an
 * original.
 */
export interface LineagePicture {
  id: string;
  createdAt: number;
  editedFrom?: string;
}

export interface Lineage<T extends LineagePicture> {
  /** The picture an edit started from, if it is still around. */
  original: T | null;
  /** It was an edit, but what it was edited from has since been deleted. */
  originalGone: boolean;
  /** Pictures made by editing this one, oldest first. */
  edits: T[];
}

export function lineageOf<T extends LineagePicture>(picture: T, all: T[]): Lineage<T> {
  const original = picture.editedFrom ? all.find((p) => p.id === picture.editedFrom) ?? null : null;
  return {
    original,
    originalGone: Boolean(picture.editedFrom) && !original,
    edits: all.filter((p) => p.editedFrom === picture.id).sort((a, b) => a.createdAt - b.createdAt),
  };
}

/**
 * The whole family a picture belongs to: walk up to the oldest ancestor still
 * present, then collect everything descended from it, oldest first. A cycle
 * (a corrupt file) can't hang it.
 */
export function familyOf<T extends LineagePicture>(picture: T, all: T[]): T[] {
  const byId = new Map(all.map((p) => [p.id, p]));
  let root = picture;
  const seen = new Set<string>([root.id]);
  while (root.editedFrom && byId.has(root.editedFrom) && !seen.has(root.editedFrom)) {
    root = byId.get(root.editedFrom)!;
    seen.add(root.id);
  }

  const children = new Map<string, T[]>();
  for (const p of all) {
    if (!p.editedFrom) continue;
    children.set(p.editedFrom, [...(children.get(p.editedFrom) ?? []), p]);
  }

  const family: T[] = [];
  const visited = new Set<string>();
  const stack = [root];
  while (stack.length) {
    const next = stack.pop()!;
    if (visited.has(next.id)) continue;
    visited.add(next.id);
    family.push(next);
    stack.push(...(children.get(next.id) ?? []));
  }
  return family.sort((a, b) => a.createdAt - b.createdAt);
}
