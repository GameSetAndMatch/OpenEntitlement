/** Small UI kit: chips, toggles, value inputs, the mandatory-reason dialog. */

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { formatValue, isUnlimited, UNLIMITED, type Json, type PrivilegeDef } from "./api.ts";

export function Chip({ children, tone = "neutral", title }: { children: ReactNode; tone?: "neutral" | "blue" | "green" | "amber" | "red" | "violet" | "grey"; title?: string }) {
  return (
    <span className={`chip chip-${tone}`} title={title}>
      {children}
    </span>
  );
}

const REASON_TONE: Record<string, "neutral" | "blue" | "green" | "amber" | "red" | "violet" | "grey"> = {
  PLAN: "neutral",
  OVERRIDE: "violet",
  GRANT: "green",
  FIXED: "blue",
  DEFAULT: "grey",
  ERROR: "red",
};
export const ReasonChip = ({ reason }: { reason: string }) => <Chip tone={REASON_TONE[reason] ?? "neutral"}>{reason}</Chip>;

export function Check() {
  return (
    <svg className="check" width="14" height="14" viewBox="0 0 16 16" aria-hidden>
      <circle cx="8" cy="8" r="8" fill="currentColor" />
      <path d="M4.5 8.2l2.2 2.2 4.8-4.8" stroke="#fff" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Toggle({ checked, onChange, disabled, label }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; label?: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} className={`toggle ${checked ? "on" : ""}`} onClick={() => onChange(!checked)}>
      <span className="toggle-text">{checked ? "On" : "Off"}</span>
      <span className="knob" />
    </button>
  );
}

/** Edits one privilege value with the right control for its type (spec §1.1, §1.2). */
export function ValueInput({ def, value, onChange, disabled }: { def: PrivilegeDef; value: Json; onChange: (v: Json) => void; disabled?: boolean }) {
  if (def.valueType === "boolean") return <Toggle checked={value === true} onChange={onChange} disabled={disabled} label={def.key} />;
  if (def.valueType === "enum")
    return (
      <select className="input" value={value ?? ""} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
        {value === undefined && <option value="">—</option>}
        {def.options.map((o) => (
          <option key={o}>{o}</option>
        ))}
      </select>
    );
  const unlimited = isUnlimited(value);
  return (
    <div className="int-input">
      <input
        className="input"
        type="number"
        min={0}
        step={1}
        disabled={disabled || unlimited}
        value={unlimited || value === undefined ? "" : value}
        placeholder={unlimited ? "Unlimited" : "—"}
        onChange={(e) => onChange(e.target.value === "" ? undefined : Math.max(0, Math.trunc(Number(e.target.value))))}
      />
      {def.unlimitedAllowed && (
        <button type="button" className={`chip-btn ${unlimited ? "active" : ""}`} disabled={disabled} onClick={() => onChange(unlimited ? 0 : UNLIMITED)}>
          ∞ Unlimited
        </button>
      )}
    </div>
  );
}

export const Value = ({ v }: { v: Json }) => <span className={`value ${isUnlimited(v) ? "value-unlimited" : ""}`}>{formatValue(v)}</span>;

// ------------------------------------------------------------------ reason dialog (spec Req 6.3.2: every change needs a reason)

type Ask = (title: string, detail?: ReactNode) => Promise<string | null>;
const ReasonCtx = createContext<Ask>(async () => null);
export const useReason = () => useContext(ReasonCtx);

export function ReasonProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ title: string; detail?: ReactNode; resolve: (v: string | null) => void } | null>(null);
  const [text, setText] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (state) setTimeout(() => ref.current?.focus(), 0);
  }, [state]);
  const ask: Ask = (title, detail) => new Promise((resolve) => (setText(""), setState({ title, detail, resolve })));
  const close = (v: string | null) => {
    state?.resolve(v);
    setState(null);
  };
  return (
    <ReasonCtx.Provider value={ask}>
      {children}
      {state && (
        <div className="modal-backdrop" onMouseDown={() => close(null)}>
          <form
            className="modal"
            onMouseDown={(e) => e.stopPropagation()}
            onSubmit={(e) => {
              e.preventDefault();
              if (text.trim()) close(text.trim());
            }}
          >
            <h3>{state.title}</h3>
            {state.detail && <div className="modal-detail">{state.detail}</div>}
            <label className="label">Reason (recorded in the audit log)</label>
            <textarea ref={ref} className="input" rows={3} value={text} placeholder="e.g. MSA #42, signed 2026-11-01" onChange={(e) => setText(e.target.value)} />
            <div className="row end">
              <button type="button" className="btn ghost" onClick={() => close(null)}>
                Cancel
              </button>
              <button className="btn primary" disabled={!text.trim()}>
                Confirm
              </button>
            </div>
          </form>
        </div>
      )}
    </ReasonCtx.Provider>
  );
}

// ------------------------------------------------------------------ toasts

type Toast = { id: number; text: string; tone: "ok" | "err" };
const ToastCtx = createContext<(text: string, tone?: "ok" | "err") => void>(() => {});
export const useToast = () => useContext(ToastCtx);
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = (text: string, tone: "ok" | "err" = "ok") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, text, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4500);
  };
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.tone}`}>
            {t.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      {children && <p>{children}</p>}
    </div>
  );
}

export function initials(s: string): string {
  const parts = s.replace(/[^a-zA-Z0-9 _-]/g, "").split(/[\s_-]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "?") + (parts[1]?.[0] ?? parts[0]?.[1] ?? "")).toUpperCase();
}
