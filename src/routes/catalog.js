// src/routes/catalog.js
const express = require("express");
const router = express.Router();
const catalogController = require("../controllers/catalogController");
const { authenticateToken } = require("../middleware/auth");

router.get("/", authenticateToken, catalogController.getCatalog);

module.exports = router;
