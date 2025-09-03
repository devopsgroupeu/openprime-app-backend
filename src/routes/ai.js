// src/routes/ai.js
const express = require("express");
const { chat } = require("../controllers/aiController");
const router = express.Router();

router.post("/chat", chat);

module.exports = router;
