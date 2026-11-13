/** Forms with unsaved changes. Leaving one asks "Discard your changes?"; there are no silent drafts and no autosave. */
import { useEffect, useRef } from "react";
import { useConfirm } from "../ui.tsx";

const dirtyForms = new Set<object>();
function holdTab(event: BeforeUnloadEvent) { event.preventDefault(); event.returnValue = ""; }

/**
 * Marks a form as changed while `draft` differs from its value when the form opened.
 * Closing or reloading the tab then asks first (the browser shows its own wording).
 */
export function useUnsavedChanges(open: boolean, draft: unknown) {
  const baseline = useRef<string | null>(null), snapshot = JSON.stringify(draft) ?? "";
  if (!open) baseline.current = null;
  else if (baseline.current === null) baseline.current = snapshot;
  const dirty = open && baseline.current !== snapshot;
  useEffect(() => {
    if (!dirty) return;
    const form = {};
    dirtyForms.add(form);
    window.addEventListener("beforeunload", holdTab);
    return () => { dirtyForms.delete(form); if (!dirtyForms.size) window.removeEventListener("beforeunload", holdTab); };
  }, [dirty]);
}

export const hasUnsavedChanges = () => dirtyForms.size > 0;

/** Resolves true when nothing is unsaved or the person chose to discard it. */
export function useDiscardChanges() {
  const confirm = useConfirm();
  return async () => {
    if (!hasUnsavedChanges()) return true;
    if (!await confirm("Discard your changes?", "Your changes to this form have not been saved.", { confirm: "Discard", cancel: "Keep editing" })) return false;
    // The forms close as the person leaves; until then nothing should ask again.
    dirtyForms.clear();
    window.removeEventListener("beforeunload", holdTab);
    return true;
  };
}
