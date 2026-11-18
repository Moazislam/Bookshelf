import { useState } from "react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { BookOpen, CircleCheck, Clock, FileText, Flame, Highlighter, Library, StickyNote, ChartColumn } from "lucide-react";
import { api } from "@/services/api";
import { useAsync, useBreadcrumbs } from "@/hooks";
import { EmptyState, SegmentedControl, Skeleton } from "@/components/ui";
import { formatDuration, FORMAT_LABEL, STATUS_LABEL } from "@/utils";
import type { DocFormat, ReadingStatus } from "@/types";

const tooltipStyle = { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12, color: "var(--fg)" };
const axis = { fontSize: 11, fill: "var(--fg-subtle)" };
const PALETTE = ["var(--accent)", "#5a77c0", "#5f8f68", "#c99a2e", "#9467a8", "#3f8f8a", "#c45b72", "#7c8593"];

function Card({ title, children, className = "" }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-xl border border-border bg-surface p-5 shadow-sm ${className}`}>
      <h3 className="mb-4 text-[13px] font-semibold">{title}</h3>
      {children}
    </div>
  );
}

function Metric({ icon: Icon, label, value, hint }: { icon: React.ComponentType<{ className?: string }>; label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4 shadow-sm">
      <div className="flex items-center gap-2 text-[12px] text-muted"><Icon className="size-3.5" /> {label}</div>
      <div className="mt-2 font-serif text-[26px] font-semibold tabular-nums leading-none">{value}</div>
      {hint && <div className="mt-1.5 text-[11px] text-subtle">{hint}</div>}
    </div>
  );
}

export function StatisticsPage() {
  useBreadcrumbs([{ label: "Statistics" }]);
  const [days, setDays] = useState<"30" | "90" | "365">("30");
  const { data, loading } = useAsync(() => api.getStats(Number(days)), [days]);

  if (loading && !data) {
    return (
      <div className="px-8 py-7">
        <Skeleton className="h-9 w-48" />
        <div className="mt-6 grid grid-cols-4 gap-3">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)}</div>
      </div>
    );
  }
  if (!data) return null;
  const t = data.totals;
  if (t.documents === 0) {
    return <EmptyState icon={ChartColumn} title="No statistics yet" description="Import documents and start reading — your statistics are built from real activity only." className="h-full" />;
  }

  const activity = data.activity.map((d) => ({
    ...d,
    minutes: Math.round(d.seconds / 60),
    label: new Date(d.date + "T00:00").toLocaleDateString(undefined, { day: "numeric", month: "short" }),
  }));
  const periodSeconds = data.activity.reduce((n, d) => n + d.seconds, 0);
  const periodPages = data.activity.reduce((n, d) => n + d.pages, 0);
  const activeDays = data.activity.filter((d) => d.seconds > 0).length;
  const months = data.addedPerMonth.map((b) => ({ ...b, label: new Date(b.key + "-01T00:00").toLocaleDateString(undefined, { month: "short", year: "2-digit" }) }));

  return (
    <div className="mx-auto max-w-[1240px] px-8 py-7">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="font-serif text-[28px] font-semibold">Statistics</h1>
          <p className="mt-1 text-[13px] text-muted">Derived only from your recorded reading sessions and library.</p>
        </div>
        <SegmentedControl value={days} onChange={setDays} options={[{ value: "30", label: "30 days" }, { value: "90", label: "90 days" }, { value: "365", label: "Year" }]} />
      </div>

      <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Metric icon={Library} label="Documents" value={t.documents} hint={`${t.unread} unread`} />
        <Metric icon={CircleCheck} label="Completed" value={t.completed} hint={t.documents ? `${Math.round((t.completed / t.documents) * 100)}% of library` : undefined} />
        <Metric icon={BookOpen} label="Currently reading" value={t.reading} />
        <Metric icon={Flame} label="Current streak" value={`${data.streakDays} ${data.streakDays === 1 ? "day" : "days"}`} />
        <Metric icon={Clock} label="Total reading time" value={formatDuration(t.readingSeconds)} hint={`${t.sessions} sessions`} />
        <Metric icon={FileText} label="Pages read" value={t.pagesRead.toLocaleString()} hint="Pages / screens viewed ≥ 4s" />
        <Metric icon={Highlighter} label="Highlights" value={t.highlights} />
        <Metric icon={StickyNote} label="Notes" value={t.notes} hint={`${t.bookmarks} bookmarks`} />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card title={`Reading activity · ${formatDuration(periodSeconds)} over ${activeDays} active day${activeDays === 1 ? "" : "s"} · ${periodPages} pages`} className="lg:col-span-2">
          <div className="h-[240px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={activity} margin={{ left: -18, right: 4, top: 4 }}>
                <defs>
                  <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="var(--accent)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 3" />
                <XAxis dataKey="label" tick={axis} axisLine={false} tickLine={false} minTickGap={24} />
                <YAxis tick={axis} axisLine={false} tickLine={false} allowDecimals={false} />
                <Tooltip contentStyle={tooltipStyle} formatter={(v, n) => [n === "minutes" ? `${v} min` : v, n === "minutes" ? "Reading" : "Pages"]} />
                <Area type="monotone" dataKey="minutes" stroke="var(--accent)" strokeWidth={2} fill="url(#g)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card title="Library by status">
          <div className="space-y-2.5">
            {(["unread", "reading", "completed", "on_hold", "abandoned"] as ReadingStatus[]).map((s) => {
              const n = data.byStatus.find((b) => b.key === s)?.count ?? 0;
              return (
                <div key={s}>
                  <div className="mb-1 flex justify-between text-[12px]"><span className="text-muted">{STATUS_LABEL[s]}</span><span className="tabular-nums">{n}</span></div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-border/70"><div className="h-full rounded-full bg-accent" style={{ width: `${t.documents ? (n / t.documents) * 100 : 0}%`, opacity: s === "completed" ? 1 : 0.75 }} /></div>
                </div>
              );
            })}
          </div>
        </Card>
        <Card title="Documents added per month">
          <div className="h-[200px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={months} margin={{ left: -24, right: 4 }}>
                <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 3" />
                <XAxis dataKey="label" tick={axis} axisLine={false} tickLine={false} />
                <YAxis tick={axis} axisLine={false} tickLine={false} allowDecimals={false} />
                <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "var(--bg-subtle)" }} formatter={(v) => [v, "Added"]} />
                <Bar dataKey="count" fill="var(--accent)" radius={[4, 4, 0, 0]} maxBarSize={30} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card title="Library by format">
          <div className="flex h-[200px] items-center gap-4">
            <ResponsiveContainer width="55%" height="100%">
              <PieChart>
                <Pie data={data.byFormat} dataKey="count" nameKey="key" innerRadius={48} outerRadius={78} paddingAngle={2} stroke="var(--surface)">
                  {data.byFormat.map((_, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} />)}
                </Pie>
                <Tooltip contentStyle={tooltipStyle} formatter={(v, n) => [v, FORMAT_LABEL[n as DocFormat] ?? n]} />
              </PieChart>
            </ResponsiveContainer>
            <ul className="space-y-1.5 text-[12px]">
              {data.byFormat.map((b, i) => (
                <li key={b.key} className="flex items-center gap-2">
                  <span className="size-2.5 rounded-sm" style={{ background: PALETTE[i % PALETTE.length] }} />
                  <span className="text-muted">{FORMAT_LABEL[b.key as DocFormat] ?? b.key}</span>
                  <span className="tabular-nums">{b.count}</span>
                  {b.seconds > 0 && <span className="text-subtle">· {formatDuration(b.seconds)}</span>}
                </li>
              ))}
            </ul>
          </div>
        </Card>
        <Card title="Reading time by collection">
          {data.byCollection.some((b) => b.seconds > 0) ? (
            <div className="h-[200px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.byCollection.filter((b) => b.seconds > 0).map((b) => ({ ...b, minutes: Math.round(b.seconds / 60) }))} layout="vertical" margin={{ left: 8, right: 8 }}>
                  <XAxis type="number" hide />
                  <YAxis type="category" dataKey="key" tick={axis} axisLine={false} tickLine={false} width={96} />
                  <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "var(--bg-subtle)" }} formatter={(v) => [`${v} min`, "Reading"]} />
                  <Bar dataKey="minutes" fill="var(--accent)" radius={[0, 4, 4, 0]} maxBarSize={18} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="grid h-[200px] place-items-center text-center text-[12.5px] text-subtle">Read documents that belong to collections to see this breakdown.</p>
          )}
        </Card>
      </div>
    </div>
  );
}
