// One-time setup: creates the database (if missing), the tables, and demo data.
// Run with: npm run db:setup
import pg from "pg";
import bcrypt from "bcryptjs";

const url = new URL(process.env.DATABASE_URL);
const dbName = url.pathname.slice(1);

// 1. Create the database by connecting to the default "postgres" database.
const adminUrl = new URL(url);
adminUrl.pathname = "/postgres";
const admin = new pg.Client({ connectionString: adminUrl.toString() });
await admin.connect();
const exists = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [dbName]);
if (exists.rowCount === 0) {
  await admin.query(`CREATE DATABASE "${dbName.replace(/"/g, '""')}"`);
  console.log(`Created database ${dbName}`);
} else {
  console.log(`Database ${dbName} already exists`);
}
await admin.end();

// 2. Create tables, then seed demo users if the table is empty.
const { pool, SCHEMA } = await import("./db.js");
await pool.query(SCHEMA);
console.log("Tables ready");

const { rows } = await pool.query("SELECT count(*)::int AS n FROM users");
if (rows[0].n === 0) {
  const demo = [
    {
      name: "Aarav Sharma", email: "aarav@example.com", age: 28, city: "Delhi", plan: "pro",
      orders: [
        ["Wireless Mouse", 899, "delivered"],
        ["Mechanical Keyboard", 4599, "shipped"],
      ],
    },
    {
      name: "Priya Patel", email: "priya@example.com", age: 34, city: "Mumbai", plan: "free",
      orders: [["USB-C Hub", 1999, "delivered"]],
    },
    { name: "Rohan Verma", email: "rohan@example.com", age: 41, city: "Bengaluru", plan: "enterprise", orders: [] },
  ];
  const hash = await bcrypt.hash("password123", 10);
  for (const u of demo) {
    const res = await pool.query(
      `INSERT INTO users (name, email, password_hash, age, city, plan)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [u.name, u.email, hash, u.age, u.city, u.plan],
    );
    for (const [item, amount, status] of u.orders) {
      await pool.query(
        "INSERT INTO orders (user_id, item, amount, status) VALUES ($1, $2, $3, $4)",
        [res.rows[0].id, item, amount, status],
      );
    }
  }
  console.log(`Seeded ${demo.length} demo users (password: password123)`);
} else {
  console.log(`Users table already has ${rows[0].n} rows, skipping seed`);
}
await pool.end();
