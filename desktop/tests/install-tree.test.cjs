"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { closure, requiredBy, nodeState, toggleNode, itemDelta, followSummary, buildTree, sameSet } = require("../ui/install-tree.js");

const item = (tier, category, label, requires = []) => ({ id: `${tier}/${category}/${label}`, tier, category, label, requires });
const ids = (...labels) => labels.map((l) => `general/skills/${l}`);

// chain: a -> b -> c. diamond: top -> left, right; left -> base; right -> base.
const CHAIN = [item("general", "skills", "a", ids("b")), item("general", "skills", "b", ids("c")), item("general", "skills", "c")];
const DIAMOND = [
  item("general", "skills", "top", ids("left", "right")),
  item("general", "skills", "left", ids("base")),
  item("general", "skills", "right", ids("base")),
  item("general", "skills", "base"),
];

test("closure follows a chain to its end", () => {
  assert.deepEqual([...closure(new Set(ids("a")), CHAIN)].sort(), ids("a", "b", "c"));
  assert.deepEqual([...closure(new Set(ids("b")), CHAIN)].sort(), ids("b", "c"));
  assert.deepEqual([...closure(new Set(), CHAIN)], []);
});

test("closure visits a shared dependency once in a diamond", () => {
  assert.deepEqual([...closure(new Set(ids("top")), DIAMOND)].sort(), ids("base", "left", "right", "top"));
  assert.deepEqual([...closure(new Set(ids("left", "right")), DIAMOND)].sort(), ids("base", "left", "right"));
});

test("closure survives a cycle and drops unknown IDs", () => {
  const loop = [item("general", "skills", "x", ids("y")), item("general", "skills", "y", ids("x", "ghost"))];
  assert.deepEqual([...closure(new Set(ids("x")), loop)].sort(), ids("x", "y"));
  assert.deepEqual([...closure(new Set(["general/skills/ghost"]), loop)], []);
});

test("requiredBy lists every checked requirer by label", () => {
  const checked = closure(new Set(ids("left", "right")), DIAMOND);
  const map = requiredBy(checked, DIAMOND);
  assert.deepEqual(map.get("general/skills/base"), ["left", "right"]);
  assert.equal(map.has("general/skills/left"), false);
});

test("requiredBy ignores requirers that are not checked", () => {
  const checked = closure(new Set(ids("left")), DIAMOND);
  const map = requiredBy(checked, DIAMOND);
  assert.deepEqual(map.get("general/skills/base"), ["left"]);
  assert.equal(map.has("general/skills/right"), false);
});

test("nodeState is on, off or mixed", () => {
  const checked = new Set(ids("a", "b"));
  assert.equal(nodeState(ids("a", "b"), checked), "on");
  assert.equal(nodeState(ids("a", "c"), checked), "mixed");
  assert.equal(nodeState(ids("c"), checked), "off");
  assert.equal(nodeState([], checked), "off");
});

test("toggleNode checks every unchecked ID of a partly checked node", () => {
  const explicit = new Set(ids("c"));
  const checked = closure(explicit, CHAIN);
  const next = toggleNode(explicit, ids("a", "b", "c"), checked, requiredBy(checked, CHAIN));
  assert.deepEqual([...next].sort(), ids("a", "b", "c"));
  assert.deepEqual([...explicit], ids("c"), "the input set is not changed");
});

test("toggleNode unchecks a fully checked node but keeps locked items", () => {
  const explicit = new Set(ids("a", "c"));
  const checked = closure(explicit, CHAIN);
  const locked = requiredBy(checked, CHAIN);
  const next = toggleNode(explicit, ids("a", "c"), checked, locked);
  assert.deepEqual([...next], ids("c"), "c is required by b, which a pulled in");
  assert.deepEqual([...closure(next, CHAIN)].sort(), ids("c"));
});

test("toggleNode clears a whole node whose items lock nothing outside it", () => {
  const explicit = new Set(ids("top"));
  const checked = closure(explicit, DIAMOND);
  const next = toggleNode(explicit, ids("top", "left", "right", "base"), checked, new Set());
  assert.equal(next.size, 0);
});

test("itemDelta sorts added and removed IDs", () => {
  assert.deepEqual(itemDelta(ids("b", "a"), ids("c", "a", "d")), { added: ids("c", "d"), removed: ids("b") });
  assert.deepEqual(itemDelta([], []), { added: [], removed: [] });
});

test("followSummary names the source and the counts", () => {
  assert.equal(followSummary("Claude Code", 14, 22), "Follows Claude Code. 14 of 22 items.");
});

test("sameSet compares members", () => {
  assert.equal(sameSet(new Set(["a", "b"]), new Set(["b", "a"])), true);
  assert.equal(sameSet(new Set(["a"]), new Set(["a", "b"])), false);
});

test("buildTree groups tiers, orders kinds and leaves empty kinds out", () => {
  const items = [
    item("unity", "agents", "z-u-agent"),
    item("general", "skills", "z-b"),
    item("general", "rules", "z-r"),
    item("general", "skills", "z-a"),
  ];
  const tree = buildTree(items, ["unity", "general", "luna"]);
  assert.deepEqual(tree.map((t) => t.tier), ["unity", "general"], "luna has no items");
  const general = tree[1];
  assert.deepEqual(general.kinds.map((k) => k.name), ["Rules", "Skills"]);
  assert.deepEqual(general.kinds[1].items.map((i) => i.label), ["z-a", "z-b"]);
  assert.equal(general.ids.length, 3);
  assert.equal(general.key, "tier:general");
  assert.equal(general.kinds[0].key, "kind:general/rules");
});

test("buildTree adds a tier that the tier list omits", () => {
  const tree = buildTree([item("extra", "skills", "z-x")], ["general"]);
  assert.deepEqual(tree.map((t) => t.tier), ["extra"]);
});
