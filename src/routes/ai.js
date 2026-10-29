// src/routes/ai.js
const express = require("express");
const rateLimit = require("express-rate-limit");
const { chat } = require("../controllers/aiController");
const { authenticateToken } = require("../middleware/auth");
const router = express.Router();

// Every chat request is billed by Bedrock, so on top of the general per-IP
// limit each user gets a budget of their own: per minute against bursts and
// scripts, per day as a cost ceiling. The store is in memory, so the budget
// is per pod: with N replicas a user can reach up to N times these numbers.
const perUserLimit = (windowMs, max) =>
  rateLimit({
    windowMs,
    max,
    keyGenerator: (req) => req.user.id,
    message: { error: "AI assistant request limit reached, please try again later." },
  });

const aiChatLimits = [
  perUserLimit(60 * 1000, parseInt(process.env.AI_CHAT_MAX_PER_MINUTE || "20", 10)),
  perUserLimit(24 * 60 * 60 * 1000, parseInt(process.env.AI_CHAT_MAX_PER_DAY || "400", 10)),
];

router.post("/chat", authenticateToken, aiChatLimits, chat);

module.exports = router;
