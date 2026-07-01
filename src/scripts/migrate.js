// src/scripts/migrate.js
// Database migration CLI.
//   node src/scripts/migrate.js up             apply all pending migrations (default)
//   node src/scripts/migrate.js down           revert the most recent migration
//   node src/scripts/migrate.js status         list executed + pending migrations
//   node src/scripts/migrate.js create <name>  scaffold a new migration file
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { getMigrator } = require("../config/umzug");
const { closeConnection } = require("../config/database");
const { logger } = require("../utils/logger");

const MIGRATIONS_DIR = path.join(__dirname, "../migrations");

const TEMPLATE = `"use strict";

// {{name}}
module.exports = {
  async up({ context: queryInterface, Sequelize }) {
    // TODO: apply the change (e.g. queryInterface.addColumn(...)).
  },

  async down({ context: queryInterface, Sequelize }) {
    // TODO: reverse the change made in up().
  },
};
`;

function createMigration(name) {
  if (!name) throw new Error("Usage: npm run migrate:create <name>");
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
  const filename = `${stamp}-${slug}.js`;
  const filepath = path.join(MIGRATIONS_DIR, filename);
  fs.writeFileSync(filepath, TEMPLATE.replace("{{name}}", filename), { flag: "wx" });
  logger.info(`Created migration: src/migrations/${filename}`);
}

async function printStatus() {
  const migrator = getMigrator();
  const [executed, pending] = await Promise.all([migrator.executed(), migrator.pending()]);
  logger.info(`Executed (${executed.length}): ${executed.map((m) => m.name).join(", ") || "none"}`);
  logger.info(`Pending  (${pending.length}): ${pending.map((m) => m.name).join(", ") || "none"}`);
}

async function main() {
  const [cmd = "up", arg] = process.argv.slice(2);

  switch (cmd) {
    case "up":
      await getMigrator().up();
      break;
    case "down":
      await getMigrator().down();
      break;
    case "status":
      await printStatus();
      break;
    case "create":
      createMigration(arg);
      return; // no DB connection opened
    default:
      throw new Error(`Unknown command: ${cmd} (use up | down | status | create)`);
  }

  await closeConnection();
}

main()
  .then(() => process.exit(0))
  .catch(async (err) => {
    logger.error("Migration command failed:", err);
    await closeConnection().catch(() => {});
    process.exit(1);
  });
