/**
 * Forms with unsaved changes, and writes still in flight. Leaving a changed form asks "Discard your changes?";
 * there are no silent drafts and no autosave. No UI imports: shared forms (also rendered by the website) register here.
 */
import { useEffect, useRef } from "react";

// Each mounted, changed form owns one entry. Only unmounting or returning to its saved state removes it, so an action
// that fails or keeps the form (a failed sign-out, joining a workspace you already belong to) leaves the protection in place.
const dirtyForms = new Set<object>();
function holdTab(event: BeforeUnloadEvent) { if (!dirtyForms.size) return; event.preventDefault(); event.returnValue = ""; }

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

// A write already sent cannot be discarded: the service may commit it. Leaving waits for its outcome instead.
const writes = new Set<Promise<unknown>>();
/** Records a write in flight until it settles. Returns the same promise. */
export function trackWrite<T>(write: Promise<T>): Promise<T> {
  const settled = write.then(() => undefined, () => undefined);
  writes.add(settled);
  void settled.then(() => writes.delete(settled));
  return write;
}
export const hasPendingWrites = () => writes.size > 0;

/**
 * Resolves once no write is in flight and the forms have rendered its outcome:
 * a saved form has closed (and unregistered), a failed one is still open with its changes.
 */
export async function writesSettled() {
  while (writes.size) await Promise.all([...writes]);
  // The forms close in their own callbacks; let React commit them and run their effect cleanups.
  await new Promise<void>((done) => requestAnimationFrame(() => setTimeout(done, 0)));
}
