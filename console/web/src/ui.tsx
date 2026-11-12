/** Small UI kit: chips, toggles, value inputs, the mandatory-reason dialog. */

import { createContext, useContext, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { validateValue } from "@openentitlement/core";
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

export {Toggle, EnvironmentNotice} from "./privilege-controls.tsx";
import {Toggle, EnvironmentNotice} from "./privilege-controls.tsx";
export function ValueInput(props: { def: PrivilegeDef; value: Json; onChange: (v: Json) => void; disabled?: boolean }) {
 const frozen=Boolean(props.def.environment||props.def.frozen);
 return <><UnrestrictedValueInput {...props} disabled={props.disabled||frozen} value={props.def.environment?(props.def.frozen?props.def.default:props.value??props.def.default)===true&&props.def.environment.value:props.def.frozen?props.def.default:props.value}/><EnvironmentNotice binding={props.def.environment} frozen={frozen}/></>;
}
function UnrestrictedValueInput({ def, value, onChange, disabled }: { def: PrivilegeDef; value: Json; onChange: (v: Json) => void; disabled?: boolean }) {
  if (def.valueType === "boolean") return <Toggle checked={value === true} onChange={onChange} disabled={disabled} label={def.key} />;
  if (def.valueType === "enum")
    return (
      <select aria-label={def.key} className="input" value={value ?? ""} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
        {value === undefined && <option value="">—</option>}
        {def.options.map((o) => (
          <option key={o}>{o}</option>
        ))}
      </select>
    );
  return <IntegerValueInput key={def.key} def={def} value={value} onChange={onChange} disabled={disabled}/>;
}

function IntegerValueInput({ def, value, onChange, disabled }: { def: PrivilegeDef; value: Json; onChange: (v: Json) => void; disabled?: boolean }) {
  const unlimited = isUnlimited(value);
  const errorId = useId();
  const input = useRef<HTMLInputElement>(null);
  const problem = unlimited || value === undefined ? undefined : validateValue({ ...def, feature: "" }, value);
  useEffect(() => { input.current?.setCustomValidity(problem ?? ""); }, [problem]);
  const lastFinite = useRef(typeof value === "number" ? value : 0);
  useEffect(() => { if (typeof value === "number") lastFinite.current = value; }, [value]);
  return <div className="int-input">
    <input ref={input} aria-invalid={Boolean(problem)} aria-describedby={problem ? errorId : undefined} className="input" type={unlimited ? "text" : "number"} aria-label={def.key} step={1}
      disabled={disabled || unlimited} value={unlimited ? "∞" : value ?? ""}
      onChange={e => onChange(e.target.value === "" ? undefined : Number(e.target.value))}/>
    {problem && <small id={errorId} role="alert" className="field-error">{problem}</small>}
    {def.unlimitedAllowed && <label className="unlimited-control">
      <input type="checkbox" aria-label={`Unlimited ${def.key}`} checked={unlimited} disabled={disabled}
        onChange={e => {
          if (e.target.checked && typeof value === "number") lastFinite.current = value;
          onChange(e.target.checked ? UNLIMITED : lastFinite.current);
        }}/>
      <span>Unlimited</span>
    </label>}
  </div>;
}

export const Value = ({ v }: { v: Json }) => <span className={`value ${isUnlimited(v) ? "value-unlimited" : ""}`}>{formatValue(v)}</span>;

// ------------------------------------------------------------------ reason dialog (spec Req 6.3.2: contract terms need a reason) and plain confirmation

type Ask = (title: string, detail?: ReactNode, options?: { reason?: boolean }) => Promise<string | null>;
const ReasonCtx = createContext<Ask>(async () => null);
export const useReason = () => useContext(ReasonCtx);
/** Asks only "are you sure", for an action that is hard to undo. */
export const useConfirm = () => { const ask = useContext(ReasonCtx); return (title: string, detail?: ReactNode) => ask(title, detail, { reason: false }).then((v) => v !== null); };

export function ReasonProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ title: string; detail?: ReactNode; reason: boolean; resolve: (v: string | null) => void } | null>(null);
  const [text, setText] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (state) { dialog.current?.showModal(); (state.reason ? ref.current : dialog.current?.querySelector<HTMLButtonElement>("button.primary"))?.focus(); }
  }, [state]);
  const ask: Ask = (title, detail, options) => new Promise((resolve) => (setText(""), setState({ title, detail, reason: options?.reason ?? true, resolve })));
  const close = (v: string | null) => {
    state?.resolve(v);
    setState(null);
  };
  return (
    <ReasonCtx.Provider value={ask}>
      {children}
      {state && (
        <dialog ref={dialog} className="modal-backdrop" aria-labelledby="reason-title" onCancel={() => close(null)}>
          <form
            className="modal"
            onMouseDown={(e) => e.stopPropagation()}
            onSubmit={(e) => {
              e.preventDefault();
              if (!state.reason) close("");
              else if (text.trim()) close(text.trim());
            }}
          >
            <h3 id="reason-title">{state.title}</h3>
            {state.detail && <div className="modal-detail">{state.detail}</div>}
            {state.reason && <><label htmlFor="change-reason" className="label">Reason (recorded in change history)</label>
            <textarea id="change-reason" name="reason" ref={ref} className="input" rows={3} value={text} onChange={(e) => setText(e.target.value)} /></>}
            <div className="row end">
              <button type="button" className="btn ghost" onClick={() => close(null)}>
                Cancel
              </button>
              <button className="btn primary" disabled={state.reason && !text.trim()}>
                Confirm
              </button>
            </div>
          </form>
        </dialog>
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
    // One message at a time: a newer toast replaces the previous one.
    setToasts([{ id, text, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4500);
  };
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
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
