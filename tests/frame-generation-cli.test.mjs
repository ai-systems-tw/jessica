import assert from "node:assert/strict";
import { mkdtemp, open, readFile, readdir, stat, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

import { writeExclusiveProxyBundle } from "../apps/frame-factory/proxy-output.mjs";

const cli = new URL("../apps/frame-factory/proxy-generate-cli.mjs", import.meta.url);
const fixture = new URL("../fixtures/frame-generation/proxy.synthetic.template.json", import.meta.url);
function run(args) { return spawnSync(process.execPath, [cli.pathname, ...args], { encoding: "utf8", cwd: new URL("..", import.meta.url).pathname }); }

test("CLI writes only content-addressed GLB and manifest inside an explicit output directory", async () => {
  const root = await mkdtemp(join(tmpdir(), "jessica-proxy-cli-")); const output = join(root, "nested", "output");
  const result = run([fixture.pathname, "--output-dir", output]);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const report = JSON.parse(result.stdout); const files = (await readdir(output)).sort();
  assert.deepEqual(files, [report.files.manifest, report.files.glb].sort());
  assert.match(report.files.glb, /^[a-f0-9]{64}\.proxy\.glb$/);
  assert.match(report.files.manifest, /^[a-f0-9]{64}\.manifest\.json$/);
  assert.equal(report.recommendedForLive, false);
});

test("CLI refuses overwrite and detects pre-existing content-address collision or tamper", async () => {
  const root = await mkdtemp(join(tmpdir(), "jessica-proxy-collision-"));
  const first = run([fixture.pathname, "--output-dir", root]); assert.equal(first.status, 0);
  const second = run([fixture.pathname, "--output-dir", root]); assert.equal(second.status, 1);
  assert.equal(JSON.parse(second.stdout).error.code, "OUTPUT_COLLISION");

  const other = await mkdtemp(join(tmpdir(), "jessica-proxy-tamper-")); const report = JSON.parse(first.stdout);
  await writeFile(join(other, report.files.glb), "tamper");
  const tamper = run([fixture.pathname, "--output-dir", other]);
  assert.equal(JSON.parse(tamper.stdout).error.code, "OUTPUT_COLLISION");
  assert.equal(await readFile(join(other, report.files.glb), "utf8"), "tamper");
});

test("exclusive bundle writer removes both invocation-created files after a partial manifest write", async () => {
  const root = await mkdtemp(join(tmpdir(), "jessica-proxy-cleanup-"));
  const glbPath = join(root, "created.glb"); const manifestPath = join(root, "created.json");
  let opens = 0;
  await assert.rejects(writeExclusiveProxyBundle({ glbPath, manifestPath, glb: new Uint8Array([1,2,3]), manifestJson: "{}\n" }, {
    openFile: async (path, flags) => {
      const handle = await open(path, flags); opens += 1;
      if (opens === 1) return handle;
      return {
        writeFile: async (...args) => { await handle.writeFile(...args); const error = new Error("injected write failure"); error.code = "EIO"; throw error; },
        close: () => handle.close(),
      };
    },
    removeFile: unlink,
  }), /injected write failure/);
  await assert.rejects(stat(glbPath), { code: "ENOENT" });
  await assert.rejects(stat(manifestPath), { code: "ENOENT" });
});

test("CLI missing/malformed/unknown input errors are sanitized and do not disclose paths or stacks", async () => {
  const root = await mkdtemp(join(tmpdir(), "jessica-proxy-privacy-"));
  const malformedPath = join(root, "private-malformed.json"); await writeFile(malformedPath, "{");
  const unknownPath = join(root, "private-unknown.json"); await writeFile(unknownPath, JSON.stringify({ schemaVersion: 1, secret: "/private/should-not-leak" }));
  const keyPath = join(root, "private-key.json"); await writeFile(keyPath, JSON.stringify({ schemaVersion: 1, ["/Users/private/customer/source.png"]: true }));
  for (const result of [run([]), run([join(root, "missing-secret.json"), "--output-dir", root]), run([malformedPath, "--output-dir", root]), run([unknownPath, "--output-dir", root]), run([keyPath, "--output-dir", root])]) {
    assert.notEqual(result.status, 0);
    assert.doesNotMatch(result.stdout, /missing-secret|private-malformed|private-unknown|private-key|should-not-leak|customer|source\.png| at /);
    const report = JSON.parse(result.stdout); assert.equal(report.ok, false); assert.equal(report.recommendedForLive, false);
    if (report.error.code === "INPUT_INVALID") assert.equal(report.error.message, "proxy input failed strict validation");
  }
});
