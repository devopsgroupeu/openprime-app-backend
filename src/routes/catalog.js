// src/routes/catalog.js
const express = require("express");
const router = express.Router();
const catalogController = require("../controllers/catalogController");
const { authenticateToken } = require("../middleware/auth");

router.get("/", authenticateToken, catalogController.getCatalog);

// Status codes each route answers, besides the ones every authenticated route
// can (see src/routes/environments.js). 502 when Injecto cannot be reached.
router.statusCodes = {
  "GET /": [200, 502],
};

module.exports = router;
