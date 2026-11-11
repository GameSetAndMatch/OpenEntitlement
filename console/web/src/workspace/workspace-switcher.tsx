import { useEffect, useRef, useState } from "react";

export interface WorkspaceSummary { id: string; name: string; role: string }

/** The first letter of a workspace name, shown as its mark. */
export function workspaceInitial(name: string) {
  return (name.trim().match(/\p{L}|\p{N}/u)?.[0] ?? "?").toLocaleUpperCase();
}

/**
 * The current workspace, top left. Switching and creating live behind it, as in
 * Slack: the person stays in one workspace and rarely needs the others.
 */
export function WorkspaceSwitcher({ workspaces, current, onSelect, onCreate, disabled }: {
  workspaces: WorkspaceSummary[]; current: WorkspaceSummary;
  onSelect: (id: string) => void; onCreate: () => void; disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null), menu = useRef<HTMLDivElement>(null);
  const items = () => Array.from(menu.current?.querySelectorAll<HTMLElement>("[role^=menuitem]") ?? []);
  function close(focus = true) { setOpen(false); if (focus) trigger.current?.focus(); }
  useEffect(() => {
    if (!open) return;
    (items().find(i => i.getAttribute("aria-checked") === "true") ?? items()[0])?.focus();
    const outside = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) close(false); };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);
  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") { e.preventDefault(); close(); return; }
    if (e.key === "Tab") { close(false); return; }
    const list = items(), index = list.indexOf(document.activeElement as HTMLElement);
    const next = e.key === "ArrowDown" ? index + 1 : e.key === "ArrowUp" ? index - 1 : e.key === "Home" ? 0 : e.key === "End" ? list.length - 1 : undefined;
    if (next === undefined) return;
    e.preventDefault(); list[(next + list.length) % list.length]?.focus();
  }
  return <div className="workspace-switcher" ref={root} onKeyDown={open ? onKeyDown : undefined}>
    <button ref={trigger} type="button" className="workspace-trigger" disabled={disabled} aria-haspopup="menu" aria-expanded={open} aria-label={`Workspace: ${current.name}`} onClick={() => setOpen(v => !v)}>
      <span className="workspace-mark" aria-hidden="true">{workspaceInitial(current.name)}</span>
      <span className="workspace-trigger-name">{current.name}</span>
    </button>
    {open && <div className="workspace-menu" role="menu" aria-label="Workspaces" ref={menu}>
      {workspaces.map(w => <button type="button" role="menuitemradio" aria-checked={w.id === current.id} tabIndex={-1} key={w.id} onClick={() => { close(); if (w.id !== current.id) onSelect(w.id); }}>
        <span className="workspace-mark" aria-hidden="true">{workspaceInitial(w.name)}</span>
        <span className="workspace-menu-name">{w.name}<small>{w.role}</small></span>
      </button>)}
      <hr />
      <button type="button" role="menuitem" tabIndex={-1} onClick={() => { close(false); onCreate(); }}>
        <span className="workspace-mark add" aria-hidden="true">+</span>
        <span className="workspace-menu-name">Create a workspace</span>
      </button>
    </div>}
  </div>;
}
