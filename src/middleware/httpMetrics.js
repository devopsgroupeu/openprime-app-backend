// src/middleware/httpMetrics.js
const { httpRequestsTotal, httpRequestDurationSeconds } = require("../utils/metrics");

// Probe traffic (liveness every 10s, readiness every 5s, per pod) would
// dominate the request rate and hide real user traffic, so it is not counted.
const EXCLUDED_PATHS = new Set(["/health", "/ready"]);

/**
 * Record RED metrics (rate, errors, duration) for every request.
 *
 * The route label is the matched route PATTERN (/api/environments/:id), never
 * the raw path, so ids in URLs cannot explode metric cardinality. Requests no
 * route matched (404s, CORS preflights, rate-limited requests) share the
 * single label "unmatched". A request the client abandons before the response
 * completes (a closed AI chat stream, a load balancer timeout) is recorded
 * with status 499, so the slowest requests do not vanish from the metrics.
 *
 * Express assigns req.route when a route matches, but restores req.baseUrl as
 * the request leaves each router, so once a next(err) reaches the app-level
 * error handler, baseUrl + route.path has lost its mount prefix. The setter
 * below captures the full pattern at match time instead.
 *
 * req.baseUrl is the client's own text for the mount path, and Express matches
 * mounts case-insensitively, so /API/Environments/x reaches the same route as
 * /api/environments/x. It is lowercased (every mount path is a lowercase
 * literal) so an unauthenticated client cannot mint new label values by
 * varying case. Mount paths must stay literals: a parameter in one would put
 * the client's value into the label.
 */
function httpMetrics(req, res, next) {
  if (EXCLUDED_PATHS.has(req.path)) return next();

  const endTimer = httpRequestDurationSeconds.startTimer();
  let matchedRoute;
  let routeLabel = "unmatched";

  Object.defineProperty(req, "route", {
    configurable: true,
    enumerable: true,
    get: () => matchedRoute,
    set: (route) => {
      matchedRoute = route;
      if (!route) return;
      const path = String(route.path);
      const base = req.baseUrl.toLowerCase();
      routeLabel = path === "/" && base ? base : `${base}${path}`;
    },
  });

  // "close" fires after "finish" for a completed response, and on its own when
  // the connection drops first.
  res.once("close", () => {
    const statusCode = res.writableFinished ? String(res.statusCode) : "499";
    const labels = { method: req.method, route: routeLabel, status_code: statusCode };
    httpRequestsTotal.inc(labels);
    endTimer(labels);
  });

  next();
}

module.exports = { httpMetrics };
