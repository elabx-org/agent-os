"use client";

import { proxy, useSnapshot } from "valtio";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { haptic } from "@/lib/haptics";
import { mobileNavStore } from "@/stores/mobileNav";

interface ConfirmRequest {
  title: string;
  message?: string;
  confirmLabel: string;
  destructive?: boolean;
}

const store = proxy<{ request: ConfirmRequest | null }>({ request: null });
let resolveRequest: ((ok: boolean) => void) | null = null;

/**
 * Asks before something that can't be undone: a sheet on touch, a dialog
 * with a mouse. In place of window.confirm, which the iOS app has to fake.
 */
export function confirmAction(request: ConfirmRequest): Promise<boolean> {
  resolveRequest?.(false);
  store.request = request;
  return new Promise((resolve) => (resolveRequest = resolve));
}

function finish(ok: boolean) {
  resolveRequest?.(ok);
  resolveRequest = null;
  store.request = null;
}

/** Mounted once, in Providers */
export function ConfirmHost() {
  const { request } = useSnapshot(store);
  // The closed Duo's web column stays beside the sheet, as other sheets do
  const { railWidth } = useSnapshot(mobileNavStore);

  return (
    <Dialog open={!!request} onOpenChange={(open) => !open && finish(false)}>
      <DialogContent
        showCloseButton={false}
        className="sm:max-w-sm"
        style={
          railWidth > 0
            ? { right: railWidth, width: "auto", maxWidth: "none" }
            : undefined
        }
      >
        <DialogHeader>
          <DialogTitle>{request?.title}</DialogTitle>
          <DialogDescription className={request?.message ? "" : "sr-only"}>
            {request?.message ?? request?.title}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            variant="secondary"
            className="h-11 sm:h-9"
            onClick={() => finish(false)}
          >
            Cancel
          </Button>
          <Button
            variant={request?.destructive ? "destructive" : "default"}
            className="h-11 sm:h-9"
            onClick={() => {
              if (request?.destructive) haptic("warning");
              finish(true);
            }}
          >
            {request?.confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
