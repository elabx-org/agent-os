"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { Slot } from "@radix-ui/react-slot";
import { Check, ChevronLeft, ChevronRight } from "lucide-react";

import { cn } from "@/lib/utils";
import { haptic } from "@/lib/haptics";
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

/*
 * The touch version of a dropdown menu: the same items as rows on a bottom
 * sheet, a submenu as a second page with a way back. The menu's own parts
 * (dropdown-menu.tsx) switch to these on touch, so callers don't change.
 */

interface Page {
  id: string;
  label: React.ReactNode;
}

interface MenuState {
  open: boolean;
  setOpen: (open: boolean) => void;
  page: Page | null;
  setPage: (page: Page | null) => void;
  pageEl: HTMLElement | null;
}

const Menu = React.createContext<MenuState | null>(null);
const Sub = React.createContext<string | null>(null);
const Radio = React.createContext<{
  value?: string;
  onValueChange?: (value: string) => void;
} | null>(null);

/** The open touch menu, or null with a mouse (and outside a menu) */
export function useTouchMenu() {
  return React.useContext(Menu);
}

interface RootProps {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  children?: React.ReactNode;
}

export function TouchMenu({
  open: controlled,
  defaultOpen,
  onOpenChange,
  children,
}: RootProps) {
  const [own, setOwn] = React.useState(!!defaultOpen);
  const [page, setPage] = React.useState<Page | null>(null);
  const [pageEl, setPageEl] = React.useState<HTMLElement | null>(null);
  const open = controlled ?? own;
  const setOpen = React.useCallback(
    (next: boolean) => {
      setOwn(next);
      if (next) setPage(null);
      onOpenChange?.(next);
    },
    [onOpenChange]
  );
  return (
    <Menu.Provider value={{ open, setOpen, page, setPage, pageEl }}>
      <PageTarget.Provider value={setPageEl}>{children}</PageTarget.Provider>
    </Menu.Provider>
  );
}

const PageTarget = React.createContext<(el: HTMLElement | null) => void>(
  () => {}
);

export function TouchMenuTrigger({
  asChild,
  onClick,
  children,
  ...props
}: React.ComponentProps<"button"> & { asChild?: boolean }) {
  const menu = React.useContext(Menu)!;
  const Comp = asChild ? Slot : "button";
  return (
    <Comp
      type={asChild ? undefined : "button"}
      aria-haspopup="dialog"
      aria-expanded={menu.open}
      data-state={menu.open ? "open" : "closed"}
      onClick={(e: React.MouseEvent<HTMLButtonElement>) => {
        onClick?.(e);
        if (!e.defaultPrevented) menu.setOpen(!menu.open);
      }}
      {...props}
    >
      {children}
    </Comp>
  );
}

const ROWS =
  "bg-secondary/70 divide-border/60 divide-y overflow-hidden rounded-2xl";

export function TouchMenuContent({ children }: { children?: React.ReactNode }) {
  const menu = React.useContext(Menu)!;
  const setPageEl = React.useContext(PageTarget);
  return (
    <Sheet open={menu.open} onOpenChange={menu.setOpen}>
      <SheetContent>
        {/* The sheet is portalled, but React clicks still bubble to the
            menu's parents (a row that opens on click) */}
        <div
          className="flex min-h-0 flex-1 flex-col"
          onClick={(e) => e.stopPropagation()}
        >
          <SheetHeader
            className={cn(
              "flex-row items-center gap-1",
              !menu.page && "sr-only"
            )}
          >
            {menu.page && (
              <button
                type="button"
                onClick={() => menu.setPage(null)}
                aria-label="Back"
                className="text-primary active:bg-accent -ml-2 flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
              >
                <ChevronLeft className="h-5 w-5" />
              </button>
            )}
            <SheetTitle className="flex min-w-0 items-center gap-2 truncate [&_svg]:hidden">
              {menu.page?.label ?? "Menu"}
            </SheetTitle>
            <SheetDescription className="sr-only">Actions</SheetDescription>
          </SheetHeader>
          <SheetBody className={cn("pt-2 pb-1", menu.page && "hidden")}>
            <ul className={ROWS}>{children}</ul>
          </SheetBody>
          <SheetBody
            ref={setPageEl}
            className={cn("pb-1", !menu.page && "hidden")}
          />
        </div>
      </SheetContent>
    </Sheet>
  );
}

