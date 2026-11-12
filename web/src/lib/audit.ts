import { query } from "./db";

export async function auditLog(params: {
  userId?: string | null;
  action: string;
  entityType?: string;
  entityId?: string;
  details?: any;
  ip?: string | null;
}) {
  try {
    await query(
      "INSERT INTO audit_log (id, user_id, action, entity_type, entity_id, details, ip, created_at) VALUES (?,?,?,?,?,?,?,NOW())",
      [crypto.randomUUID(), params.userId ?? null, params.action, params.entityType ?? null, params.entityId ?? null, params.details ? JSON.stringify(params.details) : null, params.ip ?? null],
    );
  } catch {
    // audit must never block the main action
  }
}
