import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { onNativeEvent, type SharedFile } from "@/lib/native-bridge";
import { uploadFileToTemp } from "@/lib/file-upload";
import type { TerminalHandle } from "@/components/Terminal";

/**
 * Files shared to the iOS app ("Open in Agent-OS" from the share sheet or
 * Files) go to the focused session: uploaded like a picked image, with the
 * path typed into its prompt.
 */
export function useSharedFiles(
  terminal: TerminalHandle | null,
  focused: boolean
) {
  const target = useRef(terminal);
  target.current = terminal;

  useEffect(() => {
    if (!focused) return;
    const take = async (shared: SharedFile) => {
      const handle = target.current;
      if (!handle) {
        toast.error(`Open a session to attach ${shared.name}`);
        return;
      }
      const bytes = Uint8Array.from(atob(shared.base64), (c) =>
        c.charCodeAt(0)
      );
      const file = new File([bytes], shared.name, { type: shared.mimeType });
      const path = await uploadFileToTemp(file).catch(() => null);
      if (!path) {
        toast.error(`Couldn't attach ${shared.name}`);
        return;
      }
      handle.sendInput(`${path} `);
      toast.success(`Attached ${shared.name}`);
    };
    // Shared before the page was ready
    const waiting = window.agentosNative?.file;
    if (waiting) {
      window.agentosNative!.file = undefined;
      void take(waiting);
    }
    return onNativeEvent((event) => {
      if (event.type !== "file") return;
      if (window.agentosNative) window.agentosNative.file = undefined;
      void take(event.file);
    });
  }, [focused]);
}
