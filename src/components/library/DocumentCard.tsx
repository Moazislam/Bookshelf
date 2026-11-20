import { memo } from "react";
import { useNavigate } from "react-router-dom";
import { Check, Ellipsis, Star, Unlink } from "lucide-react";
import { ContextMenu, ContextMenuContent, ContextMenuTrigger, DropdownMenu, DropdownMenuContent, DropdownMenuTrigger, Progress } from "@/components/ui";
import { DocumentCover } from "./DocumentCover";
import { DocumentMenuItems } from "./DocumentMenu";
import { relinkDocument } from "@/features/documents/actions";
import { cn, formatBytes, FORMAT_LABEL, relativeTime, STATUS_LABEL } from "@/utils";
import type { Document } from "@/types";

export function StatusDot({ status }: { status: Document["status"] }) {
  const color = { unread: "bg-border-strong", reading: "bg-accent", completed: "bg-success", on_hold: "bg-warning", abandoned: "bg-subtle" }[status];
  return <span className={cn("inline-block size-1.5 shrink-0 rounded-full", color)} />;
}

interface CardProps {
  doc: Document;
  selected: boolean;
  selecting: boolean;
  onSelect: (id: string, e: React.MouseEvent) => void;
}

export const DocumentCard = memo(function DocumentCard({ doc, selected, selecting, onSelect }: CardProps) {
  const navigate = useNavigate();
  const open = (e: React.MouseEvent) => {
    if (selecting || e.ctrlKey || e.metaKey || e.shiftKey) return onSelect(doc.id, e);
    if (doc.missing) return void relinkDocument(doc);
    navigate(`/read/${doc.id}`);
  };
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          className={cn("group relative flex cursor-default flex-col rounded-lg p-2 transition-colors", selected ? "bg-accent-soft ring-1 ring-accent/40" : "hover:bg-surface/70")}
          onClick={open}
          onKeyDown={(e) => e.key === "Enter" && navigate(`/read/${doc.id}`)}
          tabIndex={0}
          role="button"
          aria-label={`Open ${doc.title}`}
        >
          <div className="relative">
            <DocumentCover doc={doc} className={cn("aspect-[2/3] w-full rounded-[5px] shadow-md transition-transform duration-200 group-hover:-translate-y-0.5 group-hover:shadow-lg", doc.missing && "opacity-50 grayscale")} />
            <span className="absolute bottom-1.5 left-1.5 rounded-[4px] bg-black/55 px-1.5 py-px text-[10px] font-medium text-white backdrop-blur-sm">
              {FORMAT_LABEL[doc.format]}
            </span>
            {doc.favorite && <Star className="absolute right-2 top-2 size-4 fill-amber-400 text-amber-400 drop-shadow" />}
            {doc.missing && (
              <span className="absolute inset-x-2 top-2 flex items-center justify-center gap-1 rounded bg-danger px-1.5 py-1 text-[11px] font-medium text-white">
                <Unlink className="size-3" /> File missing
              </span>
            )}
            <button
              aria-label={selected ? "Deselect" : "Select"}
              onClick={(e) => {
                e.stopPropagation();
                onSelect(doc.id, e);
              }}
              className={cn(
                "absolute left-2 top-2 grid size-5 place-items-center rounded-full border-2 border-white bg-black/30 text-white shadow transition-opacity",
                selected ? "border-accent bg-accent opacity-100" : selecting ? "opacity-100" : "opacity-0 group-hover:opacity-100",
              )}
            >
              {selected && <Check className="size-3" strokeWidth={3} />}
            </button>
            {doc.progress > 0 && doc.status !== "completed" && (
              <div className="absolute inset-x-0 bottom-0 h-[3px] overflow-hidden rounded-b-[5px] bg-black/25">
                <div className="h-full bg-accent" style={{ width: `${doc.progress * 100}%` }} />
              </div>
            )}
          </div>
          <div className="mt-2.5 flex items-start gap-1 px-0.5">
            <div className="min-w-0 flex-1">
              <h3 className="line-clamp-2 text-[13px] font-semibold leading-snug" title={doc.title}>
                {doc.title}
              </h3>
              <p className="mt-0.5 truncate text-[12px] text-muted">{doc.author || "Unknown author"}</p>
              <p className="mt-1 flex items-center gap-1.5 text-[11px] text-subtle">
                <StatusDot status={doc.status} />
                {doc.status === "reading" ? `${Math.round(doc.progress * 100)}%` : STATUS_LABEL[doc.status]}
              </p>
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button onClick={(e) => e.stopPropagation()} className="-mr-1 grid size-6 shrink-0 place-items-center rounded-md text-subtle opacity-0 hover:bg-bg-subtle hover:text-fg group-hover:opacity-100 data-[state=open]:opacity-100" aria-label="More actions">
                  <Ellipsis className="size-4" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent onClick={(e) => e.stopPropagation()} className="w-56">
                <DocumentMenuItems doc={doc} kind="dropdown" />
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-56">
        <DocumentMenuItems doc={doc} kind="context" />
      </ContextMenuContent>
    </ContextMenu>
  );
});

