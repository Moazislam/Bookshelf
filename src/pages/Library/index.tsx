import { LibraryView } from "@/components/library/LibraryView";
import { useBreadcrumbs } from "@/hooks";

function PageHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="px-4 md:px-8 pb-2 pt-7">
      <h1 className="font-serif text-[28px] font-medium leading-tight">{title}</h1>
      {subtitle && <p className="mt-1 text-[13px] text-muted">{subtitle}</p>}
    </div>
  );
}

export function LibraryPage() {
  useBreadcrumbs([{ label: "My Library" }]);
  return (
    <>
      <PageHeader title="My Library" subtitle="Everything you've collected, in one place." />
      <LibraryView />
    </>
  );
}

export function ReadingPage() {
  useBreadcrumbs([{ label: "Currently Reading" }]);
  return (
    <>
      <PageHeader title="Currently Reading" subtitle="Pick up exactly where you left off." />
      <LibraryView preset={{ status: "reading" }} emptyTitle="Nothing in progress" emptyDescription="Open any document and it will appear here while you read it." />
    </>
  );
}

export function FavoritesPage() {
  useBreadcrumbs([{ label: "Favorites" }]);
  return (
    <>
      <PageHeader title="Favorites" subtitle="The documents you keep coming back to." />
      <LibraryView preset={{ favorites: true }} emptyTitle="No favorites yet" emptyDescription="Star a document from its menu to keep it close at hand." />
    </>
  );
}
