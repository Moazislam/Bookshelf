import { memo, useState } from "react";
import { fileUrl } from "@/services/api";
import { coverPalette, cn, FORMAT_LABEL } from "@/utils";
import type { Document } from "@/types";

/**
 * Real cover thumbnail when we have one, otherwise a typographic cover
 * generated from the title so every document still looks intentional.
 */
export const DocumentCover = memo(function DocumentCover({ doc, className, small }: { doc: Pick<Document, "id" | "title" | "author" | "format" | "hasCover" | "updatedAt">; className?: string; small?: boolean }) {
  const [failed, setFailed] = useState(false);
  if (doc.hasCover && !failed) {
    return (
      <div className={cn("relative overflow-hidden bg-bg-subtle", className)}>
        <img
          src={fileUrl.cover(doc.id, doc.updatedAt)}
          alt=""
          loading="lazy"
          decoding="async"
          draggable={false}
          onError={() => setFailed(true)}
          className="absolute inset-0 size-full object-cover"
        />
        <div className="pointer-events-none absolute inset-0 rounded-[inherit] ring-1 ring-inset ring-black/5" />
      </div>
    );
  }
  const [bg, fg] = coverPalette(doc.title);
  return (
    <div className={cn("relative flex flex-col overflow-hidden", className)} style={{ background: bg, color: fg }}>
      <div className="absolute inset-y-0 left-0 w-[6%] bg-black/15" />
      {small ? (
        <div className="m-auto font-serif text-[10px] font-medium opacity-90">{FORMAT_LABEL[doc.format].slice(0, 3)}</div>
      ) : (
        <div className="@container flex h-full flex-col p-[11%] pl-[16%]">
          <div className="mt-[14%] line-clamp-5 break-words font-serif text-[13cqw] font-medium leading-[1.15]">{doc.title}</div>
          {doc.author && <div className="mt-auto line-clamp-2 text-[7.5cqw] opacity-70">{doc.author}</div>}
        </div>
      )}
    </div>
  );
});