const ROW =
  "active:bg-accent flex min-h-[52px] w-full items-center gap-3 px-4 text-left text-[15px] disabled:opacity-40 [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-5 [&_svg:not([class*='text-'])]:text-muted-foreground [&_svg]:mr-0";

interface ItemProps {
  className?: string;
  children?: React.ReactNode;
  disabled?: boolean;
  variant?: "default" | "destructive";
  onSelect?: (event: Event) => void;
  onClick?: React.MouseEventHandler<HTMLElement>;
}

function itemTone(className?: string, variant?: string) {
  // Keep a caller's red, drop its desktop sizing and spacing
  return variant === "destructive" ||
    /\btext-(red|destructive)/.test(className ?? "")
    ? "text-red-500 [&_svg:not([class*='text-'])]:text-red-500"
    : undefined;
}

export function TouchMenuItem({
  className,
  children,
  disabled,
  variant,
  onSelect,
  onClick,
  checked,
}: ItemProps & { checked?: boolean }) {
  const menu = React.useContext(Menu)!;
  return (
    <li>
      <button
        type="button"
        disabled={disabled}
        onClick={(e) => {
          onClick?.(e);
          const select = new Event("menu.select", { cancelable: true });
          onSelect?.(select);
          haptic(itemTone(className, variant) ? "warning" : "selection");
          if (!select.defaultPrevented && !e.defaultPrevented)
            menu.setOpen(false);
        }}
        className={cn(ROW, itemTone(className, variant))}
      >
        <span className="flex min-w-0 flex-1 items-center gap-3 [&>span]:truncate">
          {children}
        </span>
        {checked && <Check className="text-primary size-5" />}
      </button>
    </li>
  );
}

export function TouchMenuCheckboxItem({
  checked,
  onCheckedChange,
  ...props
}: ItemProps & {
  checked?: boolean | "indeterminate";
  onCheckedChange?: (checked: boolean) => void;
}) {
  return (
    <TouchMenuItem
      {...props}
      checked={checked === true}
      onSelect={(e) => {
        props.onSelect?.(e);
        onCheckedChange?.(checked !== true);
      }}
    />
  );
}

export function TouchMenuRadioGroup({
  value,
  onValueChange,
  children,
}: {
  value?: string;
  onValueChange?: (value: string) => void;
  children?: React.ReactNode;
}) {
  return (
    <Radio.Provider value={{ value, onValueChange }}>{children}</Radio.Provider>
  );
}

export function TouchMenuRadioItem({
  value,
  ...props
}: ItemProps & { value: string }) {
  const radio = React.useContext(Radio);
  return (
    <TouchMenuItem
      {...props}
      checked={radio?.value === value}
      onSelect={(e) => {
        props.onSelect?.(e);
        radio?.onValueChange?.(value);
      }}
    />
  );
}

export function TouchMenuLabel({ children }: { children?: React.ReactNode }) {
  return (
    <li className="text-muted-foreground flex items-center gap-2 px-4 pt-3 pb-1.5 text-xs font-semibold tracking-wide uppercase [&_svg]:size-3.5">
      {children}
    </li>
  );
}

export function TouchMenuSeparator() {
  return <li aria-hidden className="bg-popover h-2" />;
}

export function TouchMenuSub({ children }: { children?: React.ReactNode }) {
  const id = React.useId();
  return <Sub.Provider value={id}>{children}</Sub.Provider>;
}

export function TouchMenuSubTrigger({
  children,
  disabled,
}: {
  children?: React.ReactNode;
  disabled?: boolean;
}) {
  const menu = React.useContext(Menu)!;
  const id = React.useContext(Sub);
  return (
    <li>
      <button
        type="button"
        disabled={disabled}
        onClick={() => {
          if (!id) return;
          haptic("selection");
          menu.setPage({ id, label: children });
        }}
        className={ROW}
      >
        <span className="flex min-w-0 flex-1 items-center gap-3">
          {children}
        </span>
        <ChevronRight className="text-muted-foreground size-4" />
      </button>
    </li>
  );
}

/** A submenu's items, on their own page while that submenu is open */
export function TouchMenuSubContent({
  children,
}: {
  children?: React.ReactNode;
}) {
  const menu = React.useContext(Menu)!;
  const id = React.useContext(Sub);
  if (!menu.pageEl || menu.page?.id !== id) return null;
  return createPortal(<ul className={ROWS}>{children}</ul>, menu.pageEl);
}
