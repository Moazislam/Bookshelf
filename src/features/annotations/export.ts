import type { Highlight, Note, Tag } from "@/types";

const date = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export function highlightsToMarkdown(highlights: Highlight[]): string {
  const byDoc = new Map<string, Highlight[]>();
  for (const h of highlights) byDoc.set(h.documentTitle, [...(byDoc.get(h.documentTitle) ?? []), h]);
  const out: string[] = [`# Highlights`, ``, `_Exported from BookShelf on ${date(Date.now())}_`, ``];
  for (const [title, items] of byDoc) {
    out.push(`## ${title}`, ``);
    for (const h of [...items].sort((a, b) => a.sortKey - b.sortKey)) {
      out.push(...h.text.split(/\n+/).map((l) => `> ${l}`));
      const meta = [h.label, h.color, date(h.createdAt)].filter(Boolean).join(" · ");
      out.push(``, `— ${meta}`);
      if (h.comment) out.push(``, h.comment);
      out.push(``);
    }
  }
  return out.join("\n");
}

export function notesToMarkdown(notes: Note[], tags: Tag[]): string {
  const tagName = Object.fromEntries(tags.map((t) => [t.id, t.name]));
  if (notes.length === 1) {
    const n = notes[0];
    const head = [`# ${n.title || "Untitled note"}`, ``];
    if (n.documentTitle) head.push(`_Source: ${n.documentTitle}_`, ``);
    if (n.tagIds.length) head.push(n.tagIds.map((t) => `#${(tagName[t] ?? "").replace(/\s+/g, "-")}`).join(" "), ``);
    return [...head, n.body].join("\n");
  }
  return notes
    .map((n) => {
      const parts = [`## ${n.title || "Untitled note"}`, ``];
      const meta = [n.documentTitle && `Source: ${n.documentTitle}`, `Updated ${date(n.updatedAt)}`, n.tagIds.length ? n.tagIds.map((t) => `#${(tagName[t] ?? "").replace(/\s+/g, "-")}`).join(" ") : ""].filter(Boolean).join(" · ");
      parts.push(`_${meta}_`, ``, n.body.trim(), ``);
      return parts.join("\n");
    })
    .join("\n---\n\n");
}
