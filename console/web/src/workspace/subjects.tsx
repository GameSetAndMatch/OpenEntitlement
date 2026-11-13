import { useState } from "react";
import type { Workspace, Save } from "./app.tsx";
import { resolve, type Value, type WorkspaceData } from "../../../server/workspace/model.ts";
import { ValuesEditor, Field } from "./fields.tsx";
import { EnvironmentNotice } from "../ui.tsx";
import { FormField } from "../form.tsx";

const display = (value: Value | undefined) =>
  typeof value === "object"
    ? "∞"
    : typeof value === "boolean"
      ? value
        ? "Enabled"
        : "Disabled"
      : String(value);

/** Where a value comes from, in glossary terms. A Grant shows the one-line sum it adds to. */
function valueSource(
  data: WorkspaceData,
  d: Pick<ReturnType<typeof resolve>, "source" | "variantId" | "value" | "grantApplied">,
) {
  const name =
    d.source === "VARIANT"
      ? (data.variants.find((v) => v.id === d.variantId)?.name ?? "Tier variant")
      : {
          DEFAULT: "Catalog default",
          CONTRACT: "Organization terms",
          SUBJECT: "Personal terms",
          GRACE: "Grace period",
        }[d.source];
  return d.grantApplied && typeof d.value === "number"
    ? `${name} ${d.value - d.grantApplied} + Grant ${d.grantApplied}`
    : name;
}

