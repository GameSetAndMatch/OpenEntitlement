import { createHash, randomBytes, randomUUID } from "node:crypto";
import pg from "pg";
import {normalizeCatalog} from "./catalog-adapter.ts";
import { emptyData, WorkspaceError, type Action, type Role, type WorkspaceData } from "./model.ts";

export interface Account { id: string; email: string; platformAdmin: boolean }
export interface Session { account: Account; csrf: string }
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
export const token = () => randomBytes(32).toString("base64url");
export class WorkspaceStore {
  pool: pg.Pool;
  constructor(url: string) { this.pool = new pg.Pool({ connectionString: url }); }
  async initialize() {
    const db = await this.pool.connect();
    try {
      await db.query("BEGIN");
      await db.query("SELECT pg_advisory_xact_lock(hashtext('oe_workspace_schema_v1'))");
      await db.query(`
        CREATE TABLE IF NOT EXISTS oe_cp_accounts(id uuid PRIMARY KEY, issuer text NOT NULL, subject text NOT NULL, email text NOT NULL, platform_admin boolean NOT NULL DEFAULT false, UNIQUE(issuer,subject));
        CREATE TABLE IF NOT EXISTS oe_cp_directory(id uuid PRIMARY KEY, name text NOT NULL, created_by uuid NOT NULL REFERENCES oe_cp_accounts(id));
        CREATE TABLE IF NOT EXISTS oe_cp_members(workspace_id uuid NOT NULL REFERENCES oe_cp_directory(id), account_id uuid NOT NULL REFERENCES oe_cp_accounts(id), role text NOT NULL CHECK(role IN ('Owner','Manager','User')), PRIMARY KEY(workspace_id,account_id));
        CREATE TABLE IF NOT EXISTS oe_cp_state(workspace_id uuid PRIMARY KEY REFERENCES oe_cp_directory(id), data jsonb NOT NULL, revision bigint NOT NULL DEFAULT 1);
        ALTER TABLE oe_cp_state ENABLE ROW LEVEL SECURITY;
        ALTER TABLE oe_cp_state FORCE ROW LEVEL SECURITY;
        DROP POLICY IF EXISTS oe_cp_state_isolation ON oe_cp_state;
        CREATE POLICY oe_cp_state_isolation ON oe_cp_state USING (workspace_id::text=current_setting('oe.workspace_id',true)) WITH CHECK (workspace_id::text=current_setting('oe.workspace_id',true));
        CREATE TABLE IF NOT EXISTS oe_cp_audit(id uuid PRIMARY KEY, workspace_id uuid NOT NULL REFERENCES oe_cp_directory(id), actor uuid NOT NULL REFERENCES oe_cp_accounts(id), action text NOT NULL, reason text NOT NULL, before_data jsonb, after_data jsonb, at timestamptz NOT NULL DEFAULT now());
        CREATE INDEX IF NOT EXISTS oe_cp_audit_workspace ON oe_cp_audit(workspace_id,at DESC);
        ALTER TABLE oe_cp_audit ENABLE ROW LEVEL SECURITY;
        ALTER TABLE oe_cp_audit FORCE ROW LEVEL SECURITY;
        DROP POLICY IF EXISTS oe_cp_audit_isolation ON oe_cp_audit;
        CREATE POLICY oe_cp_audit_isolation ON oe_cp_audit USING (workspace_id::text=current_setting('oe.workspace_id',true)) WITH CHECK (workspace_id::text=current_setting('oe.workspace_id',true));
        CREATE TABLE IF NOT EXISTS oe_cp_sessions(hash text PRIMARY KEY, account_id uuid NOT NULL REFERENCES oe_cp_accounts(id), csrf text NOT NULL, expires_at timestamptz NOT NULL);
        CREATE TABLE IF NOT EXISTS oe_cp_flows(hash text PRIMARY KEY, data jsonb NOT NULL, expires_at timestamptz NOT NULL);
        CREATE TABLE IF NOT EXISTS oe_cp_invites(id uuid PRIMARY KEY, workspace_id uuid NOT NULL REFERENCES oe_cp_directory(id), email text NOT NULL, role text NOT NULL CHECK(role IN ('Owner','Manager','User')), hash text UNIQUE NOT NULL, expires_at timestamptz NOT NULL);
        CREATE TABLE IF NOT EXISTS oe_cp_keys(id uuid PRIMARY KEY, workspace_id uuid NOT NULL REFERENCES oe_cp_directory(id), name text NOT NULL, hash text UNIQUE NOT NULL, prefix text NOT NULL, scope text NOT NULL CHECK(scope IN ('evaluate','catalog')), created_by uuid NOT NULL REFERENCES oe_cp_accounts(id), revoked boolean NOT NULL DEFAULT false);
      `);
      const role = (await db.query("SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user")).rows[0];
      if (role.rolsuper || role.rolbypassrls) throw new Error("Workspace service requires a non-superuser PostgreSQL role without BYPASSRLS");
      await db.query("COMMIT");
    } catch (e) { await db.query("ROLLBACK"); throw e; } finally { db.release(); }
  }
  async account(issuer: string, subject: string, email: string, bootstrapAdmin: boolean): Promise<Account> {
    const row = (await this.pool.query(`INSERT INTO oe_cp_accounts(id,issuer,subject,email,platform_admin) VALUES($1,$2,$3,$4,$5)
      ON CONFLICT(issuer,subject) DO UPDATE SET email=excluded.email,platform_admin=oe_cp_accounts.platform_admin OR excluded.platform_admin RETURNING id,email,platform_admin`, [randomUUID(),issuer,subject,email,bootstrapAdmin])).rows[0];
    return { id: row.id, email: row.email, platformAdmin: row.platform_admin };
  }
  async createSession(account: Account) {
    const value = token(), csrf = token();
    await this.pool.query("INSERT INTO oe_cp_sessions(hash,account_id,csrf,expires_at) VALUES($1,$2,$3,now()+interval '12 hours')", [hash(value),account.id,csrf]);
    return value;
  }
  async session(value: string): Promise<Session | undefined> {
    const row = (await this.pool.query("SELECT a.id,a.email,a.platform_admin,s.csrf FROM oe_cp_sessions s JOIN oe_cp_accounts a ON a.id=s.account_id WHERE s.hash=$1 AND s.expires_at>now()",[hash(value)])).rows[0];
    return row ? { account: { id: row.id,email: row.email,platformAdmin: row.platform_admin },csrf: row.csrf } : undefined;
  }
  async logout(value: string) { await this.pool.query("DELETE FROM oe_cp_sessions WHERE hash=$1",[hash(value)]); }
  async saveFlow(value: string, data: unknown) {
    await this.pool.query("DELETE FROM oe_cp_flows WHERE expires_at<now()");
    await this.pool.query("INSERT INTO oe_cp_flows(hash,data,expires_at) VALUES($1,$2,now()+interval '10 minutes')",[hash(value),data]);
  }
  async takeFlow(value: string) { return (await this.pool.query("DELETE FROM oe_cp_flows WHERE hash=$1 AND expires_at>now() RETURNING data",[hash(value)])).rows[0]?.data; }
  async list(account: Account) {
    return (await this.pool.query(`SELECT d.id,d.name,coalesce(m.role,'Platform administrator') AS role FROM oe_cp_directory d LEFT JOIN oe_cp_members m ON m.workspace_id=d.id AND m.account_id=$1 WHERE $2 OR m.account_id IS NOT NULL ORDER BY d.name,d.id`,[account.id,account.platformAdmin])).rows;
  }
  private async transaction<T>(id: string, fn: (db: pg.PoolClient) => Promise<T>) {
    if (!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)) throw new WorkspaceError("Workspace not found",404);
    const db = await this.pool.connect();
    try { await db.query("BEGIN"); await db.query("SELECT set_config('oe.workspace_id',$1,true)",[id]); const value = await fn(db); await db.query("COMMIT"); return value; }
    catch (e) { await db.query("ROLLBACK"); throw e; } finally { db.release(); }
  }
  private async authorize(db: pg.PoolClient, account: Account, id: string, action?: Action) {
    const row = (await db.query("SELECT d.name,m.role FROM oe_cp_directory d LEFT JOIN oe_cp_members m ON m.workspace_id=d.id AND m.account_id=$2 WHERE d.id=$1",[id,account.id])).rows[0];
    if (!row || (!account.platformAdmin && !row.role)) throw new WorkspaceError("Workspace not found",404);
    if (action && !account.platformAdmin && row.role !== "Owner" && !(row.role === "Manager" && action === "members:manage")) throw new WorkspaceError("Your role does not allow this action",403);
    return { name: row.name, role: account.platformAdmin ? "Platform administrator" : row.role };
  }
  async create(account: Account, name: string, reason: string) {
    const id = randomUUID();
    return this.transaction(id, async db => {
      await db.query("INSERT INTO oe_cp_directory(id,name,created_by) VALUES($1,$2,$3)",[id,name,account.id]);
      await db.query("INSERT INTO oe_cp_members(workspace_id,account_id,role) VALUES($1,$2,'Owner')",[id,account.id]);
      const data = emptyData(); await db.query("INSERT INTO oe_cp_state(workspace_id,data) VALUES($1,$2)",[id,data]);
      await this.audit(db,id,account,"workspace:create",reason,null,{ name });
      return { id,name,role: "Owner",data,revision: 1 };
    });
  }
  async read(account: Account, id: string) {
    return this.transaction(id,async db => {
      const meta = await this.authorize(db,account,id);
      const row = (await db.query("SELECT data,revision FROM oe_cp_state WHERE workspace_id=$1",[id])).rows[0];
      return { id,...meta,data: normalizeCatalog(row.data as WorkspaceData),revision: Number(row.revision) };
    });
  }
  async change(account: Account,id: string,action: Action,reason: string,revision: number,change: (d: WorkspaceData) => void) {
    return this.transaction(id,async db => {
      await this.authorize(db,account,id,action);
      const row = (await db.query("SELECT data,revision FROM oe_cp_state WHERE workspace_id=$1 FOR UPDATE",[id])).rows[0];
      if (Number(row.revision) !== revision) throw new WorkspaceError("Workspace changed elsewhere. Refresh before saving.",409);
      const before = structuredClone(row.data); row.data=normalizeCatalog(row.data);change(row.data);
      if (JSON.stringify(row.data).length > 900000) throw new WorkspaceError("Workspace configuration is too large",413);
      await db.query("UPDATE oe_cp_state SET data=$2,revision=revision+1 WHERE workspace_id=$1",[id,row.data]);
      await this.audit(db,id,account,action,reason,before,row.data);
      return { data: row.data,revision: revision+1 };
    });
  }
  private async audit(db: pg.PoolClient,id: string,account: Account,action: string,reason: string,before: unknown,after: unknown) {
    await db.query("INSERT INTO oe_cp_audit(id,workspace_id,actor,action,reason,before_data,after_data) VALUES($1,$2,$3,$4,$5,$6,$7)",[randomUUID(),id,account.id,action,reason,before,after]);
  }
  async history(account: Account,id: string) {
    return this.transaction(id,async db => { await this.authorize(db,account,id); return (await db.query("SELECT id,actor,action,reason,at FROM oe_cp_audit WHERE workspace_id=$1 ORDER BY at DESC LIMIT 100",[id])).rows; });
  }
  async members(account: Account,id: string) {
    return this.transaction(id,async db => { await this.authorize(db,account,id,"members:manage"); return (await db.query("SELECT a.id,a.email,m.role FROM oe_cp_members m JOIN oe_cp_accounts a ON a.id=m.account_id WHERE m.workspace_id=$1 ORDER BY a.email",[id])).rows; });
  }
  async setMember(account: Account,id: string,target: string,role: Role | null,reason: string) {
    return this.transaction(id,async db => {
      const actor = await this.authorize(db,account,id,"members:manage");
      // Serialize membership changes to prevent concurrent removal of the last owner.
      await db.query("SELECT id FROM oe_cp_directory WHERE id=$1 FOR UPDATE",[id]);
      const existing = (await db.query("SELECT role FROM oe_cp_members WHERE workspace_id=$1 AND account_id=$2",[id,target])).rows[0]?.role;
      if (actor.role === "Manager" && (role !== null || existing === "Owner")) throw new WorkspaceError("Only Owners can change Owner membership",403);
      if (existing === "Owner" && role !== "Owner" && Number((await db.query("SELECT count(*) FROM oe_cp_members WHERE workspace_id=$1 AND role='Owner'",[id])).rows[0].count) <= 1) throw new WorkspaceError("A workspace must retain an Owner",409);
      if (!(await db.query("SELECT 1 FROM oe_cp_accounts WHERE id=$1",[target])).rowCount) throw new WorkspaceError("Account not found",404);
      if (role) await db.query("INSERT INTO oe_cp_members(workspace_id,account_id,role) VALUES($1,$2,$3) ON CONFLICT(workspace_id,account_id) DO UPDATE SET role=excluded.role",[id,target,role]);
      else await db.query("DELETE FROM oe_cp_members WHERE workspace_id=$1 AND account_id=$2",[id,target]);
      await this.audit(db,id,account,"members:manage",reason,{ accountId: target,role: existing },{ accountId: target,role });
    });
  }
  async invite(account: Account,id: string,email: string,role: Role,reason: string) {
    return this.transaction(id,async db => {
      const actor=await this.authorize(db,account,id,"members:manage");
      if(actor.role==="Manager" && role==="Owner")throw new WorkspaceError("Only Owners can invite Owners",403);
      const secret=token(),inviteId=randomUUID();
      await db.query("INSERT INTO oe_cp_invites(id,workspace_id,email,role,hash,expires_at) VALUES($1,$2,$3,$4,$5,now()+interval '7 days')",[inviteId,id,email.toLowerCase(),role,hash(secret)]);
      await this.audit(db,id,account,"members:invite",reason,null,{email,role});
      return {id:inviteId,token:secret};
    });
  }
  async acceptInvite(account: Account,secret: string) {
    const db=await this.pool.connect();
    try {
      await db.query("BEGIN");
      const invite=(await db.query("SELECT * FROM oe_cp_invites WHERE hash=$1 AND expires_at>now() FOR UPDATE",[hash(secret)])).rows[0];
      if(!invite || invite.email!==account.email.toLowerCase())throw new WorkspaceError("Invitation is invalid, expired, or belongs to another email",403);
      await db.query("SELECT set_config('oe.workspace_id',$1,true)",[invite.workspace_id]);
      // An invitation must never demote an existing Owner or overwrite a member's role.
      const inserted=await db.query("INSERT INTO oe_cp_members(workspace_id,account_id,role) VALUES($1,$2,$3) ON CONFLICT DO NOTHING RETURNING role",[invite.workspace_id,account.id,invite.role]);
      const membership=inserted.rows[0]??(await db.query("SELECT role FROM oe_cp_members WHERE workspace_id=$1 AND account_id=$2",[invite.workspace_id,account.id])).rows[0];
      await db.query("DELETE FROM oe_cp_invites WHERE id=$1",[invite.id]);
      await this.audit(db,invite.workspace_id,account,"members:join","Accepted email invitation",null,{accountId:account.id});
      await db.query("COMMIT");return {workspaceId:invite.workspace_id,alreadyMember:inserted.rowCount===0,role:membership.role};
    }catch(e){await db.query("ROLLBACK");throw e;}finally{db.release();}
  }
  async keys(account: Account,id: string) {
    return this.transaction(id,async db => { await this.authorize(db,account,id,"api_keys:manage"); return (await db.query("SELECT id,name,prefix,scope,revoked FROM oe_cp_keys WHERE workspace_id=$1",[id])).rows; });
  }
  async createKey(account: Account,id: string,name: string,scope: "evaluate" | "catalog",reason: string) {
    return this.transaction(id,async db => {
      await this.authorize(db,account,id,"api_keys:manage"); const secret = "oe_" + token(), keyId = randomUUID();
      await db.query("INSERT INTO oe_cp_keys(id,workspace_id,name,hash,prefix,scope,created_by) VALUES($1,$2,$3,$4,$5,$6,$7)",[keyId,id,name,hash(secret),secret.slice(0,10),scope,account.id]);
      await this.audit(db,id,account,"api_keys:create",reason,null,{ id: keyId,name,scope }); return { id: keyId,secret };
    });
  }
  async revokeKey(account: Account,id: string,keyId: string,reason: string) {
    return this.transaction(id,async db => { await this.authorize(db,account,id,"api_keys:manage"); const result=await db.query("UPDATE oe_cp_keys SET revoked=true WHERE id=$1 AND workspace_id=$2",[keyId,id]); if(!result.rowCount)throw new WorkspaceError("API key not found",404); await this.audit(db,id,account,"api_keys:revoke",reason,null,{ id: keyId }); });
  }
  async key(value: string) { return (await this.pool.query("SELECT workspace_id,scope,created_by FROM oe_cp_keys WHERE hash=$1 AND NOT revoked",[hash(value)])).rows[0]; }
  async keyData(id:string){return this.transaction(id,async db=>normalizeCatalog((await db.query("SELECT data FROM oe_cp_state WHERE workspace_id=$1",[id])).rows[0].data));}
  async close() { await this.pool.end(); }
}
