import { z } from "zod";
/** Public authoring contract. Environment bindings exist only on boolean privileges. */
export type Visibility = "hidden" | "read_only" | "editable";
export interface PrivilegeBase {
  key: string;
  title: string;
  description: string;
  visibility: Visibility;
  groupId?: string;
  tags: string[];
}
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

const keyPattern = /^[a-z][a-z0-9_]*$/;
function validatePrivilege(input: unknown): Privilege {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new Error("Privilege must be an object");
  const b = input as Record<string, unknown>;
  const common = [
    "key",
    "title",
    "description",
    "visibility",
    "groupId",
    "tags",
    "type",
    "default",
  ];
  const extra =
    b.type === "boolean"
      ? ["envOverride"]
      : b.type === "integer"
        ? ["minimum", "maximum", "unlimited"]
        : b.type === "enum"
          ? ["enum"]
          : [];
  if (!["boolean", "integer", "enum"].includes(String(b.type)))
    throw new Error("Privilege type must be boolean, integer or enum");
  for (const key of Object.keys(b))
    if (![...common, ...extra].includes(key))
      throw new Error(`Unknown ${String(b.type)} Privilege field: ${key}`);
  if (typeof b.key !== "string" || b.key.length > 80 || !keyPattern.test(b.key))
    throw new Error("Privilege key must be a flat identifier");
  if (typeof b.title !== "string" || !b.title.trim() || b.title.length > 200)
    throw new Error("Privilege title is required (maximum 200 characters)");
  if (
    b.description !== undefined &&
    (typeof b.description !== "string" || b.description.length > 2000)
  )
    throw new Error("Invalid Privilege description");
  if (
    !["hidden", "read_only", "editable"].includes(
      String(b.visibility ?? "editable"),
    )
  )
    throw new Error("Invalid Privilege visibility");
  if (
    b.groupId !== undefined &&
    (typeof b.groupId !== "string" ||
      b.groupId.length > 80 ||
      !keyPattern.test(b.groupId))
  )
    throw new Error("Privilege groupId must be one Group identifier");
  if (
    b.tags !== undefined &&
    (!Array.isArray(b.tags) ||
      b.tags.length > 50 ||
      b.tags.some(
        (v) => typeof v !== "string" || v.length > 80 || !keyPattern.test(v),
      ) ||
      new Set(b.tags).size !== b.tags.length)
  )
    throw new Error("Privilege tags must be unique Tag identifiers");
  const result = {
    ...b,
    title: b.title.trim(),
    description: b.description ?? "",
    visibility: b.visibility ?? "editable",
    tags: b.tags ?? [],
  } as unknown as Privilege;
  if (result.type === "boolean") {
    if (
      result.envOverride !== undefined &&
      !/^[A-Z][A-Z0-9_]*$/.test(result.envOverride)
    )
      throw new Error(
        "envOverride must be an uppercase environment variable name",
      );
    if (Object.hasOwn(result, "default") && typeof result.default !== "boolean")
      throw new Error("Boolean Privilege default must be a boolean");
  } else if (result.type === "integer") {
    for (const field of ["minimum", "maximum"] as const)
      if (
        result[field] !== undefined &&
        (!Number.isSafeInteger(result[field]) || result[field]! < 0)
      )
        throw new Error(`${field} must be a non-negative integer`);
    if ((result.minimum ?? 0) > (result.maximum ?? Number.MAX_SAFE_INTEGER))
      throw new Error("Minimum cannot exceed maximum");
    if (result.unlimited !== undefined && typeof result.unlimited !== "boolean")
      throw new Error("unlimited must be a boolean");
    if (Object.hasOwn(result, "default")) {
      const v = result.default;
      if (
        typeof v === "object" &&
        v?.unlimited === true &&
        Object.keys(v).length === 1
      ) {
        if (!result.unlimited) throw new Error("Unlimited is not allowed");
      } else if (
        typeof v !== "number" ||
        !Number.isSafeInteger(v) ||
        v < (result.minimum ?? 0) ||
        v > (result.maximum ?? Number.MAX_SAFE_INTEGER)
      )
        throw new Error("Integer Privilege default is out of bounds");
    }
  } else {
    if (
      !Array.isArray(result.enum) ||
      !result.enum.length ||
      result.enum.length > 100 ||
      result.enum.some((v) => typeof v !== "string" || v.length > 200) ||
      new Set(result.enum).size !== result.enum.length
    )
      throw new Error("String enum requires unique string choices");
    if (
      Object.hasOwn(result, "default") &&
      (typeof result.default !== "string" ||
        !result.enum.includes(result.default))
    )
      throw new Error("String enum default must be one of its choices");
  }
  if (
    (result.visibility !== "editable" ||
      (result.type === "boolean" && result.envOverride)) &&
    !Object.hasOwn(result, "default")
  )
    throw new Error(
      "Hidden, read-only and environment-linked Privileges need a default",
    );
  return structuredClone(result);
}

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
function validateCatalog(input: unknown): PrivilegeCatalog {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new Error("Privilege Catalog must be an object");
  const b = input as Record<string, unknown>;
  if (
    Object.keys(b).some((k) => !["privileges", "groups", "tags"].includes(k)) ||
    !Array.isArray(b.privileges)
  )
    throw new Error(
      "Privilege Catalog contains unknown fields or no privileges list",
    );
  function metadata(
    input: unknown,
    group: boolean,
  ): GroupDefinition | TagDefinition {
    if (!input || typeof input !== "object" || Array.isArray(input))
      throw new Error("Group and Tag definitions must be objects");
    const row = input as Record<string, unknown>;
    if (
      Object.keys(row).some(
        (k) =>
          !(
            group
              ? ["id", "title", "description", "parentId"]
              : ["id", "title", "description"]
          ).includes(k),
      )
    )
      throw new Error("Unknown Group or Tag field");
    if (
      typeof row.id !== "string" ||
      row.id.length > 80 ||
      !keyPattern.test(row.id) ||
      typeof row.title !== "string" ||
      !row.title.trim() ||
      row.title.length > 200 ||
      (row.description !== undefined &&
        (typeof row.description !== "string" || row.description.length > 2000))
    )
      throw new Error("Invalid Group or Tag metadata");
    if (
      row.parentId !== undefined &&
      (!group ||
        typeof row.parentId !== "string" ||
        !keyPattern.test(row.parentId))
    )
      throw new Error("Invalid parent Group");
    return {
      id: row.id,
      title: row.title.trim(),
      description: (row.description ?? "") as string,
      ...(row.parentId ? { parentId: row.parentId as string } : {}),
    };
  }
  if (
    (b.groups !== undefined && !Array.isArray(b.groups)) ||
    (b.tags !== undefined && !Array.isArray(b.tags))
  )
    throw new Error("Groups and Tags must be lists");
  const groups = ((b.groups ?? []) as unknown[]).map(
      (g) => metadata(g, true) as GroupDefinition,
    ),
    tags = ((b.tags ?? []) as unknown[]).map((t) => metadata(t, false)),
    privileges = b.privileges.map(parsePrivilege);
  for (const [label, ids] of [
    ["Group", groups.map((g) => g.id)],
    ["Tag", tags.map((t) => t.id)],
    ["Privilege", privileges.map((p) => p.key)],
  ] as const)
    if (new Set(ids).size !== ids.length)
      throw new Error(`Duplicate ${label} identifier`);
  for (const group of groups) {
    const seen = new Set([group.id]);
    let parent = group.parentId;
    while (parent) {
      if (seen.has(parent)) throw new Error("Group hierarchy contains a cycle");
      seen.add(parent);
      const next = groups.find((g) => g.id === parent);
      if (!next) throw new Error("Unknown parent Group");
      parent = next.parentId;
    }
  }
  for (const privilege of privileges) {
    if (privilege.groupId && !groups.some((g) => g.id === privilege.groupId))
      throw new Error("Privilege references an unknown Group");
    if (privilege.tags.some((id) => !tags.some((t) => t.id === id)))
      throw new Error("Privilege references an unknown Tag");
  }
  return { privileges, groups, tags };
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

// This optional subpath shares the browser/server model without loading Zod in the runtime SDK.
const identifierSchema = z
  .string()
  .max(80)
  .regex(/^[a-z][a-z0-9_]*$/, "Expected a flat identifier");
const titleSchema = z.string().trim().min(1).max(200);
const commonSchema = {
  key: identifierSchema,
  title: titleSchema,
  description: z.string().max(2000).optional(),
  visibility: z.enum(["hidden", "read_only", "editable"]).optional(),
  groupId: identifierSchema.optional(),
  tags: z.array(identifierSchema).max(50).optional(),
};
const rawPrivilegeSchema = z.discriminatedUnion("type", [
  z.strictObject({
    ...commonSchema,
    type: z.literal("boolean"),
    default: z.boolean().optional(),
    envOverride: z
      .string()
      .regex(/^[A-Z][A-Z0-9_]*$/)
      .optional(),
  }),
  z.strictObject({
    ...commonSchema,
    type: z.literal("integer"),
    default: z
      .union([z.number(), z.strictObject({ unlimited: z.literal(true) })])
      .optional(),
    minimum: z.number().default(0),
    maximum: z.number().optional(),
    unlimited: z.boolean().default(false),
  }),
  z.strictObject({
    ...commonSchema,
    type: z.literal("enum"),
    enum: z.array(z.string().max(200)).min(1).max(100),
    default: z.string().optional(),
  }),
]);
export const PrivilegeSchema = rawPrivilegeSchema.transform((input, ctx) => {
  try {
    return validatePrivilege(input);
  } catch (e) {
    ctx.addIssue({ code: "custom", message: (e as Error).message });
    return z.NEVER;
  }
});
const groupSchema = z.strictObject({
  id: identifierSchema,
  title: titleSchema,
  description: z.string().max(2000).optional(),
  parentId: identifierSchema.optional(),
});
const tagSchema = z.strictObject({
  id: identifierSchema,
  title: titleSchema,
  description: z.string().max(2000).optional(),
});
export const PrivilegeCatalogSchema = z
  .strictObject({
    privileges: z.array(PrivilegeSchema),
    groups: z.array(groupSchema).optional(),
    tags: z.array(tagSchema).optional(),
  })
  .transform((input, ctx) => {
    try {
      return validateCatalog(input);
    } catch (e) {
      ctx.addIssue({ code: "custom", message: (e as Error).message });
      return z.NEVER;
    }
  });
export function parsePrivilege(input: unknown): Privilege {
  const result = PrivilegeSchema.safeParse(input);
  if (!result.success)
    throw new Error(result.error.issues.map((i) => i.message).join("; "));
  return result.data;
}
export function parseCatalog(input: unknown): PrivilegeCatalog {
  const result = PrivilegeCatalogSchema.safeParse(input);
  if (!result.success)
    throw new Error(result.error.issues.map((i) => i.message).join("; "));
  return result.data;
}
