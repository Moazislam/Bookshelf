import { useNavigate, useRouteError } from "react-router-dom";
import { TriangleExclamationPoint } from "lucide-react";
import { Button } from "@/components/ui";

/** Friendly fallback for unexpected render errors — the library data is never affected. */
export function RouteError() {
  const error = useRouteError() as Error | undefined;
  const navigate = useNavigate();
  return (
    <div className="grid h-full place-items-center bg-bg p-8">
      <div className="max-w-md text-center">
        <div className="mx-auto mb-4 grid size-12 place-items-center rounded-xl border border-border bg-surface">
          <TriangleExclamationPoint className="size-5 text-danger" />
        </div>
        <h1 className="font-serif text-xl font-medium">Something went wrong on this screen</h1>
        <p className="mt-2 text-[13px] text-muted">Your library, highlights and notes are safe. You can go back or reload the window.</p>
        {error?.message && <pre className="selectable mt-4 max-h-32 overflow-auto rounded-md bg-bg-subtle p-3 text-left text-[12px] text-muted">{error.message}</pre>}
        <div className="mt-5 flex justify-center gap-2">
          <Button onClick={() => navigate("/")}>Go to dashboard</Button>
          <Button variant="primary" onClick={() => window.location.reload()}>Reload</Button>
        </div>
      </div>
    </div>
  );
}