export function EffectiveEntitlements({
  workspace: w,
  organizationId,
  subjectId,
}: {
  workspace: Workspace;
  organizationId: string;
  subjectId?: string;
}) {
  return (
    <div className="overflow">
      <table>
        <thead>
          <tr>
            <th>Privilege</th>
            <th>Effective value</th>
            <th>Source</th>
            <th>Access</th>
          </tr>
        </thead>
        <tbody>
          {w.data.privileges
            .filter(
              (p) =>
                !p.hidden &&
                !w.data.features.find((f) => f.id === p.featureId)?.hidden,
            )
            .map((p) => {
              try {
                const d = resolve(
                  w.data,
                  organizationId,
                  p.key,
                  new Date(),
                  w.environment,
                  subjectId,
                );
                return (
                  <tr key={p.key}>
                    <td>
                      <strong>{p.name}</strong>
                      <small>
                        <code>{p.key}</code>
                      </small>
                    </td>
                    <td>{display(d.value)}</td>
                    <td>
                      {valueSource(w.data, d)}
                      <EnvironmentNotice
                        binding={d.environment}
                        frozen={d.frozen}
                      />
                      {d.subjectState === "stale" && (
                        <small>
                          Previous variant’s personal terms are inactive
                        </small>
                      )}
                      {d.subjectState === "suspended" && (
                        <small>
                          Personal terms are suspended by contract status
                        </small>
                      )}
                    </td>
                    <td>{d.readOnly ? "Read-only" : "Standard"}</td>
                  </tr>
                );
              } catch (e) {
                return (
                  <tr key={p.key}>
                    <td>{p.name}</td>
                    <td colSpan={3}>
                      <span role="alert" className="field-error">
                        {(e as Error).message}. Review this Organization’s tier
                        assignment.
                      </span>
                    </td>
                  </tr>
                );
              }
            })}
        </tbody>
      </table>
    </div>
  );
}
export function SubjectEntitlements({
  workspace: w,
  organizationId,
  save,
  canEdit,
  busy,
  onFormChange,
}: {
  workspace: Workspace;
  organizationId: string;
  save: Save;
  canEdit: boolean;
  busy: boolean;
  /** Lets the page hide everything else while the form is open. */
  onFormChange?: (open: boolean) => void;
}) {
  const fresh = () => ({
    organizationId,
    subjectId: "",
    name: "",
    terms: {} as Record<string, Value>,
    grants: {} as Record<string, number>,
  });
  const [draft, setDraft] = useState(fresh),
    [show, setShow] = useState(false),
    [editing, setEditing] = useState(false),
    [selected, setSelected] = useState("");
  const allowed = w.hosting?.subjectEntitlements === true;
  const rows = w.data.subjects.filter(
    (s) => s.organizationId === organizationId,
  );
  const visible = w.data.privileges.filter(
    (p) =>
      !p.hidden && !w.data.features.find((f) => f.id === p.featureId)?.hidden,
  );
  const base: Record<string, Value> = {};
  for (const p of visible) {
    try {
      base[p.key] = resolve(
        w.data,
        organizationId,
        p.key,
        new Date(),
        w.environment,
      ).value!;
    } catch {
      /* Effective table shows validation failures. */
    }
  }
  const numeric = visible.filter(
    (p) =>
      p.type === "integer" &&
      !p.frozen &&
      !p.envVariable &&
      !w.data.features.find((f) => f.id === p.featureId)?.frozen,
  );
  const selectedUser = rows.find((s) => s.subjectId === selected);
  const organization = w.data.organizations.find(
    (o) => o.id === organizationId,
  )!;
  function open() {
    setShow(true);
    onFormChange?.(true);
  }
  function close() {
    setShow(false);
    onFormChange?.(false);
  }
  // While the form is open it is the only thing on the page, like the Organization form.
  if (show && allowed && canEdit)
    return (
      <form
        className="panel form"
        aria-label="User entitlements"
        onSubmit={(e) => {
          e.preventDefault();
          void save("subjects", draft, "Save user entitlements").then((ok) => {
            if (ok) {
              close();
              setSelected(draft.subjectId);
            }
          });
        }}
      >
        <div className="form-header">
          <h2>
            {editing ? `Edit ${draft.name || draft.subjectId}` : "Add an application user"}
          </h2>
          <p>
            An application user is someone in {organization.name} your
            application identifies. They inherit the Organization’s values unless
            you set personal terms or grants. No sign-in account is created.
          </p>
        </div>
        <fieldset className="form-section">
          <legend>User</legend>
          <div className="form-grid">
            <FormField label="User display name">
              <input
                required
                maxLength={200}
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
            </FormField>
            <FormField
              label="Subject ID"
              hint={
                editing
                  ? "Your application sends this ID. It cannot change."
                  : "The identifier your application sends with this Organization ID."
              }
            >
              <input
                className="mono"
                required
                maxLength={200}
                disabled={editing}
                value={draft.subjectId}
                onChange={(e) =>
                  setDraft({ ...draft, subjectId: e.target.value })
                }
              />
            </FormField>
          </div>
        </fieldset>
        <fieldset className="form-section">
          <legend>
            Personal terms <span className="optional">Optional</span>
          </legend>
          <p className="section-hint">
            Leave a value inherited, or replace it for this user only. Saving
            binds these terms to {organization.variantId}.
          </p>
          <ValuesEditor
            definitions={visible}
            base={base}
            environment={w.environment}
            frozenFeatures={w.data.features
              .filter((f) => f.frozen)
              .map((f) => f.id)}
            values={draft.terms}
            onChange={(terms) => setDraft({ ...draft, terms })}
          />
        </fieldset>
        {numeric.length > 0 && (
          <fieldset className="form-section">
            <legend>
              Personal grants <span className="optional">Optional</span>
            </legend>
            <p className="section-hint">
              An allowance added on top of this user’s value. Your application
              measures usage; evaluation does not consume it.
            </p>
            <div className="workspace-values">
              {numeric.map((def) => {
                const granted = Object.hasOwn(draft.grants, def.key);
                return (
                  <fieldset className="setup-value" key={def.key}>
                    <legend className="sr-only">{def.name}</legend>
                    <div>
                      <strong>{def.name}</strong>
                      <code>{def.key}</code>
                      <label className="unlimited-control">
                        <input
                          type="checkbox"
                          aria-label={`Grant ${def.key}`}
                          checked={granted}
                          onChange={(e) => {
                            const grants = { ...draft.grants };
                            if (e.target.checked) grants[def.key] = 1;
                            else delete grants[def.key];
                            setDraft({ ...draft, grants });
                          }}
                        />
                        Add an allowance
                      </label>
                    </div>
                    <div>
                      {granted ? (
                        <Field
                          def={{
                            ...def,
                            key: `grant_${def.key}`,
                            minimum: 1,
                            unlimited: false,
                          }}
                          value={draft.grants[def.key]}
                          onChange={(v) =>
                            setDraft({
                              ...draft,
                              grants: { ...draft.grants, [def.key]: v as number },
                            })
                          }
                        />
                      ) : (
                        <div className="inherited-value">
                          <strong>None</strong>
                          <small>No grant</small>
                        </div>
                      )}
                    </div>
                  </fieldset>
                );
              })}
            </div>
          </fieldset>
        )}
        <div className="form-actions">
          <button type="button" className="btn" onClick={close}>
            Cancel
          </button>
          <button className="btn primary" disabled={busy}>
            Save user entitlements
          </button>
        </div>
      </form>
    );
  return (
    <section className="panel workspace-form">
      <div className="section-title">
        <h2>User entitlements</h2>
        {canEdit && allowed && (
          <button
            className="btn primary"
            disabled={busy}
            onClick={() => {
              setDraft(fresh());
              setEditing(false);
              open();
            }}
          >
            Add user
          </button>
        )}
      </div>
      <p>
        Application users inherit this Organization’s values. Personal terms
        replace a value; grants add an allowance. These users are separate from
        console members and Roles.
      </p>
      {!allowed && (
        <p role="note" className="notice">
          User entitlements require Cloud Enterprise. Pro includes Organization
          entitlements. Existing user records are retained but user evaluation
          is unavailable.
        </p>
      )}
      {!rows.length && (
        <p>
          No personal exceptions. Every user inherits the Organization’s values.
        </p>
      )}
      {rows.length > 0 && (
        <div className="workspace-list">
          {rows.map((row) => (
            <button
              className="workspace-card"
              key={row.subjectId}
              onClick={() => setSelected(row.subjectId)}
            >
              <strong>{row.name}</strong>
              <code>{row.subjectId}</code>
              <small>
                {row.variantId === organization.variantId
                  ? "Current variant"
                  : "Previous variant’s terms inactive · grants retained"}
              </small>
            </button>
          ))}
        </div>
      )}
      {selectedUser && (
        <div>
          <div className="section-title">
            <h3>{selectedUser.name}</h3>
            {canEdit && allowed && (
              <button
                className="btn"
                disabled={busy}
                onClick={() => {
                  const { variantId: _, ...entry } = selectedUser;
                  setDraft(structuredClone(entry));
                  setEditing(true);
                  open();
                }}
              >
                Edit user entitlements
              </button>
            )}
            {canEdit && (
              <button
                className="btn"
                disabled={busy}
                onClick={() =>
                  void save(
                    "subjects",
                    { organizationId, subjectId: selectedUser.subjectId },
                    "Remove user exceptions and restore Organization inheritance",
                    "DELETE",
                  ).then((ok) => {
                    if (ok) {
                      setSelected("");
                    }
                  })
                }
              >
                Remove user exceptions
              </button>
            )}
          </div>
          {allowed && (
            <EffectiveEntitlements
              workspace={w}
              organizationId={organizationId}
              subjectId={selectedUser.subjectId}
            />
          )}
        </div>
      )}
    </section>
  );
}
