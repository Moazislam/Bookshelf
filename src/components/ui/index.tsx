/* shadcn/ui-style primitives built on Radix, themed with our design tokens. */
import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import * as DropdownPrimitive from "@radix-ui/react-dropdown-menu";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import * as ContextPrimitive from "@radix-ui/react-context-menu";
import { cva, type VariantProps } from "class-variance-authority";
import { Check, ChevronRight, X } from "lucide-react";
import { cn } from "@/utils";

// Button ------------------------------------------------------------------------

export const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md font-medium transition-[background,color,box-shadow,opacity] duration-150 disabled:pointer-events-none disabled:opacity-45 [&_svg]:shrink-0 select-none",
  {
    variants: {
      variant: {
        primary: "bg-accent text-accent-fg shadow-sm hover:brightness-[1.06] active:brightness-95",
        secondary: "bg-surface text-fg border border-border shadow-sm hover:bg-surface-2 hover:border-border-strong",
        ghost: "text-muted hover:text-fg hover:bg-bg-subtle",
        subtle: "bg-bg-subtle text-fg hover:bg-border/60",
        danger: "bg-danger text-white shadow-sm hover:brightness-110",
        link: "text-accent underline-offset-4 hover:underline px-0",
      },
      size: {
        sm: "h-7 px-2.5 text-[12.5px] [&_svg]:size-3.5",
        md: "h-8.5 px-3.5 text-[13px] [&_svg]:size-4",
        lg: "h-10 px-5 text-sm [&_svg]:size-4",
        icon: "size-8 [&_svg]:size-4",
        "icon-sm": "size-7 [&_svg]:size-3.5",
      },
    },
    defaultVariants: { variant: "secondary", size: "md" },
  },
);

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant, size, type = "button", ...props }, ref) => (
  <button ref={ref} type={type} className={cn(buttonVariants({ variant, size }), className)} {...props} />
));
Button.displayName = "Button";

// Inputs ------------------------------------------------------------------------

const fieldBase =
  "w-full rounded-md border border-border bg-surface px-3 text-[13px] text-fg placeholder:text-subtle shadow-sm transition-colors focus:outline-none focus:border-accent/70 focus:ring-3 focus:ring-ring/40 disabled:opacity-50";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(({ className, ...props }, ref) => (
  <input ref={ref} className={cn(fieldBase, "h-8.5", className)} {...props} />
));
Input.displayName = "Input";

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => <textarea ref={ref} className={cn(fieldBase, "py-2 min-h-20 resize-y leading-relaxed", className)} {...props} />,
);
Textarea.displayName = "Textarea";

export function Select({ className, children, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cn(fieldBase, "h-8.5 pr-8 appearance-none bg-[length:14px] bg-[right_10px_center] bg-no-repeat", className)}
      style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23888' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E")` }}
      {...props}>
      {children}
    </select>
  );
}

export function Label({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn("text-[12px] font-medium text-muted", className)} {...props} />;
}

export function Field({ label, hint, children, className }: { label: string; hint?: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <Label>{label}</Label>
      {children}
      {hint && <p className="text-[11.5px] text-subtle">{hint}</p>}
    </div>
  );
}

export function Switch({ checked, onChange, disabled, label }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; label?: string }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors disabled:opacity-50",
        checked ? "bg-accent" : "bg-border-strong",
      )}
    >
      <span className={cn("inline-block size-4 rounded-full bg-white shadow transition-transform", checked ? "translate-x-4.5" : "translate-x-0.5")} />
    </button>
  );
}

export function Slider({ value, min, max, step = 1, onChange, className, label }: { value: number; min: number; max: number; step?: number; onChange: (v: number) => void; className?: string; label?: string }) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <input
      type="range"
      aria-label={label}
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      className={cn("h-1.5 w-full cursor-pointer appearance-none rounded-full accent-[var(--accent)]", className)}
      style={{ background: `linear-gradient(to right, var(--accent) ${pct}%, var(--border) ${pct}%)` }}
    />
  );
}

// Display -----------------------------------------------------------------------

