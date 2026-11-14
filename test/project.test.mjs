import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findProject, listProject } from "../src/project.mjs";

function makeProject() {
  const root = mkdtempSync(join(tmpdir(), "thypit-proj-"));
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "demo", hypit: { project: true } }));
  mkdirSync(join(root, "productions", "promo", "runs"), { recursive: true });
  mkdirSync(join(root, "productions", "promo", "authors"), { recursive: true });
  mkdirSync(join(root, "references", "ref-a"), { recursive: true });
  writeFileSync(join(root, "productions", "promo", "BRIEF.md"), "# brief\n");
  writeFileSync(join(root, "productions", "promo", "runs", "build.svrun"), "{{text}}");
  writeFileSync(join(root, "references", "ref-a", "ANALYSIS.md"), "# a\n");
  return root;
}

test("findProject 从子目录向上找到 hypit.project", () => {
  const root = makeProject();
  const found = findProject(join(root, "productions", "promo"));
  assert.equal(found.root, root);
  assert.equal(found.name, "demo");
});

test("findProject 在非项目目录返回 null", () => {
  const dir = mkdtempSync(join(tmpdir(), "thypit-none-"));
  assert.equal(findProject(dir), null);
});

test("listProject 盘点 productions / runs / references", () => {
  const root = makeProject();
  const out = listProject({ project: root });
  assert.equal(out.format, "twb.list@1");
  assert.equal(out.project.root, root);
  assert.equal(out.productions.length, 1);
  const prod = out.productions[0];
  assert.equal(prod.name, "promo");
  assert.equal(prod.files.brief, true);
  assert.equal(prod.files.treatment, false);
  assert.deepEqual(prod.runs.map((r) => r.relPath), ["productions/promo/runs/build.svrun"]);
  assert.deepEqual(out.references.map((r) => r.name), ["ref-a"]);
});

test("listProject 不在项目里时给 hint 而不是抛", () => {
  const dir = mkdtempSync(join(tmpdir(), "thypit-none2-"));
  const out = listProject({ project: dir });
  assert.equal(out.project, null);
  assert.match(out.hint, /不在 Hypit 项目里/);
});
