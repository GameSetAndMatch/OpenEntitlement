import type { Pool } from "pg";
import type { Contract } from "../contracts.ts";
import { HttpError } from "./http.ts";

/** Metadata and PDFs share the database transaction. Demo storage shares the process lifetime. */
export class ContractStore {
  private records = new Map<string, Contract>();
  private documents = new Map<string, Buffer>();
  private pool?: Pool;
  constructor(pool?: Pool) { this.pool = pool; }
  async initialize() {
    if (!this.pool) return;
    const tx = await this.pool.connect();
    try {
      await tx.query("BEGIN");
      await tx.query("SELECT pg_advisory_xact_lock(hashtext('oe_console_contracts_schema'))");
      await tx.query(`
      CREATE TABLE IF NOT EXISTS oe_console_contracts (
        id uuid PRIMARY KEY, organization_id text NOT NULL, data jsonb NOT NULL
      );
      CREATE INDEX IF NOT EXISTS oe_console_contracts_org ON oe_console_contracts(organization_id);
      CREATE TABLE IF NOT EXISTS oe_console_contract_documents (
        id uuid PRIMARY KEY, contract_id uuid NOT NULL REFERENCES oe_console_contracts(id), content bytea NOT NULL
      );`);
      await tx.query("COMMIT");
    } catch (error) { await tx.query("ROLLBACK"); throw error; }
    finally { tx.release(); }
  }
  async list(org: string): Promise<Contract[]> {
    if (!this.pool) return structuredClone([...this.records.values()].filter(c => c.organizationId === org));
    return (await this.pool.query("SELECT data FROM oe_console_contracts WHERE organization_id=$1 ORDER BY id", [org])).rows.map(r => r.data);
  }
  async get(id: string): Promise<Contract> {
    const value = this.pool ? (await this.pool.query("SELECT data FROM oe_console_contracts WHERE id=$1", [id])).rows[0]?.data : this.records.get(id);
    if (!value) throw new HttpError(404, "NOT_FOUND", "contract not found");
    return structuredClone(value);
  }
  async create(contract: Contract) {
    if (this.pool) await this.pool.query("INSERT INTO oe_console_contracts(id,organization_id,data) VALUES($1,$2,$3)", [contract.id, contract.organizationId, contract]);
    else this.records.set(contract.id, structuredClone(contract));
    return contract;
  }
  async change(id: string, change: (c: Contract) => void, document?: { id: string; content: Buffer }): Promise<Contract> {
    if (!this.pool) {
      const c = this.records.get(id);
      if (!c) throw new HttpError(404, "NOT_FOUND", "contract not found");
      const copy = structuredClone(c);
      change(copy);
      this.records.set(id, copy);
      if (document) this.documents.set(document.id, Buffer.from(document.content));
      return structuredClone(copy);
    }
    const tx = await this.pool.connect();
    try {
      await tx.query("BEGIN");
      const c = (await tx.query("SELECT data FROM oe_console_contracts WHERE id=$1 FOR UPDATE", [id])).rows[0]?.data as Contract | undefined;
      if (!c) throw new HttpError(404, "NOT_FOUND", "contract not found");
      change(c);
      if (document) await tx.query("INSERT INTO oe_console_contract_documents(id,contract_id,content) VALUES($1,$2,$3)", [document.id, id, document.content]);
      await tx.query("UPDATE oe_console_contracts SET data=$2 WHERE id=$1", [id, c]);
      await tx.query("COMMIT");
      return c;
    } catch (error) { await tx.query("ROLLBACK"); throw error; }
    finally { tx.release(); }
  }
  async document(contractId: string, id: string): Promise<{ content: Buffer; filename: string }> {
    const contract = await this.get(contractId);
    const doc = contract.documents.find(d => d.id === id);
    if (!doc) throw new HttpError(404, "NOT_FOUND", "document not found in this contract");
    const content = this.pool ? (await this.pool.query("SELECT content FROM oe_console_contract_documents WHERE id=$1 AND contract_id=$2", [id, contractId])).rows[0]?.content : this.documents.get(id);
    if (!content) throw new HttpError(404, "NOT_FOUND", "document not found");
    return { content, filename: doc.filename };
  }
}
