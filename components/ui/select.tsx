"use client";

import * as React from "react";
import * as SelectPrimitive from "@radix-ui/react-select";
import { Check, ChevronDown, ChevronUp } from "lucide-react";

import { cn } from "@/lib/utils";
import { haptic } from "@/lib/haptics";
import { useViewport } from "@/hooks/useViewport";
import {
  Sheet,
  SheetBody,
  SheetContent as SheetPanel,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

const RadixSelectGroup = SelectPrimitive.Group;

const RadixSelectValue = SelectPrimitive.Value;

const RadixSelectTrigger = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Trigger>
>(({ className, children, ...props }, ref) => (
  <SelectPrimitive.Trigger
    ref={ref}
    className={cn(
      "border-input ring-offset-background placeholder:text-muted-foreground focus:ring-ring flex h-9 w-full items-center justify-between rounded-md border bg-transparent px-3 py-2 text-sm whitespace-nowrap shadow-sm focus:ring-1 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50 [&>span]:line-clamp-1",
      className
    )}
    {...props}
  >
    {children}
    <SelectPrimitive.Icon asChild>
      <ChevronDown className="h-4 w-4 opacity-50" />
    </SelectPrimitive.Icon>
  </SelectPrimitive.Trigger>
));
RadixSelectTrigger.displayName = SelectPrimitive.Trigger.displayName;

const SelectScrollUpButton = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.ScrollUpButton>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.ScrollUpButton>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.ScrollUpButton
    ref={ref}
    className={cn(
      "flex cursor-default items-center justify-center py-1",
      className
    )}
    {...props}
  >
    <ChevronUp className="h-4 w-4" />
  </SelectPrimitive.ScrollUpButton>
));
SelectScrollUpButton.displayName = SelectPrimitive.ScrollUpButton.displayName;

const SelectScrollDownButton = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.ScrollDownButton>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.ScrollDownButton>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.ScrollDownButton
    ref={ref}
    className={cn(
      "flex cursor-default items-center justify-center py-1",
      className
    )}
    {...props}
  >
    <ChevronDown className="h-4 w-4" />
  </SelectPrimitive.ScrollDownButton>
));
SelectScrollDownButton.displayName =
  SelectPrimitive.ScrollDownButton.displayName;

const RadixSelectContent = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Content>
>(({ className, children, position = "popper", ...props }, ref) => (
  <SelectPrimitive.Portal>
    <SelectPrimitive.Content
      ref={ref}
      className={cn(
        "bg-popover text-popover-foreground data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 relative z-50 max-h-96 min-w-[8rem] overflow-hidden rounded-md border shadow-md",
        position === "popper" &&
          "data-[side=bottom]:translate-y-1 data-[side=left]:-translate-x-1 data-[side=right]:translate-x-1 data-[side=top]:-translate-y-1",
        className
      )}
      position={position}
      {...props}
    >
      <SelectScrollUpButton />
      <SelectPrimitive.Viewport
        className={cn(
          "p-1",
          position === "popper" &&
            "h-[var(--radix-select-trigger-height)] w-full min-w-[var(--radix-select-trigger-width)]"
        )}
      >
        {children}
      </SelectPrimitive.Viewport>
      <SelectScrollDownButton />
    </SelectPrimitive.Content>
  </SelectPrimitive.Portal>
));
RadixSelectContent.displayName = SelectPrimitive.Content.displayName;

const RadixSelectLabel = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Label>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Label>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.Label
    ref={ref}
    className={cn("px-2 py-1.5 text-sm font-semibold", className)}
    {...props}
  />
));
RadixSelectLabel.displayName = SelectPrimitive.Label.displayName;

const RadixSelectItem = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Item>
>(({ className, children, ...props }, ref) => (
  <SelectPrimitive.Item
    ref={ref}
    className={cn(
      "focus:bg-accent focus:text-accent-foreground relative flex w-full cursor-default items-center rounded-sm py-1.5 pr-8 pl-2 text-sm outline-none select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
      className
    )}
    {...props}
  >
    <span className="absolute right-2 flex h-3.5 w-3.5 items-center justify-center">
      <SelectPrimitive.ItemIndicator>
        <Check className="h-4 w-4" />
      </SelectPrimitive.ItemIndicator>
    </span>
    <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
  </SelectPrimitive.Item>
));
RadixSelectItem.displayName = SelectPrimitive.Item.displayName;

const RadixSelectSeparator = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.Separator
    ref={ref}
    className={cn("bg-muted -mx-1 my-1 h-px", className)}
    {...props}
  />
));
RadixSelectSeparator.displayName = SelectPrimitive.Separator.displayName;

/*
 * On touch a select opens a sheet of options with a tick on the chosen one;
 * with a mouse it's the Radix dropdown. The touch version reads its options
 * from the SelectItems written inside SelectContent.
 */

type RootProps = React.ComponentProps<typeof SelectPrimitive.Root>;

interface TouchSelectState {
  value: string | undefined;
  choose: (value: string) => void;
  open: boolean;
  setOpen: (open: boolean) => void;
  disabled?: boolean;
  /** The chosen option's content, for SelectValue */
  chosen: React.ReactNode;
  /** What SelectContent's title says: the trigger's label, if any */
  title?: string;
}

const TouchSelect = React.createContext<TouchSelectState | null>(null);

interface FoundItem {
  value: string;
  children: React.ReactNode;
}

function findItems(node: React.ReactNode, found: FoundItem[] = []) {
  React.Children.forEach(node, (child) => {
    if (!React.isValidElement(child)) return;
    const props = child.props as { value?: string; children?: React.ReactNode };
    if (child.type === SelectItem && props.value !== undefined) {
      found.push({ value: props.value, children: props.children });
    } else if (props.children) {
      findItems(props.children, found);
    }
  });
  return found;
}

