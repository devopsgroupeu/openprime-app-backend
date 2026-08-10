// src/utils/generationErrors.js
//
// Injecto returns 422 with {code, message, details} when processing succeeded but
// the output would have been silently wrong (OP-214). Those codes are the only
// thing the user can act on, so they are translated here rather than surfacing
// "Request failed with status code 422", which is what they saw before.

const MESSAGES = {
  FILES_FAILED:
    "Generation failed: some template files could not be processed, so the result would " +
    "have been missing pieces. Nothing was delivered — this is a problem with the " +
    "infrastructure templates, not with your configuration.",
  FILE_COUNT_MISMATCH:
    "Generation failed: the generated file set did not match the templates, so it was " +
    "rejected rather than delivered incomplete.",
  MULTILINE_VALUE:
    "Generation failed: one of your settings targets a multi-line block that OpenPrime " +
    "cannot rewrite safely. It was refused rather than producing infrastructure code " +
    "that does not parse.",
};

const FALLBACK =
  "Generation failed: the generated infrastructure would have been incomplete or " +
  "incorrect, so it was not delivered.";

/**
 * Parse Injecto's 422 body. The response is requested as an arraybuffer (it is
 * normally a ZIP), so on the error path it arrives as a Buffer of JSON.
 *
 * @returns {{code: string, message: string, details: string[]}|null}
 */
function parseGenerationFailure(responseData) {
  if (!responseData) return null;
  try {
    const raw = Buffer.isBuffer(responseData)
      ? responseData.toString("utf8")
      : typeof responseData === "string"
        ? responseData
        : JSON.stringify(responseData);
    const detail = JSON.parse(raw)?.detail;
    if (!detail || typeof detail.code !== "string") return null;
    return {
      code: detail.code,
      message: detail.message || "",
      details: Array.isArray(detail.details) ? detail.details : [],
    };
  } catch {
    return null;
  }
}

/** User-facing sentence for a generation failure code. */
function messageForCode(code) {
  return MESSAGES[code] || FALLBACK;
}

/**
 * Build the Error thrown out of generateInfrastructure for a 422.
 * `statusCode` lets the controller answer 422 instead of a blanket 500.
 */
function generationError(failure) {
  const error = new Error(messageForCode(failure.code));
  error.statusCode = 422;
  error.code = failure.code;
  error.details = failure.details;
  return error;
}

module.exports = { parseGenerationFailure, messageForCode, generationError, MESSAGES, FALLBACK };