export const DocumentRow = memo(function DocumentRow({ doc, selected, selecting, onSelect, tagNames, style }: CardProps & { tagNames: string; style?: React.CSSProperties }) {
  const navigate = useNavigate();
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          style={style}
          onClick={(e) => {
            if (selecting || e.ctrlKey || e.metaKey || e.shiftKey) return onSelect(doc.id, e);
            if (doc.missing) return void relinkDocument(doc);
            navigate(`/read/${doc.id}`);
          }}
          className={cn(
            "group grid h-14 cursor-default grid-cols-[28px_minmax(0,3fr)_minmax(0,1.6fr)_80px_110px_110px_80px_32px] max-md:grid-cols-[28px_minmax(0,1fr)_32px] max-md:[&>*:nth-child(n+3):nth-child(-n+7)]:hidden items-center gap-3 border-b border-border/70 px-3 text-[13px]",
            selected ? "bg-accent-soft" : "hover:bg-surface/70",
          )}
        >
          <button
            aria-label={selected ? "Deselect" : "Select"}
            onClick={(e) => {
              e.stopPropagation();
              onSelect(doc.id, e);
            }}
            className={cn("grid size-4 place-items-center rounded border transition-opacity", selected ? "border-accent bg-accent text-accent-fg" : "border-border-strong opacity-0 group-hover:opacity-100", selecting && "opacity-100")}
          >
            {selected && <Check className="size-3" strokeWidth={3} />}
          </button>
          <div className="flex min-w-0 items-center gap-3">
            <DocumentCover doc={doc} className={cn("h-10 w-7 shrink-0 rounded-[3px] shadow-sm", doc.missing && "opacity-50 grayscale")} small />
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="truncate font-medium">{doc.title}</span>
                {doc.favorite && <Star className="size-3 shrink-0 fill-amber-400 text-amber-400" />}
                {doc.missing && <Unlink className="size-3 shrink-0 text-danger" />}
              </div>
              {tagNames && <div className="truncate text-[12px] text-subtle">{tagNames}</div>}
            </div>
          </div>
          <span className="truncate text-muted">{doc.author || "—"}</span>
          <span className="text-[12px] text-muted">{FORMAT_LABEL[doc.format]}</span>
          <span className="flex items-center gap-2 text-[12px] text-muted">
            <StatusDot status={doc.status} />
            {STATUS_LABEL[doc.status]}
          </span>
          <span className="flex items-center gap-2">
            <Progress value={doc.progress} className="w-14" tone={doc.status === "completed" ? "success" : "accent"} />
            <span className="w-8 text-right text-[12px] tabular-nums text-subtle">{Math.round(doc.progress * 100)}%</span>
          </span>
          <span className="text-right text-[12px] tabular-nums text-subtle" title={doc.openedAt ? relativeTime(doc.openedAt) : undefined}>
            {formatBytes(doc.fileSize)}
          </span>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button onClick={(e) => e.stopPropagation()} className="grid size-7 place-items-center rounded-md text-subtle opacity-0 hover:bg-bg-subtle hover:text-fg group-hover:opacity-100 data-[state=open]:opacity-100" aria-label="More actions">
                <Ellipsis className="size-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent onClick={(e) => e.stopPropagation()} className="w-56">
              <DocumentMenuItems doc={doc} kind="dropdown" />
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-56">
        <DocumentMenuItems doc={doc} kind="context" />
      </ContextMenuContent>
    </ContextMenu>
  );
});
