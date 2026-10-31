// signup-api: validates a signup, hashes the password, and queues it on SQS.
// Replaces the signup-producer Lambda. Returns 202 with a login token straight
// away, so the frontend can open the dashboard; the signup-worker writes the
// user to PostgreSQL a moment later.

const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { Pool } = require("pg");
const { SQSClient, SendMessageCommand } = require("@aws-sdk/client-sqs");

const PORT = Number(process.env.PORT || 3000);
const QUEUE_URL = process.env.SQS_QUEUE_URL;
const JWT_SECRET = process.env.JWT_SECRET;
const TOKEN_TTL = process.env.TOKEN_TTL || "12h";
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || "http://localhost:5173";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

for (const [name, value] of Object.entries({ SQS_QUEUE_URL: QUEUE_URL, JWT_SECRET })) {
  if (!value) {
    console.error(JSON.stringify({ level: "error", msg: `${name} is not set` }));
    process.exit(1);
  }
}

// Region and credentials come from the environment / the EC2 node's IAM role
const sqs = new SQSClient({});
const pool = new Pool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 5432),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  max: 3,
});

const app = express();
app.use(cors({ origin: ALLOWED_ORIGIN }));
app.use(express.json({ limit: "10kb" }));

// Liveness: is the process alive?
app.get("/health", (req, res) => res.json({ status: "ok" }));

// Readiness: can it reach the database (used for the duplicate-email check)?
app.get("/ready", async (req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ status: "ready" });
  } catch {
    res.status(503).json({ status: "database unavailable" });
  }
});

app.post("/signup", async (req, res) => {
  const { name, email, password } = req.body || {};

  if (typeof name !== "string" || name.trim().length < 1 || name.length > 100) {
    return res.status(400).json({ message: "Please enter your name." });
  }
  if (typeof email !== "string" || !EMAIL_RE.test(email)) {
    return res.status(400).json({ message: "A valid email is required." });
  }
  if (typeof password !== "string" || password.length < 8) {
    return res.status(400).json({ message: "Password must be at least 8 characters." });
  }

  const cleanName = name.trim();
  const cleanEmail = email.trim().toLowerCase();

  try {
    // Catch the common duplicate case early. The worker's ON CONFLICT is the final guard.
    const existing = await pool.query("SELECT 1 FROM users WHERE email = $1", [cleanEmail]);
    if (existing.rowCount > 0) {
      return res.status(409).json({ message: "An account with this email already exists." });
    }

    // Hash here, so the plain-text password never sits in the queue
    const passwordHash = await bcrypt.hash(password, 10);

    await sqs.send(
      new SendMessageCommand({
        QueueUrl: QUEUE_URL,
        MessageBody: JSON.stringify({
          name: cleanName,
          email: cleanEmail,
          passwordHash,
          requestedAt: new Date().toISOString(),
        }),
      })
    );

    const user = { name: cleanName, email: cleanEmail };
    const token = jwt.sign(user, JWT_SECRET, { subject: cleanEmail, expiresIn: TOKEN_TTL });

    console.log(JSON.stringify({ level: "info", msg: "signup queued", email: cleanEmail }));
    return res.status(202).json({
      message: "Signup request received and is being processed.",
      user,
      token,
    });
  } catch (err) {
    console.error(JSON.stringify({ level: "error", msg: "failed to queue signup", error: err.message }));
    return res.status(500).json({ message: "Could not process signup. Please try again." });
  }
});

const server = app.listen(PORT, () => {
  console.log(JSON.stringify({ level: "info", msg: `signup-api listening on ${PORT}` }));
});

// Kubernetes sends SIGTERM before stopping a Pod: finish in-flight requests first
process.on("SIGTERM", () => {
  console.log(JSON.stringify({ level: "info", msg: "SIGTERM received, shutting down" }));
  server.close(async () => {
    await pool.end();
    process.exit(0);
  });
});
