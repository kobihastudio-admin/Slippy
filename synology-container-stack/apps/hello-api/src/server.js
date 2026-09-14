import express from "express";

const app = express();
const port = Number(process.env.PORT || 3001);

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "slippy-hello-api",
    env: process.env.APP_ENV || "development",
    supabaseUrl: process.env.SUPABASE_PUBLIC_URL || null,
  });
});

app.get("/", (_req, res) => {
  res.json({ name: "Slippy API", status: "running" });
});

app.listen(port, "0.0.0.0", () => {
  console.log(`Slippy API listening on ${port}`);
});

