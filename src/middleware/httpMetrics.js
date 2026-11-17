// src/middleware/httpMetrics.js
const { httpRequestsTotal, httpRequestDurationSeconds } = require("../utils/metrics");

// Probe traffic (liveness every 10s, readiness every 5s, per pod) would
// dominate the request rate and hide real user traffic, so it is not counted.
const EXCLUDED_PATHS = new Set(["/health", "/ready"]);

// What every route can answer besides its own codes. Every route is
// authenticated: no or bad token (401), deactivated account or missing role
// (403), the per-user budget (429), an unexpected error (500) and Keycloak's
// keys not loaded yet (503); see src/middleware/auth.js and errorHandler.js.
// 499 is recorded below for a request the client abandons.
const COMMON_ROUTE_CODES = [401, 403, 429, 499, 500, 503];

// A GET answers 304 when the browser revalidates with the ETag Express sets.
const GET_ROUTE_CODES = [304];

// The route label for a route `path` matched under the mount path `baseUrl`.
// Shared by the middleware and createRouteSeries so both produce the same
// label. baseUrl is lowercased: see the note on httpMetrics below.
function routeLabel(baseUrl, path) {
  const base = baseUrl.toLowerCase();
  return path === "/" && base ? base : `${base}${path}`;
}

/**
 * Create the request series of every registered route at zero.
 *
 * A labelled series otherwise appears with its first request, already at 1,
 * so increase() and rate() never see that request: with a quiet API and pods
 * replaced every few hours, most requests were a first one. Each route file
 * lists the status codes its routes answer (`statusCodes`, keyed
 * "METHOD /path"); COMMON_ROUTE_CODES are added to every route and
 * GET_ROUTE_CODES to every GET. HEAD requests (Express answers them with the
 * GET handler) are not created: browsers never send them to this API, and
 * they would add about half as many series again.
 *
 * @param {string} prefix - mount path of the API router ("/api")
 * @param {Object<string, import("express").Router>} mounts - mount path -> router
 */
function createRouteSeries(prefix, mounts) {
  for (const [mountPath, router] of Object.entries(mounts)) {
    const codes = router.statusCodes || {};
    for (const { route } of router.stack) {
      if (!route) continue; // middleware, not a route
      for (const method of Object.keys(route.methods)) {
        const METHOD = method.toUpperCase();
        const own = codes[`${METHOD} ${route.path}`] || [200];
        const extra = METHOD === "GET" ? GET_ROUTE_CODES : [];
        for (const statusCode of new Set([...own, ...extra, ...COMMON_ROUTE_CODES])) {
          const labels = {
            method: METHOD,
            route: routeLabel(`${prefix}${mountPath}`, route.path),
            status_code: String(statusCode),
          };
          httpRequestsTotal.inc(labels, 0);
          httpRequestDurationSeconds.zero(labels);
        }
      }
    }
  }
}

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
  let label = "unmatched";

  Object.defineProperty(req, "route", {
    configurable: true,
    enumerable: true,
    get: () => matchedRoute,
    set: (route) => {
      matchedRoute = route;
      if (!route) return;
      label = routeLabel(req.baseUrl, String(route.path));
    },
  });

  // "close" fires after "finish" for a completed response, and on its own when
  // the connection drops first.
  res.once("close", () => {
    const statusCode = res.writableFinished ? String(res.statusCode) : "499";
    const labels = { method: req.method, route: label, status_code: statusCode };
    httpRequestsTotal.inc(labels);
    endTimer(labels);
  });

  next();
}

module.exports = { httpMetrics, createRouteSeries };
