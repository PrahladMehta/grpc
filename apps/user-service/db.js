import pg from "pg";

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set. Add it to user-service/.env (see .env.example).");
  process.exit(1);
}

export const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

export const SCHEMA = `
  CREATE TABLE IF NOT EXISTS users (
    id            SERIAL PRIMARY KEY,
    name          TEXT NOT NULL,
    email         TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    age           INTEGER,
    city          TEXT,
    plan          TEXT NOT NULL DEFAULT 'free',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  CREATE TABLE IF NOT EXISTS orders (
    id         SERIAL PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    item       TEXT NOT NULL,
    amount     NUMERIC(10, 2) NOT NULL,
    status     TEXT NOT NULL DEFAULT 'pending',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  CREATE INDEX IF NOT EXISTS orders_user_id_idx ON orders(user_id);
`;

// Maps DB rows to the proto User shape. Never includes password_hash.
function toUser(row, orders = []) {
  return {
    id: String(row.id),
    name: row.name,
    email: row.email,
    age: row.age ?? 0,
    city: row.city ?? "",
    plan: row.plan,
    orders: orders.map((o) => ({
      id: String(o.id),
      item: o.item,
      amount: Number(o.amount),
      status: o.status,
      created_at: o.created_at.toISOString(),
    })),
  };
}

export async function createUser({ name, email, passwordHash, age, city }) {
  const { rows } = await pool.query(
    `INSERT INTO users (name, email, password_hash, age, city)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [name, email, passwordHash, age || null, city || null],
  );
  return toUser(rows[0]);
}

// Returns the raw row (with password_hash) for login checks only.
export async function findUserRowByEmail(email) {
  const { rows } = await pool.query("SELECT * FROM users WHERE email = $1", [email]);
  return rows[0] ?? null;
}

export async function getUserWithOrders(id) {
  const { rows } = await pool.query("SELECT * FROM users WHERE id = $1", [id]);
  if (!rows[0]) return null;
  const orders = await pool.query(
    "SELECT * FROM orders WHERE user_id = $1 ORDER BY created_at DESC",
    [id],
  );
  return toUser(rows[0], orders.rows);
}

export { toUser };
