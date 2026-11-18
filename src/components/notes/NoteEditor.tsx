import { useEffect, useRef, useState } from "react";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import Placeholder from "@tiptap/extension-placeholder";
import { Markdown } from "@tiptap/markdown";
import { Bold, Code, Heading1, Heading2, Italic, Link2, List, ListChecks, ListOrdered, Quote, SquareCode } from "lucide-react";
import { api, errorMessage } from "@/services/api";
import { cn } from "@/utils";
import { Tooltip } from "@/components/ui";
import type { Note } from "@/types";

export type SaveState = "saved" | "saving" | "dirty" | "error";

function ToolbarButton({ label, active, onClick, children }: { label: string; active?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <Tooltip content={label}>
      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={onClick}
        className={cn("grid size-7 place-items-center rounded-md text-muted transition-colors hover:bg-bg-subtle hover:text-fg [&_svg]:size-4", active && "bg-bg-subtle text-fg")}
        aria-label={label}
      >
        {children}
      </button>
    </Tooltip>
  );
}

function Toolbar({ editor }: { editor: Editor }) {
  const [, force] = useState(0);
  useEffect(() => {
    const f = () => force((x) => x + 1);
    editor.on("transaction", f);
    return () => {
      editor.off("transaction", f);
    };
  }, [editor]);
  const c = () => editor.chain().focus();
  return (
    <div className="flex flex-wrap items-center gap-0.5">
      <ToolbarButton label="Heading 1" active={editor.isActive("heading", { level: 1 })} onClick={() => c().toggleHeading({ level: 1 }).run()}><Heading1 /></ToolbarButton>
      <ToolbarButton label="Heading 2" active={editor.isActive("heading", { level: 2 })} onClick={() => c().toggleHeading({ level: 2 }).run()}><Heading2 /></ToolbarButton>
      <span className="mx-1 h-4 w-px bg-border" />
      <ToolbarButton label="Bold (Ctrl+B)" active={editor.isActive("bold")} onClick={() => c().toggleBold().run()}><Bold /></ToolbarButton>
      <ToolbarButton label="Italic (Ctrl+I)" active={editor.isActive("italic")} onClick={() => c().toggleItalic().run()}><Italic /></ToolbarButton>
      <ToolbarButton label="Inline code" active={editor.isActive("code")} onClick={() => c().toggleCode().run()}><Code /></ToolbarButton>
      <ToolbarButton
        label="Link"
        active={editor.isActive("link")}
        onClick={() => {
          const prev = editor.getAttributes("link").href as string | undefined;
          const url = window.prompt("Link URL", prev ?? "https://");
          if (url === null) return;
          if (!url) c().unsetLink().run();
          else c().extendMarkRange("link").setLink({ href: url }).run();
        }}
      >
        <Link2 />
      </ToolbarButton>
      <span className="mx-1 h-4 w-px bg-border" />
      <ToolbarButton label="Bullet list" active={editor.isActive("bulletList")} onClick={() => c().toggleBulletList().run()}><List /></ToolbarButton>
      <ToolbarButton label="Numbered list" active={editor.isActive("orderedList")} onClick={() => c().toggleOrderedList().run()}><ListOrdered /></ToolbarButton>
      <ToolbarButton label="Checklist" active={editor.isActive("taskList")} onClick={() => c().toggleTaskList().run()}><ListChecks /></ToolbarButton>
      <ToolbarButton label="Quote" active={editor.isActive("blockquote")} onClick={() => c().toggleBlockquote().run()}><Quote /></ToolbarButton>
      <ToolbarButton label="Code block" active={editor.isActive("codeBlock")} onClick={() => c().toggleCodeBlock().run()}><SquareCode /></ToolbarButton>
    </div>
  );
}

export function SaveIndicator({ state }: { state: SaveState }) {
  const label = { saved: "Saved", saving: "Saving…", dirty: "Unsaved changes", error: "Could not save — retrying" }[state];
  return (
    <span className={cn("flex items-center gap-1.5 text-[11.5px]", state === "error" ? "text-danger" : "text-subtle")}>
      <span className={cn("size-1.5 rounded-full", state === "saved" ? "bg-success" : state === "error" ? "bg-danger" : "bg-warning animate-pulse")} />
      {label}
    </span>
  );
}

/**
 * Markdown note editor with debounced autosave. Pending changes are flushed on
 * unmount and on window close so nothing typed is ever lost.
 */
export function NoteEditor({ note, onSaved, compact, autoFocus }: { note: Note; onSaved?: (n: Note) => void; compact?: boolean; autoFocus?: boolean }) {
  const [title, setTitle] = useState(note.title);
  const [state, setState] = useState<SaveState>("saved");
  const pending = useRef<{ title?: string; body?: string }>({});
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const noteId = useRef(note.id);
  const onSavedRef = useRef(onSaved);
  onSavedRef.current = onSaved;

  const flush = useRef(async () => {
    clearTimeout(timer.current);
    const patch = pending.current;
    if (patch.title === undefined && patch.body === undefined) return;
    pending.current = {};
    setState("saving");
    try {
      const saved = await api.updateNote(noteId.current, patch);
      setState(Object.keys(pending.current).length ? "dirty" : "saved");
      onSavedRef.current?.(saved);
    } catch (e) {
      console.error("Note save failed", errorMessage(e));
      pending.current = { ...patch, ...pending.current };
      setState("error");
      timer.current = setTimeout(() => void flush.current(), 3000);
    }
  });

  const schedule = (patch: { title?: string; body?: string }) => {
    pending.current = { ...pending.current, ...patch };
    setState("dirty");
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush.current(), 700);
  };

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ link: { openOnClick: false, autolink: true } }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Placeholder.configure({ placeholder: "Write your thoughts… Markdown shortcuts like #, -, [ ] and > work as you type." }),
      Markdown,
    ],
    content: note.body,
    contentType: "markdown",
    autofocus: autoFocus ? "end" : false,
    onUpdate: ({ editor }) => schedule({ body: editor.getMarkdown() }),
  });

  // Flush when switching notes / unmounting / closing the window.
  useEffect(() => {
    const before = () => void flush.current();
    window.addEventListener("beforeunload", before);
    return () => {
      window.removeEventListener("beforeunload", before);
      void flush.current();
    };
  }, []);

  if (!editor) return null;
  return (
    <div className={cn("note-editor flex min-h-0 flex-col", compact ? "gap-2" : "gap-4")}>
      <input
        value={title}
        onChange={(e) => {
          setTitle(e.target.value);
          schedule({ title: e.target.value });
        }}
        placeholder="Untitled note"
        className={cn("w-full bg-transparent font-serif font-semibold outline-none placeholder:text-subtle", compact ? "text-[16px]" : "text-[26px]")}
      />
      <div className={cn("flex items-center justify-between gap-2 border-y border-border py-1.5", compact && "py-1")}>
        <Toolbar editor={editor} />
        <SaveIndicator state={state} />
      </div>
      <EditorContent editor={editor} className={cn("selectable min-h-0 flex-1", compact && "[&_.ProseMirror]:min-h-40 [&_.ProseMirror]:text-[14px]")} />
    </div>
  );
}
