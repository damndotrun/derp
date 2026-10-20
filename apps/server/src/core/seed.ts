import { sql } from 'drizzle-orm';
import type { Role } from '@derp/shared';
import type { Db } from './db.ts';

export interface SeedUser {
  email: string;
  name: string;
  role: Role;
}

// Az 1. munkacsomagban egy admin; Iroda Ildi és Terepes Tamás a 2b.-ben jön.
export const E2E_USERS: SeedUser[] = [{ email: 'admin@derp.test', name: 'Admin Ádám', role: 'admin' }];

/** A mag tesztfelhasználói; többszöri futtatásra is ugyanaz az állapot. */
export async function seedE2E(db: Db): Promise<void> {
  for (const u of E2E_USERS) {
    // A users_email_key kifejezés-index (lower(email)), ezért nyers ON CONFLICT.
    await db.execute(sql`
      INSERT INTO users (email, name, role) VALUES (${u.email}, ${u.name}, ${u.role})
      ON CONFLICT ((lower(email))) DO UPDATE SET name = EXCLUDED.name, role = EXCLUDED.role`);
  }
}
