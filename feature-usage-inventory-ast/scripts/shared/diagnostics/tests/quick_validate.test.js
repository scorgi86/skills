const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { validateSkill } = require("../src/quick_validate");

function withSkill(frontmatter, callback) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "quick-skill-"));
  try {
    fs.writeFileSync(path.join(root, "SKILL.md"), `---\n${frontmatter}\n---\n# Test\n`, "utf8");
    callback(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test("quick validator accepts the current skill", () => {
  assert.equal(validateSkill(path.resolve(require("node:path").resolve(__dirname, "../../.."), "..")).valid, true);
});

test("quick validator rejects invalid names and unexpected keys", () => {
  withSkill("name: Bad_Name\ndescription: valid", (root) => assert.match(validateSkill(root).message, /hyphen-case/));
  withSkill("name: valid-name\ndescription: valid\nunknown: value", (root) => assert.match(validateSkill(root).message, /Unexpected key/));
});

test("quick validator supports quoted and block descriptions", () => {
  withSkill("name: valid-name\ndescription: 'quoted description'", (root) => assert.equal(validateSkill(root).valid, true));
  withSkill("name: valid-name\ndescription: |\n  block description", (root) => assert.equal(validateSkill(root).valid, true));
});
