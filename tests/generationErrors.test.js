// tests/generationErrors.test.js
//
// Injecto answers 422 with {code, message, details} when it refuses to hand over
// output that would be silently wrong (OP-214). Before this, the user saw
// "Failed to generate infrastructure: Request failed with status code 422".
const {
  parseGenerationFailure,
  messageForCode,
  generationError,
  MESSAGES,
  FALLBACK,
} = require("../src/utils/generationErrors");

const body = (detail) => Buffer.from(JSON.stringify({ detail }), "utf8");

describe("parseGenerationFailure", () => {
  it("parses the Buffer axios produces for an arraybuffer response", () => {
    // The request asks for an arraybuffer because the happy path is a ZIP, so the
    // error body arrives as a Buffer of JSON rather than a parsed object.
    const parsed = parseGenerationFailure(
      body({ code: "FILES_FAILED", message: "m", details: ["a.tf: boom"] }),
    );
    expect(parsed).toEqual({ code: "FILES_FAILED", message: "m", details: ["a.tf: boom"] });
  });

  it("accepts a plain string body", () => {
    const parsed = parseGenerationFailure(
      JSON.stringify({ detail: { code: "MULTILINE_VALUE", message: "m", details: [] } }),
    );
    expect(parsed.code).toBe("MULTILINE_VALUE");
  });

  it("accepts an already-parsed object", () => {
    const parsed = parseGenerationFailure({ detail: { code: "FILE_COUNT_MISMATCH" } });
    expect(parsed.code).toBe("FILE_COUNT_MISMATCH");
    expect(parsed.details).toEqual([]);
  });

  it.each([
    ["null", null],
    ["empty buffer", Buffer.from("")],
    ["non-JSON", Buffer.from("<html>502</html>")],
    ["JSON without detail", body(undefined)],
    ["detail without a code", body({ message: "no code here" })],
  ])("returns null for %s rather than throwing", (_label, input) => {
    expect(parseGenerationFailure(input)).toBeNull();
  });
});

describe("messageForCode", () => {
  it.each(Object.keys(MESSAGES))("has a specific message for %s", (code) => {
    expect(messageForCode(code)).toBe(MESSAGES[code]);
    expect(messageForCode(code)).not.toBe(FALLBACK);
  });

  it("falls back for a code this version does not know", () => {
    // Injecto can ship a new code before the backend does; the user must still
    // get a sentence rather than "undefined".
    expect(messageForCode("SOME_FUTURE_CODE")).toBe(FALLBACK);
  });

  it("never leaks a raw code to the user", () => {
    for (const code of [...Object.keys(MESSAGES), "SOME_FUTURE_CODE"]) {
      expect(messageForCode(code)).not.toContain(code);
    }
  });
});

describe("generationError", () => {
  it("carries a 422 so the controller does not answer a blanket 500", () => {
    const err = generationError({
      code: "FILES_FAILED",
      message: "internal",
      details: ["a.tf: boom"],
    });
    expect(err).toBeInstanceOf(Error);
    expect(err.statusCode).toBe(422);
    expect(err.code).toBe("FILES_FAILED");
    expect(err.details).toEqual(["a.tf: boom"]);
    expect(err.message).toBe(MESSAGES.FILES_FAILED);
  });

  it("does not surface Injecto's internal wording as the user message", () => {
    const err = generationError({
      code: "FILES_FAILED",
      message: "Files could not be processed and are missing from the output.",
      details: [],
    });
    expect(err.message).toBe(MESSAGES.FILES_FAILED);
  });
});
