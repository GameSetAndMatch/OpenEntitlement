# Console UI guidelines

Visual decisions (tokens, type, shape, depth, light and dark) live in the [visual language](../../docs/design/visual-language.md). Every color comes from a token in `web/src/design.css`; never hard-code one.

## One way to do each thing

Every task has exactly one entry point, shown only when it can be used:

- One button per action. Do not offer the same action from the sidebar, the page and a form. Create things where they are used, such as a Group from the Privilege form's folder picker or a variant from its tier.
- Hide what cannot be used yet instead of showing it disabled ("Create variant" before any tier exists). An empty state names the one next step and holds its button. The same button moves above the list once the list has items.
- While a form is open, it is the only thing on the page. Hide the list and the page's create button until the person saves or cancels.
- Do not repeat information. The page title, workspace switcher and sidebar already say where the person is and what role they have, so there is no breadcrumb bar or role badge. Each value appears once (a member's role is the role control itself).
- Keep the person where they were. The console reopens the last workspace this browser used. Switching and creating workspaces live behind the workspace mark at the top left, not on a page of their own.
- No manual refresh buttons. Pages reload their data when the window regains focus.
- One export format action per page (Download YAML). Copying is available from the shown text.

These rules keep console forms readable and consistent. `test/form-layout.mjs` enforces the mechanical ones in the Storybook and workspace browser regressions, so a form that breaks them fails CI.

## Form structure

A form is a `.form` panel with three parts, always in this order:

1. **`.form-header`:** an `h2` naming the action ("Define a Privilege", "Edit Seats") and one sentence explaining what the object is.
2. **`.form-section` fieldsets**, each with a short `<legend>` ("Basics", "Value", "Organize"). Sections are divided by a rule. A section hint (`.section-hint`) is optional.
3. **`.form-actions`:** Cancel, then the primary action on the right. Name the primary button after its outcome ("Save privilege", "Save changes").

Order sections by what the person must decide, not by data model:

- First, what the object **is** (name, identifier).
- Then what it **does** (type, value, defaults, constraints).
- Last, how it is **organized** (Group, Tags). Mark that section *Optional*; it never changes behavior.

## Fields

- Use `FormField` and `Check` from `web/src/form.tsx`. Do not hand-write `<label>` wrappers.
- The label holds only the field's name, in sentence case ("Value type", not "Value type (boolean prerequisite)"). Explanations go in `hint`, which is announced as the description through `aria-describedby`. Never put hints inside the label.
- Mark optional fields with `optional`, not with "(optional)" in the label. Required fields use the `required` attribute.
- Two related short fields can share a row with `.form-grid`. It collapses to one column on phones. Long inputs (description, lists) take the full width.
- Never add margins to individual fields. A section's `gap` spaces its children; the layout check rejects a direct child of a section that sets its own vertical margin.
- Show a control only to people who can use it. For example, hide the environment prerequisite from non-administrators unless it is already set.
- Do not use placeholders as example values. Use one only for a format hint ("0" for an empty number that means 0), never for a suggested name.

## Identifiers

When an object has a human title and a stable identifier (Privilege key, Group ID, Tag ID), derive the identifier from the title with `identifierFromTitle` while creating: lowercase, accents dropped, other characters become one underscore. Stop following the title once the person edits the identifier; resume if they clear it. The identifier is read-only after saving.

## Lists the person builds

Never ask for one-item-per-line text. Use `ChoiceList`: numbered rows, Enter adds the next row, Backspace in an empty row removes it, pasting several lines adds one row per line, and duplicates show an error on the row. A visible "+ Add choice" button makes adding discoverable without the keyboard.

## Choosing from things people manage

When a field picks from things people create (Groups, Tags), creating one must not require leaving the form. Groups are folders: `GroupPicker` shows them as a tree. Every folder has a "+" to make a new Group inside it, and the name is typed in place, as in Finder. Enter creates and selects it; Escape cancels. Tags use `TagPicker`'s search-or-create. `GroupPicker` keeps a just-created Group visible before the saved list refreshes; new pickers should do the same.

## Checkboxes and switches

The global input style applies only to text-like inputs; checkboxes and radios are 16px and sit beside their label, with any hint underneath. Use the `Toggle` switch for an on/off *value* (a boolean Privilege), and a checkbox for a form *option* ("Allow unlimited").

## Constraints

Do not invent limits the product does not have. If the data model allows a value (for example a negative integer minimum), the form allows it too. Validation messages state the rule and the field ("Must be 0 or greater"), next to the field.

## Verification

Every form has a Storybook story whose play function exercises it and ends with `canvasElement.dataset.playComplete = 'true'`. `test/storybook-browser.mjs` waits for that marker, then runs `assertFormLayout` at 1280px and 390px. The layout check covers stretched or detached checkboxes, unlabeled controls, overlapping fields, controls outside the form, horizontal overflow, and stray margins.
