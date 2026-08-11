"use strict";

const {
  encryptCredentials,
  decryptCredentials,
  looksEncrypted,
} = require("../utils/credentialCrypto");

// 20260811090000-encrypt-git-repository-ssh-key.js
// Encrypts environments.git_repository->>'sshKey' in place, matching how
// cloud_credentials.credentials has always been stored. Only the sshKey member
// is touched; url/branch stay readable JSONB.
//
// Idempotence: a value already in ciphertext shape is left alone, so re-running
// this migration cannot double-encrypt. That matters because the ciphertext and
// a plaintext key are both just strings in the same JSONB slot -- there is no
// column type to tell them apart.
module.exports = {
  async up({ context: queryInterface }) {
    const [rows] = await queryInterface.sequelize.query(
      `SELECT id, git_repository FROM environments
       WHERE git_repository IS NOT NULL
         AND git_repository->>'sshKey' IS NOT NULL
         AND git_repository->>'sshKey' <> ''`,
    );

    let encrypted = 0;
    for (const row of rows) {
      const git = row.git_repository;
      if (looksEncrypted(git.sshKey)) continue; // already migrated

      await queryInterface.sequelize.query(
        `UPDATE environments SET git_repository = :git WHERE id = :id`,
        {
          replacements: {
            git: JSON.stringify({ ...git, sshKey: encryptCredentials(git.sshKey) }),
            id: row.id,
          },
        },
      );
      encrypted += 1;
    }

    console.log(
      `[migration] git_repository.sshKey encrypted for ${encrypted} of ${rows.length} environment(s)`,
    );
  },

  async down({ context: queryInterface }) {
    const [rows] = await queryInterface.sequelize.query(
      `SELECT id, git_repository FROM environments
       WHERE git_repository IS NOT NULL
         AND git_repository->>'sshKey' IS NOT NULL
         AND git_repository->>'sshKey' <> ''`,
    );

    for (const row of rows) {
      const git = row.git_repository;
      if (!looksEncrypted(git.sshKey)) continue; // already plaintext

      const plaintext = decryptCredentials(git.sshKey);
      if (plaintext === null) continue; // encrypted under a different key

      await queryInterface.sequelize.query(
        `UPDATE environments SET git_repository = :git WHERE id = :id`,
        {
          replacements: { git: JSON.stringify({ ...git, sshKey: plaintext }), id: row.id },
        },
      );
    }
  },
};
