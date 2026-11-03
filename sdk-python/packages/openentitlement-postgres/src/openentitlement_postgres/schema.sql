-- OpenEntitlement reference Postgres schema, v0.1.0.
-- Shared by the Python (openentitlement-postgres) and TypeScript (@openentitlement/postgres) providers.
-- Values are jsonb: true/false, integers, enum strings, and {"unlimited": true} (spec Requirement 1.2.3).
-- Idempotent: safe to run on every start.

create table if not exists oe_plan (
  id          text primary key,
  name        text not null,
  rank        integer,
  public      boolean not null default true,
  variant_of  text references oe_plan (id)
);

create table if not exists oe_plan_value (
  plan_id    text not null references oe_plan (id) on delete cascade,
  privilege  text not null,
  value      jsonb not null,
  primary key (plan_id, privilege)
);

create table if not exists oe_assignment (
  organization_id  text primary key,
  plan_id          text not null references oe_plan (id),
  channel          text,
  assigned_at      timestamptz not null
);

create table if not exists oe_override (
  id               text primary key,
  organization_id  text not null,
  subject_id       text,
  resource_id      text,
  privilege        text not null,
  value            jsonb not null,
  plan_family      text not null,
  reason           text not null check (length(btrim(reason)) > 0),
  starts_at        timestamptz,
  expires_at       timestamptz,
  created_by       text not null,
  created_at       timestamptz not null,
  check (starts_at is null or expires_at is null or starts_at < expires_at)
);
create index if not exists oe_override_org_privilege on oe_override (organization_id, privilege);

create table if not exists oe_grant (
  id               text primary key,
  organization_id  text not null,
  subject_id       text,
  privilege        text not null,
  amount           bigint not null check (amount > 0),
  reason           text not null check (length(btrim(reason)) > 0),
  starts_at        timestamptz,
  expires_at       timestamptz,
  revoked_at       timestamptz,
  created_by       text not null,
  created_at       timestamptz not null,
  check (starts_at is null or expires_at is null or starts_at < expires_at)
);
create index if not exists oe_grant_org_privilege on oe_grant (organization_id, privilege);

-- Durable audit trail, written in the same transaction as the mutation (spec Requirement 6.3.5).
create table if not exists oe_audit (
  id         bigserial primary key,
  at         timestamptz not null,
  actor      text not null,
  reason     text not null,
  entity     text not null,
  entity_id  text not null,
  action     text not null,
  before     jsonb,
  after      jsonb
);
create index if not exists oe_audit_entity on oe_audit (entity, entity_id, at);
