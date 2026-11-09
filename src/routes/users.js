const express = require("express");
const { body } = require("express-validator");
const userController = require("../controllers/userController");
const { authenticateToken, requireRole } = require("../middleware/auth");
const { rejectInvalid } = require("../middleware/validate");

const router = express.Router();

router.get("/me", authenticateToken, userController.getCurrentUser);

router.put(
  "/me/profile",
  authenticateToken,
  // The settings page always sends all three fields, as "" when the user has
  // none, so an empty value must keep passing; only real values are checked.
  [
    body("firstName").optional({ values: "falsy" }).isString().isLength({ max: 100 }).trim(),
    body("lastName").optional({ values: "falsy" }).isString().isLength({ max: 100 }).trim(),
    body("email").optional({ values: "falsy" }).isEmail().normalizeEmail(),
  ],
  rejectInvalid,
  userController.updateProfile,
);

router.get("/me/preferences", authenticateToken, userController.getPreferences);

router.put(
  "/me/preferences",
  authenticateToken,
  // The only fields stored: the controller keeps what these validators matched.
  [
    body("theme").optional().isIn(["light", "dark"]),
    body("notifications").optional().isBoolean(),
    // "on-premise" is what the settings page's select sends; everything else
    // in the API spells it "onpremise".
    body("defaultProvider").optional().isIn(["aws", "azure", "gcp", "onpremise", "on-premise"]),
    body("defaultRegion").optional().isString().trim(),
    body("gitIntegration.platform").optional().isString().trim().isLength({ max: 50 }),
    body("gitIntegration.orgUrl").optional().isString().trim().isLength({ max: 2048 }),
  ],
  userController.updatePreferences,
);

router.get("/", authenticateToken, requireRole("admin"), userController.getAllUsers);

router.put(
  "/:userId/deactivate",
  authenticateToken,
  requireRole("admin"),
  userController.deactivateUser,
);

module.exports = router;
