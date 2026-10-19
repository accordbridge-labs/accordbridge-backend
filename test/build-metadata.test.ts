import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../src/app";
import { BuildMetadata, parseBuildRevision } from "../src/build-metadata";

test("build revision accepts only full commit hashes and explicitly marks absence", () => {
  assert.equal(parseBuildRevision(undefined), "unknown");
  assert.equal(parseBuildRevision(""), "unknown");
  assert.equal(parseBuildRevision("A1".repeat(20)), "a1".repeat(20));
  for (const invalid of [
    "main",
    "abc1234",
    "a".repeat(41),
    "g".repeat(40),
    " a".repeat(20),
    "secret-credential\n",
  ]) {
    assert.throws(
      () => parseBuildRevision(invalid),
      (error: Error) => {
        assert.equal(
          error.message,
          "BUILD_REVISION must be a full 40-character hexadecimal commit SHA",
        );
        return true;
      },
    );
  }
});

test("metadata is captured once at startup from the explicit variable only", () => {
  const previous = process.env.BUILD_REVISION;
  try {
    process.env.BUILD_REVISION = "b".repeat(40);
    const metadata = new BuildMetadata();
    process.env.BUILD_REVISION = "c".repeat(40);
    assert.equal(metadata.revision, "b".repeat(40));
  } finally {
    if (previous === undefined) delete process.env.BUILD_REVISION;
    else process.env.BUILD_REVISION = previous;
  }
});

test("malformed revision rejects application startup without echoing the value", async () => {
  const previous = process.env.BUILD_REVISION;
  try {
    process.env.BUILD_REVISION = "synthetic-secret";
    await assert.rejects(createApp(), {
      message:
        "BUILD_REVISION must be a full 40-character hexadecimal commit SHA",
    });
  } finally {
    if (previous === undefined) delete process.env.BUILD_REVISION;
    else process.env.BUILD_REVISION = previous;
  }
});
