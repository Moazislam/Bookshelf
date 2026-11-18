import { useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowRight, BookOpen, CircleCheck, Flame, Folder, Highlighter, Library, Settings2, StickyNote, Upload, FileText } from "lucide-react";
import { Bar, BarChart, ResponsiveContainer, Tooltip as ChartTooltip, XAxis } from "recharts";
import { Button, DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuLabel, DropdownMenuTrigger, EmptyState, Progress, Skeleton } from "@/components/ui";
import { DocumentCover } from "@/components/library/DocumentCover";
import { useAsync, useBreadcrumbs } from "@/hooks";
import { useLibrary } from "@/stores/library";
import { useSettings } from "@/stores/settings";
import { api } from "@/services/api";
import { pickAndImportFiles } from "@/features/documents/importer";
import { formatDuration, greeting, relativeTime, swatch, FORMAT_LABEL } from "@/utils";
import type { Document } from "@/types";

function Section({ title, to, children, action }: { title: string; to?: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className="animate-slide-up">
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="font-serif text-[19px] font-semibold">{title}</h2>
        {action ?? (to && (
          <Link to={to} className="flex items-center gap-1 text-[12.5px] text-muted hover:text-fg">
            View all <ArrowRight className="size-3.5" />
          </Link>
        ))}
      </div>
      {children}
    </section>
  );
}

function ContinueCard({ doc }: { doc: Document }) {
  const navigate = useNavigate();
  return (
    <div className="group flex gap-4 rounded-xl border border-border bg-surface p-3.5 shadow-sm transition-all hover:shadow-md">
      <DocumentCover doc={doc} className="aspect-[2/3] w-[76px] shrink-0 rounded-[4px] shadow-md" />
      <div className="flex min-w-0 flex-1 flex-col">
        <h3 className="line-clamp-2 font-semibold leading-snug">{doc.title}</h3>
        <p className="mt-0.5 truncate text-[12.5px] text-muted">{doc.author || "Unknown author"}</p>
        <div className="mt-auto">
          <div className="mb-1.5 flex items-center justify-between text-[11.5px] text-subtle">
            <span>{Math.round(doc.progress * 100)}% · {FORMAT_LABEL[doc.format]}</span>
            <span>{relativeTime(doc.openedAt)}</span>
          </div>
          <Progress value={doc.progress} />
          <Button size="sm" variant="primary" className="mt-3 w-full" onClick={() => navigate(`/read/${doc.id}`)} disabled={doc.missing}>
            <BookOpen /> Continue reading
          </Button>
        </div>
      </div>
    </div>
  );
}

function StatTile({ icon: Icon, label, value }: { icon: React.ComponentType<{ className?: string }>; label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4 shadow-sm">
      <div className="flex items-center gap-2 text-[12px] text-muted">
        <Icon className="size-3.5" /> {label}
      </div>
      <div className="mt-2 font-serif text-[26px] font-semibold tabular-nums leading-none">{value}</div>
    </div>
  );
}

