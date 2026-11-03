/** Evaluation and mutation hooks (spec §7), OpenFeature-style. */

import type { ValueType } from "./catalog.ts";
import type { EvaluationContext, ResolutionDetails } from "./details.ts";
import type { AuditEvent, ProviderMetadata } from "./provider.ts";

/** Requirement 7.1.1. */
export interface HookContext {
  readonly privilege: string;
  readonly valueType: ValueType | undefined;
  readonly feature?: string;
  readonly context: Readonly<EvaluationContext>;
  readonly providerMetadata: ProviderMetadata;
  readonly hookData: Map<string, unknown>;
}

export interface Hook {
  before?(ctx: HookContext): void | Promise<void>;
  after?(ctx: HookContext, details: ResolutionDetails): void | Promise<void>;
  error?(ctx: HookContext, error: unknown): void | Promise<void>;
  finally?(ctx: HookContext, details: ResolutionDetails | undefined): void | Promise<void>;
}

/** Requirement 7.2.1. */
export interface MutationContext {
  readonly operation: string;
  readonly arguments: Readonly<Record<string, unknown>>;
  readonly actor: string;
  readonly reason: string;
  readonly providerMetadata: ProviderMetadata;
}

export interface MutationHook {
  /** Throw to veto the mutation (Requirement 7.2.2). */
  before?(ctx: MutationContext): void | Promise<void>;
  after?(ctx: MutationContext, event: AuditEvent): void | Promise<void>;
  error?(ctx: MutationContext, error: unknown): void | Promise<void>;
  finally?(ctx: MutationContext): void | Promise<void>;
}

/** A ready-made mutation hook that collects audit events in memory (handy in tests). */
export class AuditLog implements MutationHook {
  readonly events: AuditEvent[] = [];
  after(_ctx: MutationContext, event: AuditEvent): void {
    this.events.push(event);
  }
}
