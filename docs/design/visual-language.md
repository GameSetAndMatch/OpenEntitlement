# Visual language

OpenEntitlement's interface should feel inevitable. Every element on screen earns its place, and the product itself is the decoration. This is the visual counterpart to the console's [UI guidelines](../../console/web/UI-GUIDELINES.md), whose first rule is one way to do each thing.

These principles follow the reductive tradition of industrial design: clarity, honest materials, care in details people rarely notice. They do not borrow anyone's brand. OpenEntitlement keeps its own logo, teal accent and voice.

## Principles

1. **Reduce until it breaks, then add one thing back.** Remove borders, fills, labels, buttons and words until the screen stops working. Then restore the single element that makes it work.
2. **Type does the work of hierarchy.** Use one family and few sizes. Weight and space separate ideas, not boxes and colors.
3. **One accent, used for intent.** Teal marks the primary action and the current place. Everything else is ink, muted ink or a hairline.
4. **Quiet surfaces.** Use hairlines (8% ink), generous radii and soft depth. Never a heavy border, gradient or ornament.
5. **Space is a material.** Use generous margins around the content that matters, and tight grouping for things that belong together.
6. **Honest content.** Show real product states (the actual Catalog, resolver and values), never mock dashboards or invented numbers.
7. **Light and dark are equals.** Every color is a token, so both themes come from the same rules.
8. **Motion explains, never decorates.** Use short (160ms), eased transitions for state changes only. Respect reduced motion.

## Tokens

The console defines them in `console/web/src/design.css`. The website maps the same values onto Starlight's variables in `website/src/styles/docs.css`.

| Token | Light | Dark | Use |
|---|---|---|---|
| `--canvas` | `#f6f6f4` | `#0f1011` | Page background |
| `--surface` | `#ffffff` | `#17181a` | Panels, inputs |
| `--fill` | `#f0f0ed` | `#202124` | Hover, disabled, quiet chips |
| `--ink` | `#16181b` | `#f1f1ef` | Text |
| `--muted` | `#62666d` | `#a3a6ab` | Secondary text |
| `--faint` | `#6b6f76` | `#8f9399` | Captions, table headers (still at least 4.5:1) |
| `--line` | ink 8% | white 8% | Decorative hairlines between content |
| `--control-line` | ink 52% | white 38% | Borders of fields people operate (at least 3:1) |
| `--control-off` | `#62666d` | `#6b6f76` | An off switch's track |
| `--accent` | `#0f766e` | `#3cbfae` | The one accent |
| `--danger` | `#b42318` | `#f97066` | Errors only |

**Type.** System UI family; headings weigh 600 with slightly negative tracking. Sizes: 12 (caption), 13 to 14 (labels, controls), 15 to 16 (body), 19 to 22 (section), 28 to 36 (page). On the website, display sizes reach 64.

**Shape.** Radii are 8 (navigation), 10 (inputs), 16 (panels). Buttons are capsules.

**Depth.** One shadow: a 1px contact shadow plus a long, faint ambient shadow. No other shadows.

## Applying it

- Text tokens reach 4.5:1 and control boundaries 3:1 in both themes; `console/test/design-tokens.test.ts` enforces it.

- A page has one title, one sentence of purpose, and one primary action.
- Remove a container if alignment alone shows the grouping.
- Write labels as nouns ("Seats") and actions as verbs ("Define privilege").
- Show one toast at a time.
- Compare light and dark screenshots for every UI change.
