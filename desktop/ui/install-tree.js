"use strict";

// Pure state of the item tree (Tier > Kind > Item). No DOM. Loaded in the browser as `zak.installTree` and
// in Node as a CommonJS module, so the logic has unit tests.
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.zak.installTree = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  // An item is { id, tier, category, label, requires: [id] }, as `zak kit inventory` prints it.
  const KINDS = [
    ["rules", "Rules"],
    ["skills", "Skills"],
    ["agents", "Agents"],
  ];

  const byId = (items) => new Map(items.map((item) => [item.id, item]));

  // Every item in `explicit` plus everything it requires, transitively. IDs the kit does not list are dropped.
  // Same meaning as the kit's `closeResources`.
  function closure(explicit, items) {
    const known = byId(items);
    const out = new Set();
    const stack = [...explicit];
    while (stack.length) {
      const id = stack.pop();
      if (out.has(id) || !known.has(id)) continue;
      out.add(id);
      for (const need of known.get(id).requires || []) stack.push(need);
    }
    return out;
  }

  // Item ID -> labels of the items that keep it checked. An item is locked only when the closure of the explicit set
  // without it still holds it, so a member of a dependency cycle can be unchecked when nothing outside the cycle
  // needs it. Items nothing keeps are absent.
  function requiredBy(explicit, items) {
    const out = new Map();
    for (const id of closure(explicit, items)) {
      const rest = new Set(explicit);
      rest.delete(id);
      const keep = closure(rest, items);
      if (!keep.has(id)) continue;
      const labels = new Set();
      for (const item of items) if (keep.has(item.id) && item.id !== id && (item.requires || []).includes(id)) labels.add(item.label);
      out.set(id, [...labels].sort((a, b) => a.localeCompare(b)));
    }
    return out;
  }

  // "on" when every ID is checked, "off" when none is, else "mixed". An empty group is "off".
  function nodeState(ids, checked) {
    let on = 0;
    for (const id of ids) if (checked.has(id)) on++;
    if (on === 0) return "off";
    return on === ids.length ? "on" : "mixed";
  }

  // The click on a tier or kind node. A fully checked node removes all its IDs from the explicit set, and the
  // closure keeps whatever a checked item outside the node still needs. Any other node adds every unchecked ID.
  function toggleNode(explicit, ids, checked) {
    const next = new Set(explicit);
    if (ids.every((id) => checked.has(id))) for (const id of ids) next.delete(id);
    else for (const id of ids) if (!checked.has(id)) next.add(id);
    return next;
  }

  // What changes between two checked sets, sorted.
  function itemDelta(before, after) {
    const b = new Set(before);
    const a = new Set(after);
    return {
      added: [...a].filter((id) => !b.has(id)).sort(),
      removed: [...b].filter((id) => !a.has(id)).sort(),
    };
  }

  const sameSet = (x, y) => x.size === y.size && [...x].every((id) => y.has(id));

  function followSummary(sourceLabel, checkedCount, total) {
    return `Follows ${sourceLabel}. ${checkedCount} of ${total} items.`;
  }

  // Tier > Kind > Item rows for the view. Tiers keep the inventory order, kinds go Rules, Skills, Agents, and empty
  // kinds are left out. Each node lists the IDs under it.
  function buildTree(items, tiers) {
    const order = tiers && tiers.length ? [...tiers] : [];
    for (const item of items) if (!order.includes(item.tier)) order.push(item.tier);
    return order
      .map((tier) => {
        const own = items.filter((item) => item.tier === tier);
        const extra = [...new Set(own.map((item) => item.category))].filter((c) => !KINDS.some(([k]) => k === c)).sort();
        const kinds = [...KINDS, ...extra.map((c) => [c, c.charAt(0).toUpperCase() + c.slice(1)])]
          .map(([kind, name]) => {
            const list = own.filter((item) => item.category === kind).sort((a, b) => a.label.localeCompare(b.label));
            return { key: `kind:${tier}/${kind}`, kind, name, ids: list.map((item) => item.id), items: list };
          })
          .filter((k) => k.ids.length > 0);
        return { key: `tier:${tier}`, tier, ids: own.map((item) => item.id), kinds };
      })
      .filter((t) => t.ids.length > 0);
  }

  return { closure, requiredBy, nodeState, toggleNode, itemDelta, followSummary, buildTree, sameSet };
});
