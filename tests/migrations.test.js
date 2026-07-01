// tests/migrations.test.js
// Structural checks that don't require a database — guards against a broken
// migration file (missing up/down) reaching the migrate runner in CI/prod.
const fs = require("fs");
const path = require("path");

const MIGRATIONS_DIR = path.join(__dirname, "../src/migrations");

describe("database migrations", () => {
  const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".js"));

  it("has at least one migration", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files)("%s exports async up() and down()", (file) => {
    const migration = require(path.join(MIGRATIONS_DIR, file));
    expect(typeof migration.up).toBe("function");
    expect(typeof migration.down).toBe("function");
  });
});
