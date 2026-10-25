import { useCallback } from "react";
import { removeWithUndo } from "@/lib/undo";
import { useToggleGroup, useCreateGroup, useDeleteGroup } from "@/data/groups";

export function useGroups() {
  const toggleMutation = useToggleGroup();
  const createMutation = useCreateGroup();
  const deleteMutation = useDeleteGroup();

  const toggleGroup = useCallback(
    async (path: string, expanded: boolean) => {
      await toggleMutation.mutateAsync({ path, expanded });
    },
    [toggleMutation]
  );

  const createGroup = useCallback(
    async (name: string, parentPath?: string) => {
      await createMutation.mutateAsync({ name, parentPath });
    },
    [createMutation]
  );

  // At once, with a few seconds to undo; its sessions go to the parent
  const deleteGroup = useCallback(
    (path: string) =>
      removeWithUndo({
        kind: "groups",
        id: path,
        message: "Deleted group",
        commit: () => deleteMutation.mutateAsync(path),
      }),
    [deleteMutation]
  );

  return {
    toggleGroup,
    createGroup,
    deleteGroup,
  };
}
