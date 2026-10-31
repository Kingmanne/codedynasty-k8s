// list-users: returns all registered users, without password hashes.
// Replaces the list-users Lambda. A SQL SELECT replaces the DynamoDB Scan.

const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");

const PORT = Number(process.env.PORT || 3000);
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || "http://localhost:5173";

const pool = new Pool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 5432),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  max: 5,
});

const app = express();
app.use(cors({ origin: ALLOWED_ORIGIN }));

app.get("/health", (req, res) => res.json({ status: "ok" }));

app.get("/ready", async (req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ status: "ready" });
  } catch {
    res.status(503).json({ status: "database unavailable" });
  }
});

app.get("/users", async (req, res) => {
  try {
    // Only select the columns we return: the password hash never leaves the database
    const { rows } = await pool.query(
      "SELECT email, created_at FROM users ORDER BY created_at DESC LIMIT 1000"
    );
    return res.json({
      users: rows.map((r) => ({ email: r.email, createdAt: r.created_at.toISOString() })),
    });
  } catch (err) {
    console.error(JSON.stringify({ level: "error", msg: "list users failed", error: err.message }));
    return res.status(500).json({ message: "Could not list users." });
  }
});

const server = app.listen(PORT, () => {
  console.log(JSON.stringify({ level: "info", msg: `list-users listening on ${PORT}` }));
});

process.on("SIGTERM", () => {
  console.log(JSON.stringify({ level: "info", msg: "SIGTERM received, shutting down" }));
  server.close(async () => {
    await pool.end();
    process.exit(0);
  });
});
