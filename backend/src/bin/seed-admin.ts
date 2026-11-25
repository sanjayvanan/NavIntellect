import { hashPassword } from '../api/auth/password.js';
import { config } from '../config.js';
import { pool } from '../db/pool.js';

const email = process.argv[2] ?? config.ADMIN_EMAIL;
const password = process.argv[3] ?? config.ADMIN_PASSWORD;
if (!email || !password) {
  console.error('usage: npm run seed:admin -- <email> <password>   (or set ADMIN_EMAIL / ADMIN_PASSWORD)');
  process.exit(1);
}
if (password.length < 10) {
  console.error('password must be at least 10 characters');
  process.exit(1);
}
await pool.query(
  `INSERT INTO users (email, password_hash, role) VALUES ($1, $2, 'admin')
   ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash, role = 'admin', disabled = false, updated_at = now()`,
  [email, await hashPassword(password)],
);
console.log(`admin user ready: ${email}`);
await pool.end();
