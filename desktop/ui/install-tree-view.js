"use strict";

// DOM for one host card's item tree, link row and follower summary. All text goes through zak.el, so it is
// set with textContent. Rows are rebuilt on every paint; `data-focus` keys let the page restore keyboard focus.
(function () {
  const { el, icon } = zak;
  const T = zak.installTree;

  const focusKey = (hostId, key) => `${hostId}|${key}`;

  function checkbox({ hostId, key, label, state, disabled, title, onChange }) {
    const box = el("input", {
      type: "checkbox",
      class: "tree-check",
      checked: state === "on",
      disabled,
      "aria-label": label,
      title: title || "",
      "data-focus": focusKey(hostId, key),
    });
    box.indeterminate = state === "mixed";
    box.addEventListener("change", () => onChange(box.checked));
    return box;
  }

  function disclosure(hostId, key, name, open, onExpand) {
    const button = el(
      "button",
      {
        class: "disclosure",
        type: "button",
        "aria-expanded": String(open),
        "aria-label": `${open ? "Collapse" : "Expand"} ${name}`,
        "data-focus": focusKey(hostId, "open:" + key),
        on: { click: () => onExpand(key) },
      },
      icon("chevron")
    );
    return button;
  }

  // The switch that makes this host copy another host's selection. `reason` explains a disabled switch.
  function linkRow({ hostId, otherLabel, on, disabled, reason, onChange }) {
    const box = el("input", {
      type: "checkbox",
      role: "switch",
      class: "switch",
      checked: on,
      disabled,
      id: `link-${hostId}`,
      "data-focus": focusKey(hostId, "link"),
      title: reason || "",
    });
    box.addEventListener("change", () => onChange(box.checked));
    return el(
      "div",
      { class: "link-row" },
      el("label", { for: `link-${hostId}`, class: "link-label", text: `Same as ${otherLabel}` }),
      reason ? el("span", { class: "muted link-reason", text: reason }) : null,
      box
    );
  }

  // The read-only line that replaces the tree while a host follows another.
  const summary = (text) => el("p", { class: "follow-summary", text });

  // ctx: { hostId, hostLabel, tree, checked, locked (Map id -> labels), changed (id => bool), expanded (Set),
  //        disabled, reason, onItem(id, on), onNode(ids, state), onExpand(key) }
  function tree(ctx) {
    const { hostId, hostLabel, checked, locked, expanded } = ctx;
    const root = el("div", { class: "tree", role: "group", "aria-label": `Items on ${hostLabel}` });
    const countOf = (ids) => ids.filter((id) => checked.has(id)).length;
    const nodeRow = (node, depth, name, label) => {
      const state = T.nodeState(node.ids, checked);
      const open = expanded.has(node.key);
      return el(
        "div",
        { class: `tree-row node depth-${depth}` },
        disclosure(hostId, node.key, name, open, ctx.onExpand),
        el(
          "label",
          { class: "tree-label" },
          checkbox({
            hostId,
            key: node.key,
            label,
            state,
            disabled: ctx.disabled,
            title: ctx.reason || "",
            onChange: () => ctx.onNode(node.ids),
          }),
          el("span", { class: "tree-name", text: name })
        ),
        el("span", { class: "muted num tree-count", text: `${countOf(node.ids)} of ${node.ids.length}` })
      );
    };
    for (const tier of ctx.tree) {
      root.append(nodeRow(tier, 0, tier.tier, `${tier.tier} on ${hostLabel}`));
      if (!expanded.has(tier.key)) continue;
      for (const kind of tier.kinds) {
        root.append(nodeRow(kind, 1, kind.name, `${kind.name} in ${tier.tier} on ${hostLabel}`));
        if (!expanded.has(kind.key)) continue;
        for (const item of kind.items) {
          const requirers = locked.get(item.id);
          const isLocked = !!requirers && requirers.length > 0;
          const list = isLocked ? requirers.join(", ") : "";
          root.append(
            el(
              "div",
              { class: "tree-row item depth-2" + (isLocked ? " locked" : "") },
              el("span", { class: "mark", hidden: !ctx.changed(item.id), title: "Not applied yet" }),
              el(
                "label",
                { class: "tree-label", title: isLocked ? `Required by ${list}` : "" },
                checkbox({
                  hostId,
                  key: item.id,
                  label: `${item.label} on ${hostLabel}`,
                  state: checked.has(item.id) ? "on" : "off",
                  disabled: ctx.disabled || isLocked,
                  title: isLocked ? `Required by ${list}` : ctx.reason || "",
                  onChange: (on) => ctx.onItem(item.id, on),
                }),
                el("span", { class: "tree-name", text: item.label })
              ),
              isLocked ? el("span", { class: "muted tree-required", text: `required by ${list}`, title: `Required by ${list}` }) : null
            )
          );
        }
      }
    }
    return root;
  }

  // Puts keyboard focus back on the control with this `data-focus` key, after a rebuild.
  function restoreFocus(container, key) {
    if (!key) return;
    const again = [...container.querySelectorAll("[data-focus]")].find((node) => node.getAttribute("data-focus") === key);
    if (again) again.focus();
  }

  zak.installTreeView = { linkRow, summary, tree, restoreFocus };
})();
