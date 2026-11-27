"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { linkFlags, closure, requiredBy, nodeState, toggleNode, itemDelta, followSummary, buildTree, sameSet } = require("../ui/install-tree.js");

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

test("requiredBy lists every requirer that keeps an item checked", () => {
  const map = requiredBy(new Set(ids("left", "right")), DIAMOND);
  assert.deepEqual(map.get("general/skills/base"), ["left", "right"]);
  assert.equal(map.has("general/skills/left"), false);
});

test("requiredBy ignores requirers that are not checked", () => {
  const map = requiredBy(new Set(ids("left")), DIAMOND);
  assert.deepEqual(map.get("general/skills/base"), ["left"]);
  assert.equal(map.has("general/skills/right"), false);
});

// The real unity tier: the core rule and the asset conventions rule require each other, and a skill shares a label
// with a rule. The luna pair has the same shape.
const unity = (category, label, requires = []) => ({ id: `unity/${category}/${label}`, tier: "unity", category, label, requires });
const UNITY = [
  unity("rules", "z-unity-core.md", ["unity/rules/z-unity-asset-conventions.md", "unity/skills/z-unity-asset-conventions"]),
  unity("rules", "z-unity-asset-conventions.md", ["unity/rules/z-unity-core.md"]),
  unity("skills", "z-unity-asset-conventions", ["unity/rules/z-unity-asset-conventions.md"]),
  unity("skills", "z-unity-code-review", ["unity/rules/z-unity-core.md"]),
];
const UNITY_IDS = UNITY.map((i) => i.id);
const CORE = "unity/rules/z-unity-core.md";

test("requiredBy does not lock the item that started a dependency cycle", () => {
  const map = requiredBy(new Set([CORE]), UNITY);
  assert.equal(map.has(CORE), false, "nothing outside the cycle needs z-unity-core");
  assert.deepEqual(map.get("unity/rules/z-unity-asset-conventions.md"), ["z-unity-asset-conventions", "z-unity-core.md"]);
  assert.deepEqual(map.get("unity/skills/z-unity-asset-conventions"), ["z-unity-core.md"]);
});

test("requiredBy lists one label per requirer", () => {
  const map = requiredBy(new Set([CORE]), UNITY);
  const labels = map.get("unity/rules/z-unity-asset-conventions.md");
  assert.deepEqual(labels, [...new Set(labels)]);
});

test("unchecking the unity tier clears a cycle that was checked through one rule", () => {
  const explicit = new Set([CORE]);
  const checked = closure(explicit, UNITY);
  assert.equal(checked.size, 3, "core, asset rule and asset skill; the review skill stays off");
  const all = toggleNode(explicit, UNITY_IDS, checked);
  assert.equal(closure(all, UNITY).size, 4, "a partly checked tier checks everything first");
  const next = toggleNode(all, UNITY_IDS, closure(all, UNITY));
  assert.equal(next.size, 0);
  assert.equal(closure(next, UNITY).size, 0, "nothing from unity remains");
});

test("unchecking the unity tier clears an install whose items are all explicit", () => {
  const explicit = new Set(UNITY_IDS);
  const checked = closure(explicit, UNITY);
  const next = toggleNode(explicit, UNITY_IDS, checked);
  assert.equal(closure(next, UNITY).size, 0);
});

test("unchecking a kind keeps what a checked item outside the kind needs", () => {
  const explicit = new Set([...UNITY_IDS.filter((id) => id.includes("/skills/z-unity-code-review"))]);
  const checked = closure(explicit, UNITY);
  const rules = UNITY_IDS.filter((id) => id.includes("/rules/"));
  const next = toggleNode(explicit, rules, checked);
  assert.deepEqual([...closure(next, UNITY)].sort(), [...checked].sort(), "the review skill still pulls the rules in");
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
  const next = toggleNode(explicit, ids("a", "b", "c"), checked);
  assert.deepEqual([...next].sort(), ids("a", "b", "c"));
  assert.deepEqual([...explicit], ids("c"), "the input set is not changed");
});

test("toggleNode unchecks a fully checked node and drops its explicit IDs", () => {
  const explicit = new Set(ids("a", "c"));
  const checked = closure(explicit, CHAIN);
  const next = toggleNode(explicit, ids("a", "c"), checked);
  assert.equal(next.size, 0);
});

test("toggleNode keeps an item that a checked item outside the node requires", () => {
  const explicit = new Set(ids("a", "c"));
  const checked = closure(explicit, CHAIN);
  const next = toggleNode(explicit, ids("c"), checked);
  assert.deepEqual([...next], ids("a"));
  assert.deepEqual([...closure(next, CHAIN)].sort(), ids("a", "b", "c"));
});

test("toggleNode clears a whole node whose items lock nothing outside it", () => {
  const explicit = new Set(ids("top"));
  const checked = closure(explicit, DIAMOND);
  const next = toggleNode(explicit, ids("top", "left", "right", "base"), checked);
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

const LIST = ids("a", "b");

test("linkFlags links an installed host with the flag alone", () => {
  assert.deepEqual(linkFlags({ link: "claude", hostInstalled: true, items: LIST }), { follow: "claude", noFollow: false, select: [], tiers: [] });
});

test("linkFlags sends the items with the link for a host that is not installed", () => {
  assert.deepEqual(linkFlags({ link: "claude", hostInstalled: false, items: LIST }), { follow: "claude", noFollow: false, select: LIST, tiers: [] });
});

test("linkFlags unlinks with the flag alone while the source is installed", () => {
  assert.deepEqual(linkFlags({ unlink: true, sourceInstalled: true, items: LIST }), { follow: null, noFollow: true, select: [], tiers: [] });
});

test("linkFlags sends the current items with an unlink when the source is not installed", () => {
  assert.deepEqual(linkFlags({ unlink: true, sourceInstalled: false, items: LIST }), { follow: null, noFollow: true, select: LIST, tiers: [] });
});

test("linkFlags sends the staged items when nothing is linked", () => {
  assert.deepEqual(linkFlags({ items: LIST }), { follow: null, noFollow: false, select: LIST, tiers: [] });
});

test("linkFlags sends the source tiers with the link for a host that is not installed and a tier-only source", () => {
  const flags = linkFlags({ link: "claude", hostInstalled: false, sourceSaved: false, sourceTiers: ["general", "unity"], items: LIST });
  assert.deepEqual(flags, { follow: "claude", noFollow: false, select: [], tiers: ["general", "unity"] });
});

test("linkFlags keeps the items for a source that saved its item list", () => {
  const flags = linkFlags({ link: "claude", hostInstalled: false, sourceSaved: true, sourceTiers: ["general"], items: LIST });
  assert.deepEqual(flags, { follow: "claude", noFollow: false, select: LIST, tiers: [] });
});