function Select({
  children,
  value: controlled,
  defaultValue,
  onValueChange,
  disabled,
  ...props
}: RootProps) {
  const { isTouch } = useViewport();
  const [own, setOwn] = React.useState(defaultValue);
  const [open, setOpen] = React.useState(false);
  if (!isTouch) {
    return (
      <SelectPrimitive.Root
        value={controlled}
        defaultValue={defaultValue}
        onValueChange={onValueChange}
        disabled={disabled}
        {...props}
      >
        {children}
      </SelectPrimitive.Root>
    );
  }
  const value = controlled ?? own;
  const chosen = findItems(children).find((i) => i.value === value)?.children;
  return (
    <TouchSelect.Provider
      value={{
        value,
        chosen,
        open,
        setOpen,
        disabled,
        choose: (next) => {
          haptic("selection");
          setOwn(next);
          setOpen(false);
          if (next !== value) onValueChange?.(next);
        },
      }}
    >
      {children}
    </TouchSelect.Provider>
  );
}

const SelectTrigger = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Trigger>
>(({ className, children, onClick, ...props }, ref) => {
  const touch = React.useContext(TouchSelect);
  if (!touch)
    return (
      <RadixSelectTrigger
        ref={ref}
        className={className}
        onClick={onClick}
        {...props}
      >
        {children}
      </RadixSelectTrigger>
    );
  return (
    <button
      ref={ref}
      type="button"
      disabled={touch.disabled || props.disabled}
      aria-haspopup="dialog"
      aria-expanded={touch.open}
      onClick={(e) => {
        onClick?.(e);
        touch.setOpen(true);
      }}
      className={cn(
        "border-input flex h-11 w-full items-center justify-between gap-2 rounded-md border bg-transparent px-3 text-left text-sm shadow-sm disabled:cursor-not-allowed disabled:opacity-50 [&>span]:line-clamp-1",
        className,
        "h-11"
      )}
    >
      {children}
      <ChevronDown className="h-4 w-4 shrink-0 opacity-50" />
    </button>
  );
});
SelectTrigger.displayName = "SelectTrigger";

function SelectValue({
  placeholder,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Value>) {
  const touch = React.useContext(TouchSelect);
  if (!touch) return <RadixSelectValue placeholder={placeholder} {...props} />;
  return (
    <span
      className={cn(
        "min-w-0 truncate",
        touch.chosen == null && "text-muted-foreground"
      )}
    >
      {touch.chosen ?? placeholder}
    </span>
  );
}

const SelectContent = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Content>
>(({ children, ...props }, ref) => {
  const touch = React.useContext(TouchSelect);
  if (!touch)
    return (
      <RadixSelectContent ref={ref} {...props}>
        {children}
      </RadixSelectContent>
    );
  return (
    <Sheet open={touch.open} onOpenChange={touch.setOpen}>
      <SheetPanel>
        <SheetHeader className="sr-only">
          <SheetTitle>Choose</SheetTitle>
          <SheetDescription>Choose an option</SheetDescription>
        </SheetHeader>
        <SheetBody className="pt-2 pb-1">
          <ul className="bg-secondary/70 divide-border/60 divide-y overflow-hidden rounded-2xl">
            {children}
          </ul>
        </SheetBody>
      </SheetPanel>
    </Sheet>
  );
});
SelectContent.displayName = "SelectContent";

const SelectItem = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Item>
>(({ className, children, value, disabled, ...props }, ref) => {
  const touch = React.useContext(TouchSelect);
  if (!touch)
    return (
      <RadixSelectItem
        ref={ref}
        className={className}
        value={value}
        disabled={disabled}
        {...props}
      >
        {children}
      </RadixSelectItem>
    );
  const checked = touch.value === value;
  return (
    <li>
      <button
        type="button"
        disabled={disabled}
        onClick={() => touch.choose(value)}
        className="active:bg-accent flex min-h-[52px] w-full items-center gap-3 px-4 text-left text-[15px] disabled:opacity-40"
      >
        <span className="flex min-w-0 flex-1 flex-wrap items-center">
          {children}
        </span>
        {checked && <Check className="text-primary h-5 w-5 shrink-0" />}
      </button>
    </li>
  );
});
SelectItem.displayName = "SelectItem";

function SelectGroup(
  props: React.ComponentProps<typeof SelectPrimitive.Group>
) {
  const touch = React.useContext(TouchSelect);
  if (!touch) return <RadixSelectGroup {...props} />;
  return <>{props.children}</>;
}

const SelectLabel = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Label>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Label>
>((props, ref) => {
  const touch = React.useContext(TouchSelect);
  if (!touch) return <RadixSelectLabel ref={ref} {...props} />;
  return (
    <li className="text-muted-foreground px-4 pt-3 pb-1 text-xs font-semibold uppercase">
      {props.children}
    </li>
  );
});
SelectLabel.displayName = "SelectLabel";

const SelectSeparator = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Separator>
>((props, ref) => {
  const touch = React.useContext(TouchSelect);
  if (!touch) return <RadixSelectSeparator ref={ref} {...props} />;
  return null;
});
SelectSeparator.displayName = "SelectSeparator";

export {
  Select,
  SelectGroup,
  SelectValue,
  SelectTrigger,
  SelectContent,
  SelectLabel,
  SelectItem,
  SelectSeparator,
  SelectScrollUpButton,
  SelectScrollDownButton,
};
