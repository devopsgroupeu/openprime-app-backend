// src/controllers/catalogController.js
const catalogService = require("../services/catalogService");

// The ETag is Injecto's, which is the templates commit sha — so a client that
// already holds the current catalog revalidates rather than re-downloading it.
// express compares it against If-None-Match and answers 304 on its own.
async function getCatalog(req, res, next) {
  try {
    const { doc, etag, stale } = await catalogService.getCatalog();

    if (etag) res.set("ETag", etag);
    if (stale) res.set("Warning", '110 - "Response is stale"');

    res.json(doc);
  } catch (error) {
    next(error);
  }
}

module.exports = { getCatalog };
