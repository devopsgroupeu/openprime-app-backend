// src/config/umzug.js
const Sequelize = require("sequelize");
const { Umzug, SequelizeStorage } = require("umzug");
const { sequelize } = require("./database");
const { logger } = require("../utils/logger");

// File-based migrations in src/migrations, tracked in the SequelizeMeta table.
// Reuses the app's Sequelize instance (single DB-config source: config/database.js)
// so migrations run against the same connection the app uses — no duplicate
// config.json (unlike sequelize-cli).
//
// Constructed lazily: building the Umzug instance calls sequelize.getQueryInterface(),
// which must not run at require-time (tests import the app with a mocked Sequelize
// that has no real query interface, and only ever exercise the runtime code path).
let migratorInstance;

function getMigrator() {
  if (migratorInstance) return migratorInstance;

  migratorInstance = new Umzug({
    migrations: {
      glob: ["../migrations/*.js", { cwd: __dirname }],
      resolve({ name, path: filepath, context }) {
        const migration = require(filepath);
        return {
          name,
          up: async () => migration.up({ context, sequelize, Sequelize }),
          down: async () => migration.down({ context, sequelize, Sequelize }),
        };
      },
    },
    context: sequelize.getQueryInterface(),
    storage: new SequelizeStorage({ sequelize }),
    logger: {
      info: (msg) => logger.info(`[migrate] ${msg.event ?? ""} ${msg.name ?? ""}`.trim()),
      warn: (msg) =>
        logger.warn(`[migrate] ${typeof msg === "string" ? msg : JSON.stringify(msg)}`),
      error: (msg) =>
        logger.error(`[migrate] ${typeof msg === "string" ? msg : JSON.stringify(msg)}`),
      debug: () => {},
    },
  });

  return migratorInstance;
}

// Startup schema policy — replaces the old sequelize.sync() call.
//   production: validate-not-mutate. Never migrate from the app process; if any
//               migration is pending, fail fast so we never serve traffic against
//               an outdated schema. The pre-deploy job (npm run migrate:up) must
//               run first.
//   other envs: auto-apply pending migrations to keep local/dev friction-free.
async function migrateOnStartup() {
  const migrator = getMigrator();
  const pending = await migrator.pending();

  if (pending.length === 0) {
    logger.info("[migrate] schema up to date, no pending migrations");
    return;
  }

  const names = pending.map((m) => m.name).join(", ");

  if (process.env.NODE_ENV === "production") {
    throw new Error(
      `Refusing to start: ${pending.length} pending migration(s) [${names}]. ` +
        `Run migrations first (pre-deploy job: npm run migrate:up).`,
    );
  }

  logger.warn(`[migrate] applying ${pending.length} pending migration(s): ${names}`);
  await migrator.up();
}

module.exports = { getMigrator, migrateOnStartup };
