// tests/imageUser.test.js
// OP-271 (D85): the image created its own user with uid 1001 and chowned /app
// to it, while the chart runs the pod as uid 1000, so the process could not
// write to /app/logs or /app/uploads. The image now runs as the node base
// image's own `node` user (uid 1000); this keeps the two in step.
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const dockerfile = fs.readFileSync(path.join(root, "Dockerfile"), "utf8");
const values = fs.readFileSync(path.join(root, "chart", "values.yaml"), "utf8");

// The official node images ship a `node` user and group with id 1000.
const NODE_IMAGE_UID = 1000;

const finalStage = dockerfile.split(/^FROM /m).pop();
const userLine = finalStage.match(/^USER\s+(\S+)\s*$/m);
const imageUid =
  userLine &&
  (/^\d+$/.test(userLine[1]) ? Number(userLine[1]) : userLine[1] === "node" ? NODE_IMAGE_UID : NaN);

describe("image user matches the chart's securityContext", () => {
  it("the final stage runs as a known uid", () => {
    expect(userLine).not.toBeNull();
    expect(Number.isInteger(imageUid)).toBe(true);
  });

  it.each(["runAsUser", "fsGroup"])("every %s in chart/values.yaml equals the image uid", (key) => {
    const found = [...values.matchAll(new RegExp(`^\\s+${key}:\\s*(\\d+)\\s*$`, "gm"))].map((m) =>
      Number(m[1]),
    );

    expect(found.length).toBeGreaterThan(0);
    for (const uid of found) {
      expect(uid).toBe(imageUid);
    }
  });

  it("files under /app are owned by the uid that runs", () => {
    const chowns = [...finalStage.matchAll(/chown\s+(?:-R\s+)?(\S+?):/g)].map((m) => m[1]);

    expect(chowns.length).toBeGreaterThan(0);
    for (const owner of chowns) {
      expect(owner).toBe(userLine[1]);
    }
  });
});
