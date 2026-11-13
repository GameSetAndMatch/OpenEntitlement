import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";
import { SubjectEntitlements } from "./subjects.tsx";
import { emptyData } from "../../../server/workspace/model.ts";
import { subject } from "../../../server/workspace/subjects.ts";
import type { Workspace } from "./app.tsx";
const data = emptyData();
data.privileges = [
  {
    key: "ai_tokens",
    name: "AI tokens",
    description: "Personal token allowance.",
    type: "integer",
    default: 100,
  },
];
data.tiers = [
  { id: "business", name: "Business", rank: 1, gracePeriodDays: 0 },
];
data.variants = [
  {
    id: "business",
    name: "Business",
    tierId: "business",
    kind: "standard",
    values: { ai_tokens: 1000 },
  },
];
data.organizations = [
  {
    id: "acme",
    name: "ACME",
    variantId: "business",
    status: "active",
    terms: { ai_tokens: 2000 },
  },
];
const workspace: Workspace = {
  id: "example",
  name: "ACME product",
  role: "Owner",
  revision: 1,
  data,
  hosting: { mode: "self_hosted", tier: "pro", subjectEntitlements: true },
};
function Controlled({ cloudPro = false }: { cloudPro?: boolean }) {
  const [w, setW] = useState<Workspace>(() => ({
    ...structuredClone(workspace),
    ...(cloudPro
      ? { hosting: { mode: "saas", tier: "pro", subjectEntitlements: false } }
      : {}),
  }));
  return (
    <SubjectEntitlements
      workspace={w}
      organizationId="acme"
      canEdit
      busy={false}
      save={async (_section, entry) => {
        setW({ ...w, data: { ...w.data, subjects: [subject(w.data, entry)] } });
        return true;
      }}
    />
  );
}
const meta = {
  title: "Organizations/User entitlements",
  component: SubjectEntitlements,
  args: {
    workspace,
    organizationId: "acme",
    save: async () => true,
    canEdit: true,
    busy: false,
  },
  render: () => <Controlled />,
  tags: ["autodocs"],
} satisfies Meta<typeof SubjectEntitlements>;
export default meta;
type Story = StoryObj<typeof meta>;
export const PersonalAllowance: Story = {
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    await userEvent.click(c.getByRole("button", { name: "Add user" }));
    // The form replaces the list while it is open, like every other form.
    await expect(
      c.queryByRole("button", { name: "Add user" }),
    ).not.toBeInTheDocument();
    await expect(c.queryByText(/No personal exceptions/)).not.toBeInTheDocument();
    await expect(
      [...canvasElement.querySelectorAll(".form-actions button")].map(
        (b) => b.textContent,
      ),
    ).toEqual(["Cancel", "Save user entitlements"]);
    await expect(
      [...canvasElement.querySelectorAll(".form-section > legend")].map(
        (l) => l.textContent,
      ),
    ).toEqual(["User", "Personal terms Optional", "Personal grants Optional"]);
    await userEvent.type(c.getByLabelText("User display name"), "Alice");
    await userEvent.type(c.getByLabelText(/^Subject ID/), "idp|alice");
    await expect(c.getByText("2000")).toBeVisible();
    await userEvent.click(c.getByLabelText("Grant ai_tokens"));
    await userEvent.clear(c.getByLabelText("grant_ai_tokens"));
    await userEvent.type(c.getByLabelText("grant_ai_tokens"), "50");
    await userEvent.click(
      c.getByRole("button", { name: "Save user entitlements" }),
    );
    await expect(
      c.getByRole("row", { name: /AI tokens.*2050.*SUBJECT_GRANT/ }),
    ).toBeVisible();
    canvasElement.dataset.playComplete = "true";
  },
};
/** The open form, for the layout check at desktop and phone widths. */
export const FormOpen: Story = {
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    await userEvent.click(c.getByRole("button", { name: "Add user" }));
    await userEvent.click(c.getByLabelText("Grant ai_tokens"));
    await expect(c.getByLabelText("grant_ai_tokens")).toBeVisible();
    canvasElement.dataset.playComplete = "true";
  },
};
export const CloudPro: Story = {
  render: () => <Controlled cloudPro />,
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    await expect(c.getByRole("note")).toHaveTextContent("Cloud Enterprise");
    await expect(
      c.queryByRole("button", { name: "Add user" }),
    ).not.toBeInTheDocument();
  },
};
