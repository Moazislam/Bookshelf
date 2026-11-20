import { useEffect, useRef, useState } from "react";
import { Check, Download, Languages, Loader2, ScanText, Trash } from "lucide-react";
import { toast } from "sonner";
import { Button, Dialog, DialogContent, DialogFooter, Progress } from "@/components/ui";
import { errorMessage, fileUrl, isMobile } from "@/services/api";
import { cancelOcr, defaultOcrLanguages, savedOcrProgress, startOcr, useOcr, type OcrJob } from "@/services/ocr";
import { BUILT_IN, OCR_LANGUAGES, languageName, useOcrLanguages } from "@/services/ocrLanguages";
import { useLibrary } from "@/stores/library";
import { useSettings } from "@/stores/settings";
import { cn, formatBytes } from "@/utils";

/** The OCR screen: pick languages and start, then watch progress or send it to the background. */
export function OcrDialog() {
  const id = useOcr((s) => s.dialogId);
  const close = useOcr((s) => s.closeDialog);
  const doc = useLibrary((s) => (id ? s.byId[id] : undefined));
  const job = useOcr((s) => (id ? s.jobs[id] : undefined));
  // Close once the job ends (finished, stopped or failed); a toast reports the outcome.
  const hadJob = useRef(false);
  useEffect(() => {
    hadJob.current = false;
  }, [id]);
  useEffect(() => {
    if (job) hadJob.current = true;
    else if (hadJob.current) {
      hadJob.current = false;
      close();
    }
  }, [job, close]);
  return (
    <Dialog open={!!id && !!doc} onOpenChange={(o) => !o && close()}>
      {doc && (
        <DialogContent
          title={job ? "Recognising text" : "Recognise text (OCR)"}
          description={job ? undefined : "Reads the words on each scanned page so you can search this book. Everything runs on this device."}
          // While a job runs, clicking outside shouldn't dismiss the screen by accident.
          onInteractOutside={(e) => job && e.preventDefault()}
        >
          <div className="flex gap-4">
            {doc.hasCover && <img src={fileUrl.cover(doc.id, doc.updatedAt)} alt="" className="h-24 w-16 shrink-0 rounded-md border border-border object-cover" />}
            <div className="min-w-0 flex-1">
              <div className="line-clamp-2 font-medium">{doc.title}</div>
              {doc.author && <div className="truncate text-[13px] text-muted">{doc.author}</div>}
              {doc.pageCount ? <div className="mt-0.5 text-[12px] text-subtle">{doc.pageCount} pages</div> : null}
            </div>
          </div>
          {job ? <OcrProgress job={job} onBackground={close} /> : <OcrSetup docId={doc.id} pages={doc.pageCount ?? 0} />}
        </DialogContent>
      )}
    </Dialog>
  );
}

