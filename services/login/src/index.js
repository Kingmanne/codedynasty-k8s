// login: checks an email and password against PostgreSQL.
// Replaces the login Lambda.

const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
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
app.use(express.json({ limit: "10kb" }));

// Liveness: is the process alive?
app.get("/health", (req, res) => res.json({ status: "ok" }));

// Readiness: can it reach the database? If not, Kubernetes stops sending traffic.
app.get("/ready", async (req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ status: "ready" });
  } catch {
    res.status(503).json({ status: "database unavailable" });
  }
});

app.post("/login", async (req, res) => {
  const { email, password } = req.body || {};
  if (typeof email !== "string" || typeof password !== "string") {
    return res.status(400).json({ message: "Email and password are required." });
  }

  try {
    const { rows } = await pool.query("SELECT password_hash FROM users WHERE email = $1", [
      email.toLowerCase(),
    ]);

    // Same message whether the email or the password is wrong, so attackers
    // can't use this endpoint to discover which emails are registered
    const valid = rows.length === 1 && (await bcrypt.compare(password, rows[0].password_hash));
    if (!valid) {
      return res.status(401).json({ message: "Invalid email or password." });
    }

    return res.status(200).json({ message: "Login successful.", email: email.toLowerCase() });
  } catch (err) {
    console.error(JSON.stringify({ level: "error", msg: "login failed", error: err.message }));
    return res.status(500).json({ message: "Could not process login. Please try again." });
  }
});

const server = app.listen(PORT, () => {
  console.log(JSON.stringify({ level: "info", msg: `login listening on ${PORT}` }));
});

process.on("SIGTERM", () => {
  console.log(JSON.stringify({ level: "info", msg: "SIGTERM received, shutting down" }));
  server.close(async () => {
    await pool.end();
    process.exit(0);
  });
});
