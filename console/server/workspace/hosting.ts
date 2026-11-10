import { WorkspaceError, type WorkspaceData } from "./model.ts";
export type DeploymentMode = "self_hosted" | "saas";
export type HostedTier = "pro" | "enterprise";
export function deploymentMode(env: NodeJS.ProcessEnv): DeploymentMode {
  const mode = env.OE_DEPLOYMENT_MODE ?? "self_hosted";
  if (mode !== "self_hosted" && mode !== "saas")
    throw new Error("OE_DEPLOYMENT_MODE must be self_hosted or saas");
  return mode;
}
export function hosting(data: WorkspaceData, mode: DeploymentMode) {
  return {
    mode,
    tier: data.hostedTier ?? "pro",
    subjectEntitlements:
      mode === "self_hosted" || data.hostedTier === "enterprise",
  };
}
export function requireSubjectEntitlements(
  data: WorkspaceData,
  mode: DeploymentMode,
) {
  if (!hosting(data, mode).subjectEntitlements)
    throw new WorkspaceError(
      "User entitlements require Cloud Enterprise. Organization entitlements remain available on Pro.",
      403,
    );
}
