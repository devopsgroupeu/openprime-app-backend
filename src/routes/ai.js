// src/routes/ai.js
const express = require("express");
const { chat } = require("../controllers/aiController");
const { authenticateToken } = require("../middleware/auth");
const router = express.Router();

router.post("/chat", authenticateToken, chat);

module.exports = router;
