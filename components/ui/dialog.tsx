"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Drawer as SheetPrimitive } from "vaul";
import { XIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { useViewport } from "@/hooks/useViewport";

/**
 * On touch every dialog is a bottom sheet (vaul, built on the same Radix
 * dialog, so titles and close buttons work unchanged); with a mouse it's
 * the centred dialog.
 */
const AsSheet = React.createContext(false);

function Dialog({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Root>) {
  const { isTouch } = useViewport();
  if (isTouch) {
    return (
      <AsSheet.Provider value>
        <SheetPrimitive.Root data-slot="dialog" {...props} />
      </AsSheet.Provider>
    );
  }
  return <DialogPrimitive.Root data-slot="dialog" {...props} />;
}

// A dialog's own size and position don't apply to a sheet; its layout does
const SIZING =
  /^(?:[a-z]+:)*(?:max-w|w|h|max-h|min-h|top|left|translate-[xy])-/;
const sheetClasses = (className?: string) =>
  className
    ?.split(/\s+/)
    .filter((c) => !SIZING.test(c))
    .join(" ");
const fillsHeight = (className?: string) =>
  /(?:^|\s)h-\[/.test(className ?? "");

function DialogTrigger({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Trigger>) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />;
}

function DialogPortal({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Portal>) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />;
}

function DialogClose({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />;
}

function DialogOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      data-slot="dialog-overlay"
      className={cn(
        "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 fixed inset-0 z-50 bg-black/50",
        className
      )}
      {...props}
    />
  );
}

function DialogContent({
  className,
  children,
  showCloseButton = true,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  showCloseButton?: boolean;
}) {
  const asSheet = React.useContext(AsSheet);
  if (asSheet) {
    return (
      <SheetPrimitive.Portal>
        <SheetPrimitive.Overlay
          data-slot="sheet-overlay"
          className="fixed inset-0 z-50 bg-black/50"
        />
        <SheetPrimitive.Content
          data-slot="sheet-content"
          className={cn(
            "bg-popover text-popover-foreground fixed inset-x-0 bottom-0 z-50 mx-auto flex max-h-[92dvh] w-full max-w-lg flex-col gap-4 overflow-y-auto rounded-t-[28px] px-5 shadow-2xl outline-none",
            fillsHeight(className) && "h-[92dvh]",
            sheetClasses(className),
            // Room for the grabber, and clear of the home indicator
            "pt-7 pb-[max(1rem,env(safe-area-inset-bottom))]"
          )}
          {...(props as React.ComponentProps<typeof SheetPrimitive.Content>)}
        >
          <div
            aria-hidden
            className="bg-muted-foreground/30 absolute top-2.5 left-1/2 h-1.5 w-10 -translate-x-1/2 rounded-full"
          />
          {children}
          {showCloseButton && (
            <DialogPrimitive.Close
              data-slot="dialog-close"
              className="bg-secondary text-muted-foreground active:bg-accent absolute top-4 right-4 flex h-8 w-8 items-center justify-center rounded-full [&_svg]:size-4"
            >
              <XIcon />
              <span className="sr-only">Close</span>
            </DialogPrimitive.Close>
          )}
        </SheetPrimitive.Content>
      </SheetPrimitive.Portal>
    );
  }
  return (
    <DialogPortal data-slot="dialog-portal">
      <DialogOverlay />
      <DialogPrimitive.Content
        data-slot="dialog-content"
        className={cn(
          "bg-background data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 fixed top-[50%] left-[50%] z-50 grid w-full max-w-[calc(100%-2rem)] translate-x-[-50%] translate-y-[-50%] gap-4 rounded-lg border p-6 shadow-lg duration-200 outline-none sm:max-w-lg",
          className
        )}
        {...props}
      >
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close
            data-slot="dialog-close"
            className="ring-offset-background focus:ring-ring data-[state=open]:bg-accent data-[state=open]:text-muted-foreground absolute top-4 right-4 rounded-xs opacity-70 transition-opacity hover:opacity-100 focus:ring-2 focus:ring-offset-2 focus:outline-hidden disabled:pointer-events-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4"
          >
            <XIcon />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPortal>
  );
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      className={cn("flex flex-col gap-2 text-center sm:text-left", className)}
      {...props}
    />
  );
}

function DialogFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        "flex flex-col-reverse gap-2 sm:flex-row sm:justify-end",
        className
      )}
      {...props}
    />
  );
}

function DialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn("text-lg leading-none font-semibold", className)}
      {...props}
    />
  );
}

function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn("text-muted-foreground text-sm", className)}
      {...props}
    />
  );
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
};
