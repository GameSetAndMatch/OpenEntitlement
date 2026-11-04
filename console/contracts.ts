/** Service-side agreement evidence. Does not participate in SDK entitlement resolution. */
export interface ContractDocument {
  id: string;
  filename: string;
  size: number;
  sha256: string;
  uploadedAt: string;
}
export interface ContractEvidence {
  kind: "override" | "grant";
  entityId: string;
  documentId?: string;
  page?: number;
  note: string;
}
export interface Contract {
  id: string;
  organizationId: string;
  title: string;
  reference: string;
  status: "draft" | "active" | "expired" | "terminated";
  startsAt?: string;
  endsAt?: string;
  externalReferences: Array<{ system: string; reference: string }>;
  documents: ContractDocument[];
  evidence: ContractEvidence[];
  history: Array<{ at: string; actor: string; reason: string; action: string }>;
}
