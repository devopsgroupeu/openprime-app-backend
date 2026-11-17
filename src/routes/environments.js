// src/routes/environments.js
const express = require("express");
const router = express.Router();
const environmentController = require("../controllers/environmentController");
const { validateEnvironment } = require("../validators/environmentValidator");
const { authenticateToken } = require("../middleware/auth");

router.get("/", authenticateToken, environmentController.getUserEnvironments);

router.get("/:id", authenticateToken, environmentController.getEnvironment);

router.post("/", authenticateToken, validateEnvironment, environmentController.createEnvironment);

router.put("/:id", authenticateToken, validateEnvironment, environmentController.updateEnvironment);

router.delete("/:id", authenticateToken, environmentController.deleteEnvironment);

router.post("/:id/generate", authenticateToken, environmentController.generateInfrastructure);

router.post("/:id/push", authenticateToken, environmentController.pushInfrastructure);

router.post(
  "/terraform-backend/create",
  authenticateToken,
  environmentController.createTerraformBackend,
);

// Status codes each route answers, besides the ones every route can
// (COMMON_ROUTE_CODES and, for a GET, GET_ROUTE_CODES in
// src/middleware/httpMetrics.js). Their metric series are created at startup
// (createRouteSeries). tests/metrics.test.js fails when a route is missing
// here. Generate and push answer 202 with a job
// (X-Async-Jobs), 200 when run inline, and 409 while another push to the same
// repository holds its lock; inline, both answer 422 when Injecto refuses the
// generated files. terraform-backend passes on StateCraft's 409.
router.statusCodes = {
  "GET /": [200],
  "GET /:id": [200, 404],
  "POST /": [201, 400, 404],
  "PUT /:id": [200, 400, 404],
  "DELETE /:id": [200, 404],
  "POST /:id/generate": [200, 202, 404, 409, 422],
  "POST /:id/push": [200, 202, 400, 404, 409, 422],
  "POST /terraform-backend/create": [201, 400, 404, 409],
};

module.exports = router;
