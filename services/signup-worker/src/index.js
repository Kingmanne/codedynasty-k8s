// signup-worker: reads signup messages from SQS and saves users to PostgreSQL.
// Replaces the signup-worker Lambda. Instead of an SQS trigger, it long-polls
// the queue itself. A message is only deleted after the user is saved, so a
// failure leaves it in the queue to retry; after 3 attempts SQS moves it to the DLQ.

const http = require("http");
const { Pool } = require("pg");
const {
  SQSClient,
  ReceiveMessageCommand,
  DeleteMessageCommand,
} = require("@aws-sdk/client-sqs");

const QUEUE_URL = process.env.SQS_QUEUE_URL;
const HEALTH_PORT = Number(process.env.HEALTH_PORT || 8080);

if (!QUEUE_URL) {
  console.error(JSON.stringify({ level: "error", msg: "SQS_QUEUE_URL is not set" }));
  process.exit(1);
}

const sqs = new SQSClient({});
const pool = new Pool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 5432),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  max: 2,
});

let running = true;
let lastPoll = Date.now();

async function handleMessage(message) {
  const body = JSON.parse(message.Body);
  if (!body.email || !body.passwordHash) {
    throw new Error("message is missing email or passwordHash");
  }

  // ON CONFLICT: signing up twice with the same email is not an error
  const result = await pool.query(
    `INSERT INTO users (email, name, password_hash, created_at)
     VALUES ($1, $2, $3, COALESCE($4::timestamptz, now()))
     ON CONFLICT (email) DO NOTHING`,
    [body.email, body.name || null, body.passwordHash, body.requestedAt || null]
  );

  console.log(
    JSON.stringify({
      level: "info",
      msg: result.rowCount === 1 ? "user created" : "user already exists, skipped",
      email: body.email,
    })
  );
}

async function pollLoop() {
  while (running) {
    try {
      lastPoll = Date.now();
      const { Messages = [] } = await sqs.send(
        new ReceiveMessageCommand({
          QueueUrl: QUEUE_URL,
          MaxNumberOfMessages: 1, // same as the Lambda's batch size of 1
          WaitTimeSeconds: 20, // long polling: wait for messages instead of hammering SQS
        })
      );

      for (const message of Messages) {
        try {
          await handleMessage(message);
          await sqs.send(
            new DeleteMessageCommand({ QueueUrl: QUEUE_URL, ReceiptHandle: message.ReceiptHandle })
          );
        } catch (err) {
          // Not deleted: it becomes visible again after the visibility timeout and is retried
          console.error(
            JSON.stringify({ level: "error", msg: "failed to process message", id: message.MessageId, error: err.message })
          );
        }
      }
    } catch (err) {
      console.error(JSON.stringify({ level: "error", msg: "error polling SQS", error: err.message }));
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
}

// Small health endpoint for Kubernetes probes.
// /health fails if the poll loop has been stuck for over 2 minutes.
const healthServer = http.createServer(async (req, res) => {
  if (req.url === "/health") {
    const healthy = Date.now() - lastPoll < 120000;
    res.writeHead(healthy ? 200 : 503, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ status: healthy ? "ok" : "stuck" }));
  }
  if (req.url === "/ready") {
    try {
      await pool.query("SELECT 1");
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ status: "ready" }));
    } catch {
      res.writeHead(503, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ status: "database unavailable" }));
    }
  }
  res.writeHead(404);
  res.end();
});

// Bring the table up to date before processing anything.
// Safe to run every start: each statement does nothing if already applied.
async function migrate() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      email         TEXT PRIMARY KEY,
      password_hash TEXT        NOT NULL,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
  await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS name TEXT"); // v0.2.0
}

async function start() {
  for (let attempt = 1; ; attempt++) {
    try {
      await migrate();
      console.log(JSON.stringify({ level: "info", msg: "database schema up to date" }));
      break;
    } catch (err) {
      // PostgreSQL may still be starting: wait and retry
      console.error(JSON.stringify({ level: "warn", msg: "migration failed, retrying", attempt, error: err.message }));
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
  pollLoop();
}

healthServer.listen(HEALTH_PORT, () => {
  console.log(JSON.stringify({ level: "info", msg: `signup-worker started, health on ${HEALTH_PORT}` }));
  start();
});

// Finish the current message, then stop
process.on("SIGTERM", async () => {
  console.log(JSON.stringify({ level: "info", msg: "SIGTERM received, finishing current poll" }));
  running = false;
  healthServer.close();
  setTimeout(async () => {
    await pool.end();
    process.exit(0);
  }, 21000); // a long poll can take up to 20 seconds
});
