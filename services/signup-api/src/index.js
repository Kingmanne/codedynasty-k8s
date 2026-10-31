// signup-api: validates a signup, hashes the password, and queues it on SQS.
// Replaces the signup-producer Lambda. Returns 202 straight away; the
// signup-worker writes the user to PostgreSQL later.

const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const { SQSClient, SendMessageCommand } = require("@aws-sdk/client-sqs");

const PORT = Number(process.env.PORT || 3000);
const QUEUE_URL = process.env.SQS_QUEUE_URL;
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || "http://localhost:5173";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

if (!QUEUE_URL) {
  console.error(JSON.stringify({ level: "error", msg: "SQS_QUEUE_URL is not set" }));
  process.exit(1);
}

// Region and credentials come from the environment / the EC2 node's IAM role
const sqs = new SQSClient({});
const app = express();
app.use(cors({ origin: ALLOWED_ORIGIN }));
app.use(express.json({ limit: "10kb" }));

// Liveness and readiness: this service has no database, so both are simple
app.get("/health", (req, res) => res.json({ status: "ok" }));
app.get("/ready", (req, res) => res.json({ status: "ready" }));

app.post("/signup", async (req, res) => {
  const { email, password } = req.body || {};

  if (typeof email !== "string" || !EMAIL_RE.test(email)) {
    return res.status(400).json({ message: "A valid email is required." });
  }
  if (typeof password !== "string" || password.length < 8) {
    return res.status(400).json({ message: "Password must be at least 8 characters." });
  }

  try {
    // Hash here, so the plain-text password never sits in the queue
    const passwordHash = await bcrypt.hash(password, 10);

    await sqs.send(
      new SendMessageCommand({
        QueueUrl: QUEUE_URL,
        MessageBody: JSON.stringify({
          email: email.toLowerCase(),
          passwordHash,
          requestedAt: new Date().toISOString(),
        }),
      })
    );

    console.log(JSON.stringify({ level: "info", msg: "signup queued", email: email.toLowerCase() }));
    return res.status(202).json({ message: "Signup request received and is being processed." });
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
  server.close(() => process.exit(0));
});
