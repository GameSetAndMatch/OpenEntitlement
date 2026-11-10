import { z } from "zod";
/**
 * Privilege Catalog authoring models (RFC-0002) as Zod schemas, the TypeScript
 * counterpart of the Pydantic models in `openentitlement.privileges`.
 *
 * JSON keys are camelCase (`groupId`, `parentId`, `envOverride`). The committed
 * `spec/schemas/privilege-catalog.schema.json`, generated from the Pydantic
 * models, is the shared cross-language contract; shared fixtures under
 * `spec/assets/catalog-fixtures/` keep this module, Pydantic and that JSON
 * Schema in agreement.
 */
export type Visibility = "hidden" | "read_only" | "editable";
export interface PrivilegeBase {
  key: string;
  title: string;
  description: string;
  visibility: Visibility;
  groupId?: string;
  tags: string[];
}
/** Environment bindings exist only on boolean Privileges. */
export interface BooleanPrivilege extends PrivilegeBase {
  type: "boolean";
  default?: boolean;
  envOverride?: string;
}
export interface IntegerPrivilege extends PrivilegeBase {
  type: "integer";
  default?: number | { unlimited: true };
  minimum?: number;
  maximum?: number;
  unlimited?: boolean;
}
export interface StringEnumPrivilege extends PrivilegeBase {
  type: "enum";
  enum: string[];
  default?: string;
}
export type Privilege =
  | BooleanPrivilege
  | IntegerPrivilege
  | StringEnumPrivilege;
export interface GroupDefinition {
  id: string;
  title: string;
  description: string;
  parentId?: string;
}
export interface TagDefinition {
  id: string;
  title: string;
  description: string;
}
export interface PrivilegeCatalog {
  privileges: Privilege[];
  groups: GroupDefinition[];
  tags: TagDefinition[];
}

const unique = (values: readonly unknown[]) =>
  new Set(values).size === values.length;
const identifier = z
  .string()
  .max(80)
  .regex(/^[a-z][a-z0-9_]*$(?![\s\S])/, "Expected a flat identifier");
const title = z.string().trim().min(1).max(200);
const description = z.string().max(2000).default("");
/** Integers that are exact in every supported language: 0..2^53-1. */
const safeInteger = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const common = {
  key: identifier,
  title,
  description,
  visibility: z.enum(["hidden", "read_only", "editable"]).default("editable"),
  groupId: identifier.optional(),
  tags: z
    .array(identifier)
    .max(50)
    .refine(unique, "Privilege tags must be unique Tag identifiers")
    .default([]),
};
const needsDefault = "Hidden, read-only and environment-linked Privileges need a default";

const booleanPrivilege = z
  .strictObject({
    ...common,
    type: z.literal("boolean"),
    default: z.boolean().optional(),
    envOverride: z
      .string()
      .regex(
        /^[A-Z][A-Z0-9_]*$(?![\s\S])/,
        "envOverride must be an uppercase environment variable name",
      )
      .optional(),
  })
  .superRefine((p, ctx) => {
    if (
      (p.visibility !== "editable" || p.envOverride !== undefined) &&
      p.default === undefined
    )
      ctx.addIssue({ code: "custom", message: needsDefault });
  });

const integerPrivilege = z
  .strictObject({
    ...common,
    type: z.literal("integer"),
    default: z
      .union([safeInteger, z.strictObject({ unlimited: z.literal(true) })])
      .optional(),
    minimum: safeInteger.default(0),
    maximum: safeInteger.optional(),
    unlimited: z.boolean().default(false),
  })
  .superRefine((p, ctx) => {
    const upper = p.maximum ?? Number.MAX_SAFE_INTEGER;
    if (p.minimum > upper)
      ctx.addIssue({ code: "custom", message: "Minimum cannot exceed maximum" });
    if (typeof p.default === "object") {
      if (!p.unlimited)
        ctx.addIssue({ code: "custom", message: "Unlimited is not allowed" });
    } else if (
      p.default !== undefined &&
      (p.default < p.minimum || p.default > upper)
    )
      ctx.addIssue({
        code: "custom",
        message: "Integer Privilege default is out of bounds",
      });
    if (p.visibility !== "editable" && p.default === undefined)
      ctx.addIssue({ code: "custom", message: needsDefault });
  });