export function DashboardPage() {
  useBreadcrumbs([{ label: "Dashboard" }]);
  const loaded = useLibrary((s) => s.loaded);
  const documents = useLibrary((s) => s.documents);
  const collections = useLibrary((s) => s.collections);
  const sections = useSettings((s) => s.values["dashboard.sections"]);
  const name = useSettings((s) => s.values["profile.name"]);
  const setSetting = useSettings((s) => s.set);
  const stats = useAsync(() => api.getStats(14), [documents.length]);

  const continueReading = useMemo(() => documents.filter((d) => d.status === "reading" && !d.missing).sort((a, b) => (b.openedAt ?? 0) - (a.openedAt ?? 0)).slice(0, 4), [documents]);
  const recent = useMemo(() => [...documents].sort((a, b) => b.addedAt - a.addedAt).slice(0, 8), [documents]);
  const week = stats.data?.activity.slice(-7) ?? [];
  const weekSeconds = week.reduce((n, d) => n + d.seconds, 0);

  if (loaded && documents.length === 0) {
    return (
      <div className="mx-auto max-w-3xl px-8 py-16">
        <h1 className="font-serif text-[34px] font-semibold">{greeting()}{name ? `, ${name}` : ""}.</h1>
        <p className="mt-2 text-[15px] text-muted">Welcome to BookShelf — a quiet place for everything you read.</p>
        <div className="mt-10 rounded-2xl border border-dashed border-border-strong bg-surface p-10 text-center">
          <div className="mx-auto grid size-14 place-items-center rounded-2xl bg-accent-soft text-accent">
            <Library className="size-6" />
          </div>
          <h2 className="mt-5 font-serif text-xl font-semibold">Start your library</h2>
          <p className="mx-auto mt-2 max-w-md text-[13.5px] text-muted">
            Drop PDFs, EPUBs, comics (CBZ), text or Markdown files anywhere in this window — or import a whole folder. Your files stay exactly where they are.
          </p>
          <Button variant="primary" size="lg" className="mt-6" onClick={() => pickAndImportFiles()}>
            <Upload /> Import documents
          </Button>
        </div>
      </div>
    );
  }

  const t = stats.data?.totals;
  return (
    <div className="mx-auto flex max-w-[1240px] flex-col gap-9 px-8 py-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-serif text-[32px] font-semibold leading-tight">{greeting()}{name ? `, ${name}` : ""}.</h1>
          <p className="mt-1.5 text-[14px] text-muted">
            {documents.length} documents in your library
            {weekSeconds > 0 ? ` · ${formatDuration(weekSeconds)} read this week` : " · no reading logged this week yet"}
            {stats.data && stats.data.streakDays > 1 ? ` · ${stats.data.streakDays}-day streak` : ""}
          </p>
        </div>
        <div className="flex gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="icon" aria-label="Customize dashboard"><Settings2 /></Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-52">
              <DropdownMenuLabel>Show sections</DropdownMenuLabel>
              {(
                [
                  ["continue", "Continue reading"],
                  ["stats", "Quick statistics"],
                  ["recent", "Recently added"],
                  ["collections", "Collections"],
                  ["activity", "Reading activity"],
                ] as const
              ).map(([k, label]) => (
                <DropdownMenuCheckboxItem key={k} checked={sections[k]} onSelect={(e) => { e.preventDefault(); setSetting("dashboard.sections", { ...sections, [k]: !sections[k] }); }}>
                  {label}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <Button variant="primary" onClick={() => pickAndImportFiles()}>
            <Upload /> Import
          </Button>
        </div>
      </header>

      {sections.continue && (
        <Section title="Continue reading" to="/reading">
          {continueReading.length ? (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(290px,1fr))] gap-4">
              {continueReading.map((d) => <ContinueCard key={d.id} doc={d} />)}
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-border-strong px-6 py-8 text-center text-[13px] text-muted">
              Nothing in progress. Open a document from your library to start reading.
            </div>
          )}
        </Section>
      )}

      {sections.stats && (
        <Section title="At a glance" to="/stats">
          {t ? (
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
              <StatTile icon={Library} label="Documents" value={t.documents} />
              <StatTile icon={FileText} label="Pages read" value={t.pagesRead.toLocaleString()} />
              <StatTile icon={BookOpen} label="Reading now" value={t.reading} />
              <StatTile icon={CircleCheck} label="Completed" value={t.completed} />
              <StatTile icon={Highlighter} label="Highlights" value={t.highlights} />
              <StatTile icon={StickyNote} label="Notes" value={t.notes} />
            </div>
          ) : (
            <div className="grid grid-cols-6 gap-3">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-[86px] rounded-xl" />)}</div>
          )}
        </Section>
      )}

      {sections.recent && (
        <Section title="Recently added" to="/library">
          <div className="grid grid-cols-[repeat(auto-fill,minmax(128px,1fr))] gap-4">
            {recent.map((d) => (
              <Link key={d.id} to={`/read/${d.id}`} className="group">
                <DocumentCover doc={d} className="aspect-[2/3] w-full rounded-[4px] shadow-md transition-transform group-hover:-translate-y-0.5 group-hover:shadow-lg" />
                <div className="mt-2 line-clamp-2 text-[12.5px] font-medium leading-snug">{d.title}</div>
                <div className="truncate text-[11.5px] text-muted">{relativeTime(d.addedAt)}</div>
              </Link>
            ))}
          </div>
        </Section>
      )}

      <div className="grid gap-9 lg:grid-cols-[1fr_1.3fr]">
        {sections.collections && (
          <Section title="Collections" to="/collections">
            {collections.filter((c) => !c.parentId).length ? (
              <div className="grid grid-cols-2 gap-2.5">
                {collections.filter((c) => !c.parentId).slice(0, 6).map((c) => (
                  <Link key={c.id} to={`/collections/${c.id}`} className="flex items-center gap-3 rounded-lg border border-border bg-surface p-3 shadow-sm transition-colors hover:border-border-strong">
                    <div className="grid size-9 shrink-0 place-items-center rounded-lg" style={{ background: `color-mix(in srgb, ${swatch(c.color)} 18%, var(--surface))` }}>
                      <Folder className="size-4" style={{ color: swatch(c.color) }} />
                    </div>
                    <div className="min-w-0">
                      <div className="truncate text-[13px] font-medium">{c.name}</div>
                      <div className="text-[11.5px] text-subtle">{c.documentCount} documents</div>
                    </div>
                  </Link>
                ))}
              </div>
            ) : (
              <EmptyState icon={Folder} title="No collections" description="Group related documents into collections." className="rounded-xl border border-dashed border-border-strong py-8" />
            )}
          </Section>
        )}
        {sections.activity && (
          <Section title="Reading activity" action={<span className="text-[12px] text-subtle">Last 14 days</span>}>
            <div className="h-[200px] rounded-xl border border-border bg-surface p-4 shadow-sm">
              {stats.data ? (
                stats.data.activity.some((d) => d.seconds > 0) ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={stats.data.activity.map((d) => ({ ...d, minutes: Math.round(d.seconds / 60), label: new Date(d.date + "T00:00").toLocaleDateString(undefined, { day: "numeric", month: "short" }) }))}>
                      <XAxis dataKey="label" tick={{ fontSize: 10.5, fill: "var(--fg-subtle)" }} axisLine={false} tickLine={false} interval={1} />
                      <ChartTooltip cursor={{ fill: "var(--bg-subtle)" }} contentStyle={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }} formatter={(v) => [`${v} min`, "Reading"]} />
                      <Bar dataKey="minutes" fill="var(--accent)" radius={[4, 4, 0, 0]} maxBarSize={28} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="grid h-full place-items-center text-center text-[13px] text-muted">
                    <div>
                      <Flame className="mx-auto mb-2 size-5 text-subtle" />
                      Your reading time will appear here as you read.
                    </div>
                  </div>
                )
              ) : (
                <Skeleton className="h-full w-full" />
              )}
            </div>
          </Section>
        )}
      </div>
    </div>
  );
}
