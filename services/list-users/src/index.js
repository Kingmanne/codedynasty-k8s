// list-users: returns all registered users (without password hashes) to
// logged-in users, plus the app's feature flags.
// Replaces the list-users Lambda (a SQL SELECT replaces the DynamoDB Scan)
// and AWS AppConfig (flags now come from a Kubernetes ConfigMap).

const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const { Pool } = require("pg");

const PORT = Number(process.env.PORT || 3000);
const JWT_SECRET = process.env.JWT_SECRET;
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || "http://localhost:5173";

if (!JWT_SECRET) {
  console.error(JSON.stringify({ level: "error", msg: "JWT_SECRET is not set" }));
  process.exit(1);
}

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

// Feature flags, read by the frontend every 30 seconds.
// Change them in k8s/config.yaml and re-apply: no rebuild needed.
app.get("/config", (req, res) => {
  res.json({
    maintenance_mode: process.env.FEATURE_MAINTENANCE_MODE === "true",
    show_new_banner: process.env.FEATURE_SHOW_NEW_BANNER === "true",
  });
});

// Only logged-in users may see the member list
function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) {
    return res.status(401).json({ message: "Please sign in." });
  }
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    return next();
  } catch {
    return res.status(401).json({ message: "Your session has expired. Please sign in again." });
  }
}

app.get("/users", requireAuth, async (req, res) => {
  try {
    // Only select the columns we return: the password hash never leaves the database
    const { rows } = await pool.query(
      `SELECT email, COALESCE(name, split_part(email, '@', 1)) AS name, created_at
       FROM users ORDER BY created_at DESC LIMIT 1000`
    );
    return res.json({
      users: rows.map((r) => ({ name: r.name, email: r.email, createdAt: r.created_at.toISOString() })),
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