function OcrSetup({ docId, pages }: { docId: string; pages: number }) {
  const doc = useLibrary((s) => s.byId[docId]);
  const installed = useOcrLanguages((s) => s.installed);
  const [langs, setLangs] = useState<string[]>(() => defaultOcrLanguages());
  const [saved, setSaved] = useState<{ next: number; langs: string[] } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void savedOcrProgress(docId).then(setSaved);
  }, [docId]);
  const ready = langs.filter((l) => installed.has(l));

  const start = async (resume: boolean) => {
    if (!doc) return;
    setBusy(true);
    try {
      if (!resume) void useSettings.getState().set("ocr.languages", ready);
      await startOcr(doc, ready, resume);
    } catch (e) {
      toast.error("Could not start text recognition", { description: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="mt-5 mb-2 flex items-center gap-2 text-[13px] font-medium text-muted">
        <Languages className="size-3.5" /> Languages in this book
      </div>
      <LanguagePicker selected={langs} onChange={setLangs} />
      <p className="mt-2 text-[12px] text-subtle">
        Pick only the languages the book is written in: each extra one makes recognition slower. Numbers are always recognised.
        {pages > 0 && ` About ${estimate(pages * (isMobile() ? 6 : 2.5) * Math.max(1, ready.length * 0.7))} for ${pages} pages.`}
      </p>
      <DialogFooter>
        {saved && (
          <Button disabled={busy} onClick={() => start(true)}>
            Resume at page {saved.next}
          </Button>
        )}
        <Button variant="primary" disabled={busy || ready.length === 0} onClick={() => start(false)}>
          <ScanText /> {saved ? "Start over" : "Start"}
        </Button>
      </DialogFooter>
    </>
  );
}

function OcrProgress({ job, onBackground }: { job: OcrJob; onBackground: () => void }) {
  // Re-render every second so the time estimate keeps moving.
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);
  const pct = job.total ? job.done / job.total : 0;
  const doneThisRun = job.done - job.startedPage;
  const perPage = doneThisRun > 0 ? (Date.now() - job.startedAt) / 1000 / doneThisRun : null;
  const left = perPage && job.total ? estimate((job.total - job.done) * perPage) : null;

  return (
    <>
      <div className="mt-6 flex flex-col items-center text-center">
        <div className="relative mb-4 grid size-14 place-items-center rounded-2xl border border-border bg-bg-subtle">
          <ScanText className="size-6 text-accent" />
          <Loader2 className="absolute -right-1.5 -bottom-1.5 size-5 animate-spin rounded-full bg-surface text-accent" />
        </div>
        <div className="text-[15px] font-medium">
          {job.status === "queued" ? "Waiting for another book to finish…" : job.total ? `Page ${Math.min(job.done + 1, job.total)} of ${job.total}` : "Opening the book…"}
        </div>
        <div className="mt-1 text-[13px] text-muted">
          {Math.round(pct * 100)}% · text found on {job.found} page{job.found === 1 ? "" : "s"}
          {left && ` · about ${left} left`}
        </div>
      </div>
      <Progress value={pct} className="mt-4 h-1.5" />
      <div className="mt-2 text-center text-[12px] text-subtle">{job.langs.map(languageName).join(", ")}</div>
      <p className="mt-4 rounded-lg border border-border bg-bg-subtle p-3 text-[12px] text-muted">
        {isMobile()
          ? "You can keep reading or browsing while this runs, but keep BookShelf open: Android pauses apps in the background. If the app is closed, recognition picks up where it stopped next time you open it."
          : "You can keep reading or browsing while this runs. If you quit BookShelf, recognition picks up where it stopped next time."}
      </p>
      <DialogFooter>
        <Button variant="ghost" onClick={() => cancelOcr(job.id)}>
          Stop
        </Button>
        <Button variant="primary" onClick={onBackground}>
          Run in background
        </Button>
      </DialogFooter>
    </>
  );
}

/** Language chips: tap to select; languages not on the device show a download button. */
export function LanguagePicker({ selected, onChange }: { selected?: string[]; onChange?: (langs: string[]) => void }) {
  const { installed, downloading, loaded, refresh, download, remove } = useOcrLanguages();
  useEffect(() => {
    if (!loaded) void refresh();
  }, [loaded, refresh]);
  const manage = !onChange;

  const get = async (code: string) => {
    try {
      await download(code);
      if (onChange && selected && !selected.includes(code)) onChange([...selected, code]);
    } catch (e) {
      toast.error(`Could not download ${languageName(code)}`, { description: `${errorMessage(e)}. Check your internet connection and try again.` });
    }
  };

  return (
    <div className="flex flex-wrap gap-1.5">
      {OCR_LANGUAGES.map((l) => {
        const have = installed.has(l.code);
        const on = !!selected?.includes(l.code);
        const dl = downloading[l.code];
        if (!have) {
          return (
            <button
              key={l.code}
              disabled={dl !== undefined}
              onClick={() => get(l.code)}
              className="inline-flex h-7 items-center gap-1.5 rounded-full border border-dashed border-border px-2.5 text-[13px] text-muted hover:border-accent hover:text-fg disabled:opacity-70"
              title={`Download ${l.name} (${formatBytes(l.size)})`}
            >
              {dl !== undefined ? <Loader2 className="size-3.5 animate-spin" /> : <Download className="size-3.5" />}
              {l.name}
              <span className="text-[11px] text-subtle">{dl !== undefined ? `${Math.round(dl * 100)}%` : formatBytes(l.size)}</span>
            </button>
          );
        }
        if (manage) {
          return (
            <span key={l.code} className="inline-flex h-7 items-center gap-1.5 rounded-full border border-border bg-bg-subtle pl-2.5 pr-1 text-[13px]">
              <Check className="size-3.5 text-accent" /> {l.name}
              {l.code === BUILT_IN ? (
                <span className="pr-1.5 text-[11px] text-subtle">built in</span>
              ) : (
                <button onClick={() => remove(l.code)} className="grid size-5 place-items-center rounded-full text-subtle hover:bg-surface hover:text-danger" aria-label={`Remove ${l.name}`}>
                  <Trash className="size-3" />
                </button>
              )}
            </span>
          );
        }
        return (
          <button
            key={l.code}
            onClick={() => onChange?.(on ? (selected ?? []).filter((c) => c !== l.code) : [...(selected ?? []), l.code])}
            aria-pressed={on}
            className={cn(
              "inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-[13px] transition-colors",
              on ? "border-accent bg-accent-soft text-fg" : "border-border text-muted hover:text-fg",
            )}
          >
            {on && <Check className="size-3.5 text-accent" />}
            {l.name}
          </button>
        );
      })}
    </div>
  );
}

function estimate(seconds: number) {
  if (seconds < 90) return "a minute";
  const m = Math.round(seconds / 60);
  if (m < 60) return `${m} minutes`;
  const h = Math.floor(m / 60);
  return `${h} h ${m % 60} min`;
}
