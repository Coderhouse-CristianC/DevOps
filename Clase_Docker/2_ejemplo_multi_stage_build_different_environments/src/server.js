const express = require("express");

const app = express();
const PORT = process.env.PORT || 3000;

app.get("/", (req, res) => {
  res.json({
    environment: process.env.NODE_ENV || "unknown",
    timestamp: new Date().toISOString(),
  });
});

app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

app.listen(PORT, () => {
  console.log(
    `Server running in ${process.env.NODE_ENV || "unknown"} mode on port ${PORT}`
  );
});
