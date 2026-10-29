// tests/downloadFilename.test.js
// The ZIP download's filename comes from the environment name, which allows
// spaces, semicolons and any Unicode. Interpolated raw into Content-Disposition,
// a ";" splits the header into bogus parameters and a character outside Latin-1
// makes Node throw, so the download fails with a 500 after the work is done.
const request = require("supertest");
const app = require("../src/server");
const environmentService = require("../src/services/environmentService");
const jobService = require("../src/services/jobService");

const ENV_ID = "22222222-2222-2222-2222-222222222222";

function generate(name) {
  environmentService.getEnvironmentByIdAndUser.mockResolvedValueOnce({ id: ENV_ID, name });
  return request(app)
    .post(`/api/environments/${ENV_ID}/generate`)
    .set("Authorization", "Bearer test-token");
}

function downloadJob(name) {
  jobService.getJobWithArtifact.mockResolvedValueOnce({
    id: "job-1",
    type: "generate",
    status: "succeeded",
    artifact: Buffer.from("zip-bytes"),
    payload: { environment: { name } },
  });
  return request(app).get("/api/jobs/job-1/download").set("Authorization", "Bearer test-token");
}

describe.each([
  ["synchronous generate", generate],
  ["job artifact download", downloadJob],
])("%s filename", (_label, send) => {
  it("quotes a plain name", async () => {
    const res = await send("prod");

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("application/zip");
    expect(res.headers["content-disposition"]).toBe(
      'attachment; filename="prod-infrastructure.zip"',
    );
  });

  it("keeps a semicolon inside the quoted filename", async () => {
    const res = await send("prod; size=1");

    expect(res.status).toBe(200);
    expect(res.headers["content-disposition"]).toBe(
      'attachment; filename="prod; size=1-infrastructure.zip"',
    );
  });

  it("serves a name outside Latin-1 instead of failing", async () => {
    const res = await send("prostredie č1");

    expect(res.status).toBe(200);
    expect(res.headers["content-disposition"]).toContain(
      "filename*=UTF-8''prostredie%20%C4%8D1-infrastructure.zip",
    );
  });
});
