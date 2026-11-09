import { useState } from "react";
import type { Workspace, Save } from "./app.tsx";
import { resolve, type Value } from "../../../server/workspace/model.ts";
import { ValuesEditor, Field } from "./fields.tsx";
import { EnvironmentNotice } from "../ui.tsx";

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
                    <td>
                      {typeof d.value === "object"
                        ? "∞"
                        : typeof d.value === "boolean"
                          ? d.value
                            ? "Enabled"
                            : "Disabled"
                          : String(d.value)}
                    </td>
                    <td>
                      {d.reason}
                      <EnvironmentNotice
                        binding={d.environment}
                        frozen={d.frozen}
                      />
                      {d.subjectState === "stale" && (
                        <small>
                          Previous variant’s user terms are inactive
                        </small>
                      )}
                      {d.subjectState === "suspended" && (
                        <small>
                          User terms are suspended by contract status
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
}: {
  workspace: Workspace;
  organizationId: string;
  save: Save;
  canEdit: boolean;
  busy: boolean;
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
              setShow(true);
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
      {show && allowed && canEdit && (
        <form
          aria-label="User entitlements"
          onSubmit={(e) => {
            e.preventDefault();
            void save("subjects", draft, "Save user entitlements").then(
              (ok) => {
                if (ok) {
                  setShow(false);
                  setSelected(draft.subjectId);
                }
              },
            );
          }}
        >
          <h3>{editing ? "Edit user entitlements" : "Add application user"}</h3>
          <div className="two-cols">
            <label>
              User display name
              <input
                required
                maxLength={200}
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
            </label>
            <label>
              Subject ID
              <input
                required
                maxLength={200}
                disabled={editing}
                value={draft.subjectId}
                onChange={(e) =>
                  setDraft({ ...draft, subjectId: e.target.value })
                }
              />
              <small>
                The identifier your application sends with this Organization ID.
                No sign-in account is created.
              </small>
            </label>
          </div>
          <h3>Personal terms</h3>
          <p>
            Unchecked values continue to inherit. Saving explicitly binds these
            terms to {organization.variantId}.
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
          {numeric.length > 0 && (
            <>
              <h3>Personal grants</h3>
              <p>
                Additional allowances for this user. Usage is measured by your
                application; evaluation does not consume them.
              </p>
              {numeric.map((def) => (
                <div className="setup-value" key={def.key}>
                  <label>
                    <input
                      type="checkbox"
                      aria-label={`Grant ${def.key}`}
                      checked={Object.hasOwn(draft.grants, def.key)}
                      onChange={(e) => {
                        const grants = { ...draft.grants };
                        if (e.target.checked) grants[def.key] = 1;
                        else delete grants[def.key];
                        setDraft({ ...draft, grants });
                      }}
                    />
                    Add {def.name} allowance
                  </label>
                  {Object.hasOwn(draft.grants, def.key) && (
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
                  )}
                </div>
              ))}
            </>
          )}
          <div className="row">
            <button className="btn primary" disabled={busy}>
              Save user entitlements
            </button>
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={() => setShow(false)}
            >
              Cancel
            </button>
          </div>
        </form>
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
                  setShow(true);
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
                      setShow(false);
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
