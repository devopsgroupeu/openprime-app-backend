// src/routes/index.js
const express = require("express");
const router = express.Router();

const environmentRoutes = require("./environments");
const userRoutes = require("./users");
const aiRoutes = require("./ai");
const cloudCredentialsRoutes = require("./cloudCredentials");
const jobRoutes = require("./jobs");
const catalogRoutes = require("./catalog");

// Mount path -> router. Exported so the HTTP metrics can create every route's
// series at startup (createRouteSeries in src/middleware/httpMetrics.js); a
// router mounted here is covered without further changes. Mount paths must
// stay lowercase literals (see the httpMetrics middleware).
const mounts = {
  "/ai": aiRoutes,
  "/environments": environmentRoutes,
  "/users": userRoutes,
  "/cloud-credentials": cloudCredentialsRoutes,
  "/jobs": jobRoutes,
  "/catalog": catalogRoutes,
};

for (const [path, mounted] of Object.entries(mounts)) {
  router.use(path, mounted);
}

module.exports = router;
module.exports.mounts = mounts;
