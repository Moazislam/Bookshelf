import { useMemo } from "react";
import { Link } from "react-router-dom";
import { RotateCcwClock } from "lucide-react";
import { api } from "@/services/api";
import { useAsync, useBreadcrumbs } from "@/hooks";
import { useLibrary } from "@/stores/library";
import { DocumentCover } from "@/components/library/DocumentCover";
import { EmptyState, Skeleton } from "@/components/ui";
import { formatDuration, FORMAT_LABEL } from "@/utils";
import type { HistoryEntry } from "@/types";

export function HistoryPage() {
  useBreadcrumbs([{ label: "Reading History" }]);
  const byId = useLibrary((s) => s.byId);
  const { data, loading } = useAsync(() => api.readingHistory(500), []);

  const days = useMemo(() => {
    const m = new Map<string, HistoryEntry[]>();
    for (const e of data ?? []) {
      const key = new Date(e.startedAt).toDateString();
      m.set(key, [...(m.get(key) ?? []), e]);
    }
    return [...m.entries()];
  }, [data]);

  const dayLabel = (s: string) => {
    const d = new Date(s);
    const today = new Date().toDateString();
    const yesterday = new Date(Date.now() - 86400000).toDateString();
    if (s === today) return "Today";
    if (s === yesterday) return "Yesterday";
    return d.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long", year: d.getFullYear() !== new Date().getFullYear() ? "numeric" : undefined });
  };

  return (
    <div className="mx-auto max-w-3xl px-4 md:px-8 py-7">
      <h1 className="font-serif text-[28px] font-medium">Reading History</h1>
      <p className="mt-1 text-[13px] text-muted">Every reading session, as it actually happened.</p>
      <div className="mt-8">
        {loading && !data ? (
          Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="mb-3 h-16" />)
        ) : days.length === 0 ? (
          <EmptyState icon={RotateCcwClock} title="No reading sessions yet" description="Sessions are recorded automatically while you read — only active, visible reading time counts." />
        ) : (
          days.map(([day, entries]) => {
            const total = entries.reduce((n, e) => n + e.activeSeconds, 0);
            return (
              <section key={day} className="mb-8">
                <div className="mb-3 flex items-baseline justify-between border-b border-border pb-2">
                  <h2 className="font-serif text-[17px] font-medium">{dayLabel(day)}</h2>
                  <span className="text-[12px] text-subtle">{formatDuration(total)} read</span>
                </div>
                <ol className="space-y-1">
                  {entries.map((e) => {
                    const doc = byId[e.documentId];
                    return (
                      <li key={e.id}>
                        <Link to={`/read/${e.documentId}`} className="flex items-center gap-3.5 rounded-lg px-2 py-2 hover:bg-surface">
                          <span className="w-12 shrink-0 text-right text-[12px] tabular-nums text-subtle">
                            {new Date(e.startedAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
                          </span>
                          {doc ? <DocumentCover doc={doc} small className="h-11 w-8 shrink-0 rounded-[3px] shadow-sm" /> : <span className="h-11 w-8 shrink-0 rounded-[3px] bg-border" />}
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[14px] font-medium">{e.documentTitle}</span>
                            <span className="text-[12px] text-muted">
                              {FORMAT_LABEL[e.format]} · {formatDuration(e.activeSeconds)}
                              {e.pagesRead > 0 && ` · ${e.pagesRead} ${e.format === "epub" || e.format === "txt" || e.format === "md" ? "screens" : "pages"}`}
                            </span>
                          </span>
                        </Link>
                      </li>
                    );
                  })}
                </ol>
              </section>
            );
          })
        )}
      </div>
    </div>
  );
}
