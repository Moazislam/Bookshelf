import { useEffect } from "react";
import { createHashRouter, Navigate, RouterProvider } from "react-router-dom";
import { Toaster } from "sonner";
import { AppShell } from "@/components/layout/AppShell";
import { RouteError } from "@/components/layout/RouteError";
import { EyeComfortOverlay } from "@/components/layout/EyeComfort";
import { DocumentDialogs } from "@/components/library/DocumentDialogs";
import { TooltipProvider } from "@/components/ui";
import { DashboardPage } from "@/pages/Dashboard";
import { FavoritesPage, LibraryPage, ReadingPage } from "@/pages/Library";
import { CollectionDetailPage, CollectionsPage } from "@/pages/Collections";
import { NotesPage } from "@/pages/Notes";
import { HistoryPage } from "@/pages/History";
import { StatisticsPage } from "@/pages/Statistics";
import { SettingsPage } from "@/pages/Settings";
import { ReaderPage } from "@/pages/Reader";
import { useLibrary } from "@/stores/library";
import { useSettings } from "@/stores/settings";
import { initImportListeners } from "@/features/documents/importer";
import { resumePendingPdfWork } from "@/services/pdfProcessing";
import { api, isTauri } from "@/services/api";

const router = createHashRouter([
  {
    path: "/",
    element: <AppShell />,
    errorElement: <RouteError />,
    children: [
      { index: true, element: <DashboardPage /> },
      { path: "library", element: <LibraryPage /> },
      { path: "reading", element: <ReadingPage /> },
      { path: "favorites", element: <FavoritesPage /> },
      { path: "collections", element: <CollectionsPage /> },
      { path: "collections/:id", element: <CollectionDetailPage /> },
      { path: "notes", element: <NotesPage /> },
      { path: "history", element: <HistoryPage /> },
      { path: "stats", element: <StatisticsPage /> },
      { path: "settings", element: <SettingsPage /> },
    ],
  },
  { path: "/read/:id", element: <ReaderPage />, errorElement: <RouteError /> },
  { path: "*", element: <Navigate to="/" replace /> },
]);

export default function App() {
  useEffect(() => {
    if (!isTauri()) return;
    (async () => {
      await useSettings.getState().load();
      await useLibrary.getState().loadAll();
      await initImportListeners();
      // Resume work that an earlier shutdown interrupted, and flag moved files.
      resumePendingPdfWork(useLibrary.getState().documents);
      api.checkMissingFiles().then((n) => { if (n) void useLibrary.getState().refreshDocuments(); }).catch(() => {});
    })();
  }, []);

  return (
    <TooltipProvider delayDuration={400} skipDelayDuration={200}>
      <RouterProvider router={router} />
      <DocumentDialogs />
      <EyeComfortOverlay />
      <Toaster
        position="bottom-right"
        toastOptions={{
          classNames: {
            toast: "!bg-surface !text-fg !border-border !shadow-lg !rounded-xl !font-sans",
            description: "!text-muted whitespace-pre-line",
            actionButton: "!bg-accent !text-accent-fg",
          },
        }}
      />
    </TooltipProvider>
  );
}