export function Badge({ className, tone = "neutral", ...props }: React.HTMLAttributes<HTMLSpanElement> & { tone?: "neutral" | "accent" | "success" | "warning" | "danger" }) {
  const tones = {
    neutral: "bg-bg-subtle text-muted border-border",
    accent: "bg-accent-soft text-accent border-accent/20",
    success: "bg-success/10 text-success border-success/20",
    warning: "bg-warning/10 text-warning border-warning/25",
    danger: "bg-danger/10 text-danger border-danger/20",
  };
  return <span className={cn("inline-flex items-center gap-1 rounded-[5px] border px-1.5 py-px text-[10.5px] font-semibold uppercase tracking-wide", tones[tone], className)} {...props} />;
}

export function Progress({ value, className, tone = "accent" }: { value: number; className?: string; tone?: "accent" | "success" }) {
  return (
    <div className={cn("h-1 w-full overflow-hidden rounded-full bg-border/70", className)} role="progressbar" aria-valuenow={Math.round(value * 100)} aria-valuemin={0} aria-valuemax={100}>
      <div className={cn("h-full rounded-full transition-[width] duration-500", tone === "success" ? "bg-success" : "bg-accent")} style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }} />
    </div>
  );
}

export function Kbd({ children, className }: { children: React.ReactNode; className?: string }) {
  return <kbd className={cn("inline-flex h-5 min-w-5 items-center justify-center rounded border border-border bg-surface-2 px-1 font-sans text-[10.5px] font-medium text-muted shadow-sm", className)}>{children}</kbd>;
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-md bg-border/60", className)} />;
}

export function Spinner({ className }: { className?: string }) {
  return <span className={cn("inline-block size-4 animate-spin rounded-full border-2 border-current border-t-transparent opacity-70", className)} aria-label="Loading" />;
}

