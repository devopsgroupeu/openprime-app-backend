// src/services/credentialValidationService.js
const { STSClient, GetCallerIdentityCommand } = require("@aws-sdk/client-sts");

// Errors that mean the supplied credentials themselves are wrong (bad key,
// expired token, signature mismatch). These are user errors we can surface
// immediately as a 400 rather than storing a credential that can never work.
const AUTH_ERROR_NAMES = new Set([
  "InvalidClientTokenId",
  "UnrecognizedClientException",
  "ExpiredToken",
  "ExpiredTokenException",
  "InvalidSignatureException",
  "SignatureDoesNotMatch",
  "CredentialsProviderError",
]);

// Errors that mean AWS itself is having a moment. These must not block
// credential creation — the credentials may be perfectly fine, STS is just
// temporarily unavailable.
const TRANSIENT_ERROR_NAMES = new Set([
  "ThrottlingException",
  "SlowDown",
  "InternalFailure",
  "ServiceUnavailable",
]);

/**
 * Validate AWS credentials against STS GetCallerIdentity.
 *
 * Returns a structured result rather than throwing so callers can decide how
 * to react to each failure class:
 *   - { valid: true, accountId, arn }            — credentials work
 *   - { valid: false, reason: "invalid_credentials", message } — bad credentials
 *   - { valid: false, reason: "temporary_failure", message }   — AWS transient error
 *   - { valid: false, reason: "network_error", message }       — anything else
 *
 * The STS client is always destroyed, even when the call fails.
 */
async function validateAwsCredentials(accessKeyId, secretAccessKey) {
  const client = new STSClient({
    region: "us-east-1",
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
  });

  try {
    const result = await client.send(new GetCallerIdentityCommand({}));
    return {
      valid: true,
      accountId: result.Account,
      arn: result.Arn,
    };
  } catch (error) {
    const errorName = error?.name;
    if (AUTH_ERROR_NAMES.has(errorName)) {
      return { valid: false, reason: "invalid_credentials", message: error.message };
    }
    if (TRANSIENT_ERROR_NAMES.has(errorName)) {
      return { valid: false, reason: "temporary_failure", message: error.message };
    }
    return { valid: false, reason: "network_error", message: error.message };
  } finally {
    client.destroy();
  }
}

module.exports = { validateAwsCredentials };
