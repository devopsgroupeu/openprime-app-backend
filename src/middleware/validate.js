const { validationResult } = require("express-validator");

// Placed after a route's express-validator chain: answers 400 with the same
// `{ errors: [...] }` body the environment routes use. Without it the chain
// only records its result and the handler runs on invalid input (OP-271).
function rejectInvalid(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  return next();
}

module.exports = { rejectInvalid };