export function EmptyState({ icon: Icon, title, description, action, className }: { icon: React.ComponentType<{ className?: string }>; title: string; description?: React.ReactNode; action?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col items-center justify-center px-6 py-16 text-center animate-fade-in", className)}>
      <div className="mb-4 grid size-12 place-items-center rounded-xl border border-border bg-surface shadow-sm">
        <Icon className="size-5 text-muted" />
      </div>
      <h3 className="font-serif text-lg font-semibold">{title}</h3>
      {description && <p className="mt-1.5 max-w-sm text-[13px] text-muted">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function Separator({ className, vertical }: { className?: string; vertical?: boolean }) {
  return <div className={cn(vertical ? "w-px self-stretch bg-border" : "h-px w-full bg-border", className)} />;
}

export function SegmentedControl<T extends string>({ value, onChange, options, className, size = "md" }: { value: T; onChange: (v: T) => void; options: { value: T; label: React.ReactNode; title?: string }[]; className?: string; size?: "sm" | "md" }) {
  return (
    <div className={cn("inline-flex rounded-md border border-border bg-bg-subtle p-0.5", className)} role="radiogroup">
      {options.map((o) => (
        <button
          key={o.value}
          role="radio"
          aria-checked={value === o.value}
          title={o.title}
          onClick={() => onChange(o.value)}
          className={cn(
            "inline-flex items-center justify-center gap-1.5 rounded-[5px] font-medium transition-all [&_svg]:size-3.5",
            size === "sm" ? "h-6 px-2 text-[12px]" : "h-7 px-2.5 text-[12.5px]",
            value === o.value ? "bg-surface text-fg shadow-sm" : "text-muted hover:text-fg",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// Dialog ------------------------------------------------------------------------

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export function DialogContent({ className, children, title, description, wide, ...props }: React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & { title: string; description?: string; wide?: boolean }) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/30 backdrop-blur-[1px] data-[state=open]:animate-fade-in" />
      <DialogPrimitive.Content
        className={cn(
          "fixed left-1/2 top-1/2 z-50 flex max-h-[85vh] w-[calc(100vw-48px)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-xl border border-border bg-surface shadow-lg focus:outline-none data-[state=open]:animate-scale-in",
          wide ? "max-w-2xl" : "max-w-md",
          className,
        )}
        {...props}
      >
        <div className="flex items-start justify-between gap-4 px-5 pt-5">
          <div>
            <DialogPrimitive.Title className="font-serif text-[17px] font-semibold">{title}</DialogPrimitive.Title>
            {description ? (
              <DialogPrimitive.Description className="mt-1 text-[13px] text-muted">{description}</DialogPrimitive.Description>
            ) : (
              <DialogPrimitive.Description className="sr-only">{title}</DialogPrimitive.Description>
            )}
          </div>
          <DialogPrimitive.Close asChild>
            <Button variant="ghost" size="icon-sm" aria-label="Close" className="-mr-1.5 -mt-1">
              <X />
            </Button>
          </DialogPrimitive.Close>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5 pt-4">{children}</div>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export function DialogFooter({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("mt-5 flex justify-end gap-2", className)}>{children}</div>;
}

// Menus -------------------------------------------------------------------------

const menuContent =
  "z-50 min-w-[180px] overflow-hidden rounded-lg border border-border bg-surface p-1 text-[13px] shadow-lg data-[state=open]:animate-scale-in";
const menuItem =
  "relative flex h-8 cursor-default select-none items-center gap-2.5 rounded-md px-2 text-fg outline-none data-[highlighted]:bg-bg-subtle data-[disabled]:opacity-40 [&_svg]:size-4 [&_svg]:text-muted";

export const DropdownMenu = DropdownPrimitive.Root;
export const DropdownMenuTrigger = DropdownPrimitive.Trigger;
export const DropdownMenuSub = DropdownPrimitive.Sub;

export function DropdownMenuContent({ className, align = "end", ...props }: React.ComponentPropsWithoutRef<typeof DropdownPrimitive.Content>) {
  return (
    <DropdownPrimitive.Portal>
      <DropdownPrimitive.Content align={align} sideOffset={6} className={cn(menuContent, className)} {...props} />
    </DropdownPrimitive.Portal>
  );
}
export function DropdownMenuItem({ className, danger, ...props }: React.ComponentPropsWithoutRef<typeof DropdownPrimitive.Item> & { danger?: boolean }) {
  return <DropdownPrimitive.Item className={cn(menuItem, danger && "text-danger [&_svg]:text-danger", className)} {...props} />;
}
export function DropdownMenuCheckboxItem({ className, children, ...props }: React.ComponentPropsWithoutRef<typeof DropdownPrimitive.CheckboxItem>) {
  return (
    <DropdownPrimitive.CheckboxItem className={cn(menuItem, "pr-7", className)} {...props}>
      {children}
      <DropdownPrimitive.ItemIndicator className="absolute right-2">
        <Check className="size-3.5! text-accent!" />
      </DropdownPrimitive.ItemIndicator>
    </DropdownPrimitive.CheckboxItem>
  );
}
export function DropdownMenuLabel({ className, ...props }: React.ComponentPropsWithoutRef<typeof DropdownPrimitive.Label>) {
  return <DropdownPrimitive.Label className={cn("px-2 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-subtle", className)} {...props} />;
}
export function DropdownMenuSeparator() {
  return <DropdownPrimitive.Separator className="my-1 h-px bg-border" />;
}
export function DropdownMenuSubTrigger({ className, children, ...props }: React.ComponentPropsWithoutRef<typeof DropdownPrimitive.SubTrigger>) {
  return (
    <DropdownPrimitive.SubTrigger className={cn(menuItem, "data-[state=open]:bg-bg-subtle", className)} {...props}>
      {children}
      <ChevronRight className="ml-auto size-3.5!" />
    </DropdownPrimitive.SubTrigger>
  );
}
export function DropdownMenuSubContent({ className, ...props }: React.ComponentPropsWithoutRef<typeof DropdownPrimitive.SubContent>) {
  return (
    <DropdownPrimitive.Portal>
      <DropdownPrimitive.SubContent sideOffset={4} className={cn(menuContent, "max-h-80 overflow-y-auto", className)} {...props} />
    </DropdownPrimitive.Portal>
  );
}

export const ContextMenu = ContextPrimitive.Root;
export const ContextMenuTrigger = ContextPrimitive.Trigger;
export const ContextMenuSub = ContextPrimitive.Sub;
export function ContextMenuContent({ className, ...props }: React.ComponentPropsWithoutRef<typeof ContextPrimitive.Content>) {
  return (
    <ContextPrimitive.Portal>
      <ContextPrimitive.Content className={cn(menuContent, className)} {...props} />
    </ContextPrimitive.Portal>
  );
}
export function ContextMenuItem({ className, danger, ...props }: React.ComponentPropsWithoutRef<typeof ContextPrimitive.Item> & { danger?: boolean }) {
  return <ContextPrimitive.Item className={cn(menuItem, danger && "text-danger [&_svg]:text-danger", className)} {...props} />;
}
export function ContextMenuSeparator() {
  return <ContextPrimitive.Separator className="my-1 h-px bg-border" />;
}
export function ContextMenuSubTrigger({ className, children, ...props }: React.ComponentPropsWithoutRef<typeof ContextPrimitive.SubTrigger>) {
  return (
    <ContextPrimitive.SubTrigger className={cn(menuItem, "data-[state=open]:bg-bg-subtle", className)} {...props}>
      {children}
      <ChevronRight className="ml-auto size-3.5!" />
    </ContextPrimitive.SubTrigger>
  );
}
export function ContextMenuSubContent({ className, ...props }: React.ComponentPropsWithoutRef<typeof ContextPrimitive.SubContent>) {
  return (
    <ContextPrimitive.Portal>
      <ContextPrimitive.SubContent className={cn(menuContent, "max-h-80 overflow-y-auto", className)} {...props} />
    </ContextPrimitive.Portal>
  );
}
export function ContextMenuCheckboxItem({ className, children, ...props }: React.ComponentPropsWithoutRef<typeof ContextPrimitive.CheckboxItem>) {
  return (
    <ContextPrimitive.CheckboxItem className={cn(menuItem, "pr-7", className)} {...props}>
      {children}
      <ContextPrimitive.ItemIndicator className="absolute right-2">
        <Check className="size-3.5! text-accent!" />
      </ContextPrimitive.ItemIndicator>
    </ContextPrimitive.CheckboxItem>
  );
}

// Popover & tooltip ---------------------------------------------------------------

export const Popover = PopoverPrimitive.Root;
export const PopoverTrigger = PopoverPrimitive.Trigger;
export const PopoverAnchor = PopoverPrimitive.Anchor;
export function PopoverContent({ className, align = "center", sideOffset = 6, ...props }: React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content align={align} sideOffset={sideOffset} className={cn("z-50 rounded-lg border border-border bg-surface p-3 shadow-lg focus:outline-none data-[state=open]:animate-scale-in", className)} {...props} />
    </PopoverPrimitive.Portal>
  );
}

export const TooltipProvider = TooltipPrimitive.Provider;
export function Tooltip({ content, children, side = "bottom", shortcut }: { content: React.ReactNode; children: React.ReactNode; side?: "top" | "bottom" | "left" | "right"; shortcut?: string }) {
  return (
    <TooltipPrimitive.Root>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content side={side} sideOffset={6} className="z-[60] flex items-center gap-2 rounded-md bg-fg px-2 py-1 text-[11.5px] font-medium text-bg shadow-md data-[state=delayed-open]:animate-fade-in">
          {content}
          {shortcut && <span className="opacity-60">{shortcut}</span>}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}

export function IconButton({ label, shortcut, side, children, className, active, ...props }: ButtonProps & { label: string; shortcut?: string; side?: "top" | "bottom" | "left" | "right"; active?: boolean }) {
  return (
    <Tooltip content={label} shortcut={shortcut} side={side}>
      <Button variant="ghost" size="icon" aria-label={label} aria-pressed={active} className={cn(active && "bg-bg-subtle text-fg", className)} {...props}>
        {children}
      </Button>
    </Tooltip>
  );
}