const enumPrivilege = z
  .strictObject({
    ...common,
    type: z.literal("enum"),
    enum: z
      .array(z.string().max(200))
      .min(1)
      .max(100)
      .refine(unique, "String enum requires unique string choices"),
    default: z.string().optional(),
  })
  .superRefine((p, ctx) => {
    if (p.default !== undefined && !p.enum.includes(p.default))
      ctx.addIssue({
        code: "custom",
        message: "String enum default must be one of its choices",
      });
    if (p.visibility !== "editable" && p.default === undefined)
      ctx.addIssue({ code: "custom", message: needsDefault });
  });

/** One typed Privilege, discriminated by `type`. Unknown fields are rejected. */
export const PrivilegeSchema: z.ZodType<Privilege> = z.discriminatedUnion(
  "type",
  [booleanPrivilege, integerPrivilege, enumPrivilege],
);

const groupSchema = z.strictObject({
  id: identifier,
  title,
  description,
  parentId: identifier.optional(),
});
const tagSchema = z.strictObject({ id: identifier, title, description });

/** A complete Catalog: unique identifiers, known references and an acyclic Group hierarchy. */
export const PrivilegeCatalogSchema: z.ZodType<PrivilegeCatalog> = z
  .strictObject({
    privileges: z.array(PrivilegeSchema),
    groups: z.array(groupSchema).default([]),
    tags: z.array(tagSchema).default([]),
  })
  .superRefine(({ privileges, groups, tags }, ctx) => {
    const fail = (message: string) => ctx.addIssue({ code: "custom", message });
    for (const [label, ids] of [
      ["Group", groups.map((g) => g.id)],
      ["Tag", tags.map((t) => t.id)],
      ["Privilege", privileges.map((p) => p.key)],
    ] as const)
      if (!unique(ids)) fail(`Duplicate ${label} identifier`);
    const byId = new Map(groups.map((g) => [g.id, g]));
    const tagIds = new Set(tags.map((t) => t.id));
    for (const group of groups) {
      const seen = new Set([group.id]);
      for (let parent = group.parentId; parent; ) {
        if (seen.has(parent)) {
          fail("Group hierarchy contains a cycle");
          break;
        }
        seen.add(parent);
        const next = byId.get(parent);
        if (!next) {
          fail("Unknown parent Group");
          break;
        }
        parent = next.parentId;
      }
    }
    for (const privilege of privileges) {
      if (privilege.groupId !== undefined && !byId.has(privilege.groupId))
        fail("Privilege references an unknown Group");
      if (privilege.tags.some((id) => !tagIds.has(id)))
        fail("Privilege references an unknown Tag");
    }
  });

function parseWith<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success)
    throw new Error(result.error.issues.map((i) => i.message).join("; "));
  return result.data;
}
/** Validates and normalizes one Privilege; throws an Error listing every issue. */
export function parsePrivilege(input: unknown): Privilege {
  return parseWith(PrivilegeSchema, input);
}
/** Validates and normalizes a Privilege Catalog; throws an Error listing every issue. */
export function parseCatalog(input: unknown): PrivilegeCatalog {
  return parseWith(PrivilegeCatalogSchema, input);
}
/** The standalone OEREP v1 provider retains its published wire catalog internally. */
export function standaloneCatalog(input: unknown): unknown {
  if (
    !input ||
    typeof input !== "object" ||
    !Object.hasOwn(input, "privileges")
  )
    return input;
  const catalog = parseCatalog(input);
  return {
    features: catalog.privileges.map((p) => {
      if (!Object.hasOwn(p, "default"))
        throw new Error(
          "Standalone Privilege Catalog definitions require defaults; required tier values are supported by the workspace service",
        );
      if (
        p.type === "integer" &&
        ((p.minimum ?? 0) > 0 || p.maximum !== undefined)
      )
        throw new Error(
          "Bounded integer Privileges require the workspace service",
        );
      return {
        code: p.key,
        name: p.title,
        description: p.description,
        hidden: p.visibility === "hidden",
        frozen: p.visibility === "read_only",
        privileges: [
          {
            key: p.key,
            valueType: p.type,
            default: p.default,
            ...(p.type === "boolean" && p.envOverride
              ? { envVariable: p.envOverride }
              : {}),
            ...(p.type === "integer"
              ? { unlimitedAllowed: p.unlimited ?? false }
              : {}),
            ...(p.type === "enum" ? { options: p.enum } : {}),
            groupId: p.groupId,
            tags: p.tags,
          },
        ],
      };
    }),
  };
}
