"use strict";

// Install pages: This Mac and each project. Reads the kit inventory and lock-driven state, shows one item tree per
// agent, checks drift, and runs install/update/uninstall through the plan sheet (dry run first, commit second).
(function () {
  const { el, icon, invoke, errText, firstLine, plural } = zak;
  const T = zak.installTree;
  const V = zak.installTreeView;

  const HOSTS = [
    { id: "claude", label: "Claude Code" },
    { id: "codex", label: "Codex" },
  ];
  const VERBS = { install: ["Install", "Installing"], update: ["Update", "Updating"], uninstall: ["Uninstall", "Removing"], apply: ["Apply", "Applying"] };

  // location key -> { inv, invLoad, hs, expanded, states, busy, notes, results }
  // inv: null while unread, { error } when the read failed, else the `zak kit inventory` object.
  // hs: per host { explicit, origExplicit, link, origLink, error }. `explicit` is what the user checked, `orig*` is
  // what the lock records. The checked set is the closure of `explicit` over `requires`.
  const stores = new Map();
  const checkedOnce = new Set();
  let view = null; // refs of the page currently on screen

  const HELP = "Check the items to install on each agent. An item that needs other items checks them for you, and they stay locked while it is checked. Nothing changes until you apply, and the plan lists every file first. “Same as” makes an agent follow the other one.";
  const KIT_PATH_HINT = /set a local kit path/i;

  const keyOf = (loc) => (loc.path == null ? "global" : "project:" + loc.path);
  const nameOf = (loc) => (loc.path == null ? "This Mac" : zak.baseName(loc.path));
  const hostOf = (id) => HOSTS.find((h) => h.id === id);
  const otherOf = (id) => (id === "claude" ? "codex" : "claude");
  const scopeOf = (loc) => (loc.path == null ? { kind: "global" } : { kind: "project", path: loc.path });
  const sorted = (set) => [...set].sort();

  function findLoc(key) {
    const I = zak.state.installs;
    if (!I) return null;
    return key === "global" ? I.global : I.projects.find((p) => p.path === key.slice(8)) || null;
  }

  function getStore(loc) {
    const key = keyOf(loc);
    let s = stores.get(key);
    if (!s) {
      s = { inv: null, invLoad: null, hs: null, expanded: new Set(), states: { claude: { kind: "idle" }, codex: { kind: "idle" } }, busy: false, notes: [], results: [] };
      stores.set(key, s);
    }
    return s;
  }

  // ---- inventory and staged selection ----
  const itemsOf = (store) => (store.inv && !store.inv.error ? store.inv.items : []);
  const closureOf = (store, ids) => T.closure(ids, itemsOf(store));
  const labelFor = (store, id) => {
    const item = itemsOf(store).find((i) => i.id === id);
    return item ? item.label : String(id).split("/").pop();
  };

  function validInventory(inv) {
    return !!inv && typeof inv === "object" && Array.isArray(inv.items) && !!inv.hosts && typeof inv.hosts === "object";
  }

  // Adopts an inventory. A host with staged edits keeps them (minus items the kit no longer lists). A host with
  // none follows the lock again, so a change made outside the app shows up on the next read.
  function applyInventory(store, inv) {
    const known = new Set(inv.items.map((i) => i.id));
    const prior = store.hs;
    store.hs = {};
    for (const h of HOSTS) {
      const src = inv.hosts[h.id] || {};
      const orig = new Set((src.selected || []).filter((id) => known.has(id)));
      const origLink = src.follows || null;
      const old = prior && prior[h.id];
      const untouched = !old || (old.link === old.origLink && T.sameSet(T.closure(old.explicit, inv.items), T.closure(old.origExplicit, inv.items)));
      store.hs[h.id] = {
        origExplicit: orig,
        origLink,
        explicit: untouched ? new Set(orig) : new Set([...old.explicit].filter((id) => known.has(id))),
        link: untouched ? origLink : old.link,
        error: src.error || null,
      };
    }
  }

  // One read at a time per page. A second caller gets the read already in flight.
  function loadInventory(key) {
    const loc = findLoc(key);
    if (!loc) return Promise.resolve(null);
    const store = getStore(loc);
    if (store.invLoad) return store.invLoad;
    store.invLoad = invoke("kit_inventory", { scope: scopeOf(loc) })
      .then((inv) => {
        if (!validInventory(inv)) throw new Error("The kit returned an unexpected inventory.");
        store.inv = inv;
        applyInventory(store, inv);
        return inv;
      })
      .catch((e) => {
        store.inv = { error: errText(e).replace(/^Error: /, "") };
        return store.inv;
      })
      .finally(() => {
        store.invLoad = null;
        if (live(key)) paint(key);
      });
    return store.invLoad;
  }

  const installedHost = (loc, h) => !!loc.hosts[h];
  // A lock with no saved item list and no link records tiers only. Check and Update keep sending its tiers.
  function legacyTiers(loc, store, h) {
    const src = store.inv && !store.inv.error && store.inv.hosts[h];
    return installedHost(loc, h) && src && src.saved === false && !src.follows ? sorted(loc.hosts[h].tiers) : null;
  }

  // The checked set this host would have after Apply, and the set its lock records now.
  const beforeSet = (store, h) => closureOf(store, store.hs[h].origExplicit);
  function afterSet(store, h) {
    const st = store.hs[h];
    if (st.link) return closureOf(store, store.hs[st.link].origExplicit);
    return st.origLink ? beforeSet(store, h) : closureOf(store, st.explicit);
  }
  function staged(store, h) {
    const st = store.hs && store.hs[h];
    if (!st || !store.inv || store.inv.error) return false;
    return st.link !== st.origLink || !T.sameSet(afterSet(store, h), beforeSet(store, h));
  }

  // ---- reading kit_run results ----
  const hasItems = (x) => (Array.isArray(x) ? x.length > 0 : !!x && typeof x === "object" ? Object.keys(x).length > 0 : !!x);
  const isChange = (op) => !/^(unchanged|skip|skipped|keep|noop|none)$/i.test(String(op.action || ""));
  function describeItem(x) {
    if (typeof x === "string") return x;
    if (x && typeof x === "object") {
      if (x.message) return String(x.message);
      if (x.rel) return [x.rel, x.reason || x.kind].filter(Boolean).join(": ");
    }
    return JSON.stringify(x);
  }
  const listOf = (x) => (Array.isArray(x) ? x : hasItems(x) ? [x] : []).map(describeItem);

  function normAction(a) {
    const s = String(a || "").toLowerCase();
    if (/^(remove|delete|uninstall)/.test(s)) return "Remove";
    if (/^(add|create|install|new)/.test(s)) return "Add";
    if (/^(update|replace|modify|overwrite)/.test(s)) return "Update";
    return s ? s[0].toUpperCase() + s.slice(1) : "Other";
  }

  // One kit_run can return a report per host. Each report names its host in `target`. A lone report without a
  // target belongs to the host that was asked for.
  function reportsOf(res, asked) {
    const reports = res.reports || [];
    const named = reports.filter((r) => r && hostOf(r.target));
    if (named.length) return named.map((rep) => ({ host: rep.target, rep }));
    return reports.length === 1 ? [{ host: asked, rep: reports[0] }] : [];
  }
  const reportFor = (res, host, asked) => (reportsOf(res, asked || host).find((r) => r.host === host) || {}).rep || null;

  function interpretCheck(res, host) {
    const rep = reportFor(res, host);
    if (!rep) return { kind: "failed", detail: firstLine(res.stderr) || firstLine(res.stdout) || `Exit code ${res.exit_code}` };
    const problems = [...listOf(rep.conflicts), ...listOf(rep.issues)];
    if (problems.length) return { kind: "failed", detail: problems[0] };
    const n = (rep.operations || []).filter(isChange).length;
    if (rep.inSync === true) return { kind: "insync" };
    if (n > 0) return { kind: "changes", count: n };
    // Drift with no file operations: the lock itself changes (new kit version, legacy lock).
    if (rep.lockChange === true || rep.inSync === false) return { kind: "lockonly" };
    if (res.exit_code !== 0) return { kind: "failed", detail: firstLine(res.stderr) || `Exit code ${res.exit_code}` };
    return { kind: "insync" };
  }

  // ---- requests ----
  function request(loc, job, dry) {
    return {
      action: job.action,
      targets: [job.host.id],
      tiers: job.tiers || [],
      no_tiers: [],
      select: job.select || [],
      follow: job.follow || null,
      no_follow: !!job.noFollow,
      scope: scopeOf(loc),
      dry_run: dry,
    };
  }
  const runKit = (loc, job, dry) => invoke("kit_run", { request: request(loc, job, dry) });

  // The selection part of an install or apply job for one host. Returns a skip note instead when nothing can run.
  function selectionJob(loc, store, h, job) {
    const st = store.hs[h.id];
    job.action = installedHost(loc, h.id) ? "update" : "install";
    if (st.link) {
      const select = sorted(store.hs[st.link].origExplicit);
      if (!select.length) return `${h.label} skipped: ${hostOf(st.link).label} has no items.`;
      job.follow = st.link;
      job.select = select;
    } else if (st.origLink) {
      job.noFollow = true;
    } else {
      if (!st.explicit.size) return `${h.label} skipped: no items selected.`;
      job.select = sorted(st.explicit);
    }
    return null;
  }

  // Jobs for one toolbar or card action. Check and plain Update send no selection flags: the kit restores the saved
  // or followed selection. Only a legacy tier-only lock keeps its tier flags. Apply and Install send the staged
  // selection. Sources run before the hosts that follow them, and a source run already covers its followers.
  function jobsFor(kind, loc, store, only) {
    const jobs = [];
    const skipped = [];
    for (const h of HOSTS) {
      if (only && only !== h.id) continue;
      const job = { host: h };
      if (kind === "check" || kind === "update" || kind === "uninstall") {
        if (!installedHost(loc, h.id)) {
          if (kind !== "check") skipped.push(`${h.label} skipped: not installed.`);
          continue;
        }
        job.action = kind;
        const tiers = kind === "uninstall" ? null : legacyTiers(loc, store, h.id);
        if (tiers) job.tiers = tiers;
      } else {
        if (!store.hs) {
          skipped.push(`${h.label} skipped: the item list could not be read.`);
          continue;
        }
        if (kind === "install" && installedHost(loc, h.id)) {
          skipped.push(`${h.label} skipped: already installed. Change its items in the card, then apply.`);
          continue;
        }
        const note = selectionJob(loc, store, h, job);
        if (note) {
          skipped.push(note);
          continue;
        }
      }
      jobs.push(job);
    }
    const follower = (job) => !!job.follow || !!(store.hs && store.hs[job.host.id].origLink);
    jobs.sort((a, b) => Number(follower(a)) - Number(follower(b)));
    return { jobs, skipped };
  }

  // ---- painting ----
  const live = (key) => view && view.key === key && view.root.isConnected;

  function stateView(loc, store, h) {
    const hasStaged = staged(store, h);
    if (!loc.hosts[h]) return hasStaged ? { text: "Install staged", dot: "amber", title: "Items are staged for install. Apply them in the card." } : { text: "Not installed", dot: "off" };
    const s = store.states[h];
    // Staged edits beat the check result: the toolbar actions ignore them until they are applied.
    if (s.kind !== "checking" && hasStaged) return { text: "Items changed", dot: "amber", title: "Item changes are staged. Apply them in the card." };
    switch (s.kind) {
      case "checking":
        return { text: "Checking…", dot: "busy" };
      case "insync":
        return { text: "In sync", dot: "green" };
      case "changes":
        return { text: plural(s.count, "change"), dot: "amber" };
      case "lockonly":
        return { text: "Lock update", dot: "amber", title: "No files change, but the lock file needs an update." };
      case "failed":
        return { text: "Check failed", dot: "red", title: s.detail };
      default:
        return { text: "Not checked", dot: "off" };
    }
  }

  // Sidebar dot for a location: the worst known state across its installed hosts, or null before any check.
  function locationDot(key) {
    const loc = findLoc(key);
    if (!loc || !checkedOnce.has(key)) return null;
    const store = getStore(loc);
    const dots = HOSTS.filter((h) => loc.hosts[h.id]).map((h) => stateView(loc, store, h.id));
    if (!dots.length || dots.some((d) => d.dot === "busy" || d.dot === "off")) return null;
    const worst = dots.find((d) => d.dot === "red") || dots.find((d) => d.dot === "amber") || dots[0];
    return { dot: worst.dot, text: worst.text };
  }

  function inventoryBanner(store) {
    if (!store.inv || !store.inv.error) return null;
    const actions = KIT_PATH_HINT.test(store.inv.error)
      ? [el("button", { class: "btn", type: "button", text: "Open Kit Source", on: { click: () => zak.select("source") } })]
      : [];
    return zak.banner("error", `Could not read the kit items: ${store.inv.error}`, actions);
  }

  function paint(key) {
    if (zak.updateDots) zak.updateDots();
    if (!live(key)) return;
    const loc = findLoc(key);
    const store = getStore(loc);
    for (const h of HOSTS) {
      const r = view.rows[h.id];
      const sv = stateView(loc, store, h.id);
      r.dot.className = "dot " + sv.dot;
      r.text.textContent = sv.text;
      r.cell.title = sv.title || "";
      r.cell.classList.toggle("bad", sv.dot === "red");
    }
    view.checkBtn.disabled = store.busy;
    view.updateBtn.disabled = store.busy;
    view.moreBtn.disabled = store.busy;
    view.checkBtn.textContent = store.busy ? "Working…" : "Check";
    view.notes.replaceChildren(...store.notes.map((n) => el("li", { text: n })));
    view.notes.hidden = store.notes.length === 0;
    view.results.replaceChildren(...store.results.map((r) => zak.banner(r.kind, r.text)));
    const banner = inventoryBanner(store);
    view.inventory.replaceChildren(...(banner ? [banner] : []));
    view.paintCards();
  }

  async function runCheck(key) {
    const loc = findLoc(key);
    if (!loc) return;
    const store = getStore(loc);
    if (store.busy) return;
    store.busy = true;
    checkedOnce.add(key);
    paint(key);
    await loadInventory(key);
    const { jobs, skipped } = jobsFor("check", loc, store, null);
    store.notes = skipped;
    for (const h of HOSTS) store.states[h.id] = { kind: loc.hosts[h.id] ? "checking" : "idle" };
    paint(key);
    const reported = new Set();
    for (const job of jobs) {
      if (reported.has(job.host.id)) continue;
      let ids = new Set([job.host.id]);
      try {
        const res = await runKit(loc, job, false);
        ids = new Set([job.host.id, ...reportsOf(res, job.host.id).map((r) => r.host)]);
        for (const id of ids) store.states[id] = interpretCheck(res, id);
      } catch (e) {
        store.states[job.host.id] = { kind: "failed", detail: errText(e) };
      }
      for (const id of ids) {
        reported.add(id);
        const s = store.states[id];
        if (s.kind === "failed") store.notes = [...store.notes, `${hostOf(id).label} check failed: ${s.detail}`];
      }
      paint(key);
    }
    store.busy = false;
    paint(key);
  }

  // ---- plan sheet ----
  const opKey = (op) => `${normAction(op.action)}:${op.rel}`;
  const stripRoot = (rel, root) => (root && String(rel).startsWith(root + "/") ? String(rel).slice(root.length + 1) : String(rel));

  // Two path segments of the folder, without the host directory: skills/<name>/.
  function folderKey(rel) {
    const parts = rel.split("/").filter(Boolean);
    if (parts[0] === ".claude" || parts[0] === ".codex") parts.shift();
    const dirs = parts.slice(0, -1).slice(0, 2);
    return dirs.length ? dirs.join("/") + "/" : "(root)";
  }

  function groupNode(label, rels, cls, openAll) {
    const g = el("div", { class: "plan-group" + (cls ? " " + cls : "") });
    g.append(el("div", { class: "plan-action" }, el("span", { text: label }), el("span", { class: "count", text: plural(rels.length, "file") })));
    const folders = new Map();
    for (const rel of rels) {
      const key = folderKey(rel);
      if (!folders.has(key)) folders.set(key, []);
      folders.get(key).push(rel);
    }
    for (const [folder, files] of [...folders.entries()].sort((x, y) => x[0].localeCompare(y[0]))) {
      const d = el("details", { class: "plan-folder" });
      d.open = openAll || files.length <= 6;
      d.append(
        el("summary", {}, el("span", { class: "mono", text: folder }), el("span", { class: "count", text: String(files.length) })),
        el("ul", { class: "files mono" }, ...files.sort().map((f) => el("li", { text: f })))
      );
      g.append(d);
    }
    return g;
  }

  // "Items: −z-foo, +z-bar", removals first and in red.
  function itemsLine(store, delta) {
    const p = el("p", { class: "plan-tiers" }, el("span", { class: "muted", text: "Items: " }));
    const entries = [...delta.removed.map((id) => ({ id, removed: true })), ...delta.added.map((id) => ({ id, removed: false }))];
    entries.forEach((it, i) => {
      if (i) p.append(", ");
      p.append(el("span", { class: it.removed ? "bad" : "", text: (it.removed ? "−" : "+") + labelFor(store, it.id) }));
    });
    return p;
  }

  // The item and link lines of one plan section. A follower section reached through its source uses the source's
  // request.
  function sectionLines(store, p) {
    const out = [];
    const job = p.job;
    if (job && job.select && store.hs && store.hs[p.host.id]) {
      const delta = T.itemDelta(beforeSet(store, p.host.id), closureOf(store, job.select));
      if (delta.added.length || delta.removed.length) out.push(itemsLine(store, delta));
    }
    if (job && job.follow && p.host.id === job.host.id) out.push(el("p", { class: "plan-tiers", text: `Follows ${hostOf(job.follow).label}.` }));
    else if (job && job.noFollow && p.host.id === job.host.id) {
      const was = store.hs && store.hs[p.host.id].origLink;
      out.push(el("p", { class: "plan-tiers", text: was ? `Stops following ${hostOf(was).label}. Installed files stay.` : "Stops following." }));
    } else if (job && p.host.id !== job.host.id) out.push(el("p", { class: "plan-tiers", text: `Follows ${job.host.label}.` }));
    return out;
  }

  const OUTCOME_LABELS = { done: ["Done", "ok"], failed: ["Failed", "bad"], skipped: ["Not run", ""] };

  function planNode(store, plans, skipped, outcomes) {
    const root = el("div", { class: "plan" });
    for (const s of skipped) root.append(el("p", { class: "plan-note", text: s }));
    for (const p of plans) {
      const section = el("section", { class: "plan-host" });
      const head = el("div", { class: "plan-host-head" }, el("h3", { text: p.host.label }));
      section.append(head);
      const outcome = outcomes[p.host.id];
      if (outcome) {
        const [text, cls] = OUTCOME_LABELS[outcome.kind];
        head.append(el("span", { class: "count " + cls, text }));
      }
      for (const line of sectionLines(store, p)) section.append(line);
      if (outcome && outcome.detail) section.append(el("p", { class: "plan-error", text: outcome.detail }));
      if (p.error) {
        if (!outcome) head.append(el("span", { class: "count bad", text: "Failed" }));
        section.append(el("p", { class: "plan-error", text: p.error }));
        root.append(section);
        continue;
      }
      const problems = planProblems(p);
      if (!outcome) head.append(el("span", { class: "count", text: p.ops.length ? plural(p.ops.length, "file") : p.lockOnly ? "Lock update" : p.kept.length ? "Nothing to remove" : "No changes" }));
      if (problems.length) section.append(el("ul", { class: "plan-problems" }, ...problems.map((m) => el("li", { text: m }))));
      if (p.warnings.length) section.append(el("ul", { class: "plan-warnings" }, ...p.warnings.map((m) => el("li", { text: m }))));
      const groups = new Map();
      for (const op of p.ops) {
        const a = normAction(op.action);
        if (!groups.has(a)) groups.set(a, []);
        groups.get(a).push(stripRoot(op.rel, p.root));
      }
      const order = (a) => ["Remove", "Add", "Update"].indexOf(a) + 1 || 9;
      const byAction = [...groups.entries()].sort((x, y) => order(x[0]) - order(y[0]) || x[0].localeCompare(y[0]));
      for (const [action, rels] of byAction) section.append(groupNode(action, rels, action === "Remove" ? "remove" : "", action === "Remove"));
      if (p.kept.length) {
        section.append(groupNode("Kept (edited)", p.kept.map((r) => stripRoot(r, p.root)), "keep", false));
        section.append(el("p", { class: "plan-note", text: "Edited files stay in place. Only unedited kit files are removed." }));
      }
      root.append(section);
    }
    return root;
  }

  function planProblems(p) {
    const out = [];
    const res = p.res;
    if (res.exit_code !== 0) out.push(`The dry run exited with code ${res.exit_code}. ${firstLine(res.stderr) || firstLine(res.stdout)}`.trim());
    if (!p.rep) out.push("The dry run returned no report.");
    for (const m of p.problems) out.push(m);
    return out;
  }

  // Reads each section's dry-run report. Uninstall keeps edited files as conflicts: they are shown as kept, not
  // as blockers. Every other conflict or issue blocks the commit, and so does a non-zero exit code.
  function summarize(plans, action, loc) {
    let total = 0;
    let removes = 0;
    let kept = 0;
    let lockOnly = 0;
    let blocked = false;
    for (const p of plans) {
      if (p.error) {
        blocked = true;
        continue;
      }
      const rep = p.rep;
      const lock = loc.hosts[p.host.id];
      p.root = rep && rep.destination ? String(rep.destination) : lock ? String(lock.lock_path).replace(/\/[^/]*$/, "") : "";
      p.ops = rep ? (rep.operations || []).filter(isChange) : [];
      const conflicts = rep ? listOf(rep.conflicts) : [];
      const issues = rep ? listOf(rep.issues).map((m) => "Issue: " + m) : [];
      p.warnings = rep ? listOf(rep.warnings) : [];
      p.kept = action === "uninstall" ? (rep ? (rep.conflicts || []).map((c) => String(c.rel || describeItem(c))) : []) : [];
      p.problems = action === "uninstall" ? issues : [...conflicts.map((m) => "Conflict: " + m), ...issues];
      p.lockOnly = !!rep && rep.lockChange === true && p.ops.length === 0;
      if (p.res.exit_code !== 0 || !rep || p.problems.length) blocked = true;
      total += p.ops.length;
      removes += p.ops.filter((o) => normAction(o.action) === "Remove").length;
      kept += p.kept.length;
      if (p.lockOnly) lockOnly++;
    }
    let confirm;
    if (blocked) confirm = { label: "Cannot continue", disabled: true };
    else if (total === 0 && lockOnly > 0) confirm = { label: action === "uninstall" ? "Remove lock file" : "Update lock file" };
    else if (total === 0) confirm = { label: "Nothing to change", disabled: true };
    else if (action === "uninstall" || removes === total) confirm = { label: `Remove ${plural(total, "file")}`, danger: true };
    else if (removes > 0) confirm = { label: `${VERBS[action][0]} ${plural(total - removes, "file")}, remove ${removes}`, danger: true };
    else confirm = { label: `${VERBS[action][0]} ${plural(total, "file")}` };
    return { total, removes, kept, blocked, confirm };
  }

  // Judges one real (non-dry) run across every report it returned. Uninstall exit 2 with only kept files is a
  // finished removal. `bad` lists the hosts whose own report holds a problem.
  function judgeRun(res, action, asked) {
    const entries = reportsOf(res, asked);
    const kept = [];
    const bad = [];
    let detail = "";
    for (const { host, rep } of entries) {
      const issues = listOf(rep.issues);
      const conflicts = listOf(rep.conflicts);
      if (action === "uninstall" && res.exit_code === 2 && issues.length === 0 && conflicts.length > 0) {
        kept.push({ host, count: conflicts.length });
        continue;
      }
      if (issues.length || conflicts.length) {
        bad.push(host);
        if (!detail) detail = `${hostOf(host).label}: ${issues[0] || conflicts[0]}`;
      }
    }
    const finishedRemoval = action === "uninstall" && res.exit_code === 2 && entries.length > 0 && bad.length === 0;
    if (!entries.length || bad.length || (res.exit_code !== 0 && !finishedRemoval)) {
      return { ok: false, bad, entries, detail: detail || firstLine(res.stderr) || firstLine(res.stdout) || "exit code " + res.exit_code };
    }
    return { ok: true, bad, kept, entries };
  }

  // Files whose action differs between the plan and what the real run did (a release may have changed between).
  function driftCount(plan, rep) {
    const planned = new Set(plan.ops.map(opKey));
    const applied = new Set(((rep && rep.operations) || []).filter(isChange).map(opKey));
    let n = 0;
    for (const k of planned) if (!applied.has(k)) n++;
    for (const k of applied) if (!planned.has(k)) n++;
    return n;
  }

  // The plan sections one job produced: one per report, so a source apply lists the source and each follower.
  function sectionsOf(job, res) {
    const entries = reportsOf(res, job.host.id);
    if (!entries.length) return [{ host: job.host, job, res, rep: null }];
    return entries.map((e) => ({ host: hostOf(e.host), job, res, rep: e.rep }));
  }

  async function openPlan(kind, key, only) {
    const loc = findLoc(key);
    if (!loc) return;
    const store = getStore(loc);
    if (store.busy) return;
    const { jobs, skipped } = jobsFor(kind, loc, store, only || null);
    store.busy = true;
    store.results = [];
    paint(key);
    let touched = false;
    let plans = [];
    let outcomes = {};

    async function planAll() {
      plans = [];
      outcomes = {};
      ctl.setContent(el("p", { class: "loading", text: jobs.length ? "Planning changes…" : "Nothing to plan." }));
      ctl.setConfirm({ label: "Planning…", disabled: true });
      ctl.setStatus("");
      // The tree must equal what installs. Read the kit again and stop when its items changed under the page.
      if (jobs.some((j) => j.select || j.follow)) {
        const before = store.inv && store.inv.digest;
        const inv = await loadInventory(key);
        if (!inv || inv.error) {
          ctl.setContent(planNode(store, [], skipped, outcomes));
          ctl.setConfirm({ label: "Cannot continue", disabled: true });
          ctl.setStatus(`Could not read the kit items: ${inv ? inv.error : "no location"}`, "error");
          return;
        }
        if (inv.digest !== before) {
          ctl.setContent(planNode(store, [], skipped, outcomes));
          ctl.setConfirm({ label: "Cannot continue", disabled: true });
          ctl.setStatus("The kit changed after this page loaded. Review the tree, then apply again.", "error");
          return;
        }
      }
      const reported = new Set();
      for (const job of jobs) {
        if (reported.has(job.host.id)) continue;
        try {
          const res = await runKit(loc, job, true);
          const sections = sectionsOf(job, res);
          for (const s of sections) reported.add(s.host.id);
          plans.push(...sections);
        } catch (e) {
          plans.push({ host: job.host, job, error: errText(e) });
        }
      }
      const sum = summarize(plans, kind, loc);
      ctl.setContent(planNode(store, plans, skipped, outcomes));
      ctl.setConfirm(sum.confirm);
      if (sum.blocked) ctl.setStatus("Fix the problems listed above, then plan again. Nothing was changed.", "error");
      else if (sum.removes > 0 || sum.kept > 0) {
        const parts = [];
        if (sum.removes > 0) parts.push(`${plural(sum.removes, "file")} will be removed.`);
        if (sum.kept > 0) parts.push(`${plural(sum.kept, "edited file")} will be kept.`);
        ctl.setStatus(parts.join(" "), sum.removes > 0 ? "danger" : "warn");
      }
    }

    async function commit(c) {
      outcomes = {};
      for (const p of plans) outcomes[p.host.id] = { kind: "skipped" };
      const runnable = [];
      for (const p of plans) if (!p.error && !runnable.includes(p.job)) runnable.push(p.job);
      let failure = null;
      for (let i = 0; i < runnable.length && !failure; i++) {
        const job = runnable[i];
        c.setStatus(`${VERBS[kind][1]} ${job.host.label} (${i + 1} of ${runnable.length})…`);
        touched = true;
        try {
          const res = await runKit(loc, job, false);
          const j = judgeRun(res, kind, job.host.id);
          for (const e of j.entries) outcomes[e.host] = { kind: j.bad.includes(e.host) ? "failed" : j.ok ? "done" : "skipped" };
          if (!j.ok) {
            if (!j.entries.some((e) => e.host === job.host.id) || !j.bad.length) outcomes[job.host.id] = { kind: "failed" };
            throw new Error(j.detail);
          }
          for (const k of j.kept) store.results.push({ kind: "warn", text: `${hostOf(k.host).label}: finished with ${plural(k.count, "edited file")} kept. Remove them by hand if you want them gone.` });
          for (const e of j.entries) {
            const plan = plans.find((p) => p.job === job && p.host.id === e.host);
            const drift = plan ? driftCount(plan, e.rep) : 0;
            if (drift > 0) {
              store.results.push({ kind: "warn", text: `${hostOf(e.host).label}: the applied changes differ from the plan in ${plural(drift, "file")}. The kit release may have changed after the preview. The page is checking again.` });
            }
          }
        } catch (e) {
          failure = `${job.host.label}: ${errText(e).replace(/^Error: /, "")}`;
          if (outcomes[job.host.id].kind === "skipped") outcomes[job.host.id] = { kind: "failed" };
        }
      }
      if (!failure) return undefined;
      // Some hosts may already have changed, so the plan on screen is stale. Only a new dry run can continue.
      c.setContent(planNode(store, plans, skipped, outcomes));
      c.setStatus(failure, "error");
      c.setConfirm({ label: "Plan Again", run: async () => (await planAll(), { stay: true }) });
      c.setCancelLabel("Close");
      return { stay: true };
    }

    const ctl = zak.sheet({
      title: kind === "apply" ? `Apply changes on ${nameOf(loc)}` : `${VERBS[kind][0]} kit on ${nameOf(loc)}`,
      subtitle: loc.path || "Global install",
      subtitleMono: loc.path != null,
      content: el("p", { class: "loading", text: "Planning changes…" }),
      confirm: { label: "Planning…", disabled: true },
      onConfirm: commit,
    });
    await planAll();

    await ctl.done;
    store.busy = false;
    if (touched) {
      await zak.refreshInstalls();
      runCheck(key);
    } else {
      paint(key);
    }
  }

  // ---- page ----
  function lockDirs(loc) {
    const dirs = HOSTS.map((h) => loc.hosts[h.id]).filter(Boolean).map((l) => String(l.lock_path).replace(/\/[^/]*$/, ""));
    if (dirs.length) return [...new Set(dirs)].join(" · ");
    return loc.path == null ? "~/.claude · ~/.codex" : loc.path;
  }

  // What one host would change: "Install 3 items. Remove 1 item. Follow Claude Code."
  function changeInfo(store, h) {
    const st = store.hs[h];
    const delta = T.itemDelta(beforeSet(store, h), afterSet(store, h));
    const parts = [];
    if (delta.added.length) parts.push(`Install ${plural(delta.added.length, "item")}.`);
    if (delta.removed.length) parts.push(`Remove ${plural(delta.removed.length, "item")}.`);
    let n = delta.added.length + delta.removed.length;
    if (st.link && st.link !== st.origLink) {
      parts.push(`Follow ${hostOf(st.link).label}.`);
      n++;
    } else if (!st.link && st.origLink) {
      parts.push(`Stop following ${hostOf(st.origLink).label}.`);
      n++;
    }
    return { text: parts.join(" "), n };
  }

  // One card per host: its version and state, the link row, the item tree (or the follower summary), and its own
  // Apply, Revert and Update. Edits only stage changes; Apply runs that host's changes through the plan sheet.
  function agentCards(loc, store, key, rows) {
    const grid = el("div", { class: "agent-grid" });
    const cards = HOSTS.map((h) => {
      const dot = el("span", { class: "dot off" });
      const text = el("span", { class: "status-text" });
      const cell = el("span", { class: "state" }, dot, text);
      rows[h.id] = { dot, text, cell };
      const lock = loc.hosts[h.id];
      const body = el("div", { class: "agent-body" });
      const summary = el("p", { class: "agent-summary", "aria-live": "polite" });
      const actions = el("div", { class: "agent-actions" });
      const card = el(
        "section",
        { class: "group agent", "aria-labelledby": `agent-${h.id}` },
        el(
          "header",
          { class: "agent-head" },
          el("div", { class: "agent-title" }, el("h3", { id: `agent-${h.id}`, text: h.label }), lock && el("span", { class: "muted num", text: `Kit ${lock.kit_version}` })),
          cell
        ),
        body,
        el("div", { class: "group-foot agent-foot" }, summary, actions)
      );
      return { h, body, summary, actions, card };
    });
    grid.append(...cards.map((c) => c.card));

    const treeCache = { inv: null, tree: null };
    function treeFor(inv) {
      if (treeCache.inv !== inv) {
        treeCache.inv = inv;
        treeCache.tree = T.buildTree(inv.items, inv.tiers);
      }
      return treeCache.tree;
    }

    function setItem(h, id, on) {
      const st = store.hs[h.id];
      if (on) st.explicit.add(id);
      else st.explicit.delete(id);
      paint(key);
    }
    function setNode(h, ids) {
      const st = store.hs[h.id];
      const checked = closureOf(store, st.explicit);
      st.explicit = T.toggleNode(st.explicit, ids, checked, T.requiredBy(checked, itemsOf(store)));
      paint(key);
    }
    function setExpanded(h, nodeKey) {
      const k = `${h.id}|${nodeKey}`;
      if (store.expanded.has(k)) store.expanded.delete(k);
      else store.expanded.add(k);
      paint(key);
    }
    function setLink(h, on) {
      const st = store.hs[h.id];
      st.link = on ? otherOf(h.id) : null;
      st.explicit = new Set(st.origExplicit);
      paint(key);
    }
    function revert(h) {
      const st = store.hs[h.id];
      st.explicit = new Set(st.origExplicit);
      st.link = st.origLink;
      paint(key);
    }

    // Why the "Same as" switch is off for this host, or "" when it works.
    function linkBlock(h) {
      const other = hostOf(otherOf(h.id));
      if (!loc.hosts[other.id]) return `Install ${other.label} first.`;
      if (store.hs[other.id].link === h.id) return `${other.label} follows this agent.`;
      return "";
    }

    function paintBody(c) {
      const { h } = c;
      const inv = store.inv;
      if (!inv) return [el("p", { class: "loading card-note", text: "Reading items…" })];
      if (inv.error) return [el("p", { class: "muted card-note", text: "Items are unavailable. Check and Update still work from the lock." })];
      const st = store.hs[h.id];
      if (st.error) return [el("p", { class: "plan-error card-note", text: `Could not read the lock: ${st.error}` })];
      const other = hostOf(otherOf(h.id));
      const reason = linkBlock(h);
      const nodes = [
        V.linkRow({ hostId: h.id, otherLabel: other.label, on: !!st.link, disabled: store.busy || !!reason, reason, onChange: (on) => setLink(h, on) }),
      ];
      if (st.link) {
        nodes.push(V.summary(T.followSummary(other.label, closureOf(store, store.hs[other.id].origExplicit).size, inv.items.length)));
        return nodes;
      }
      const checked = closureOf(store, st.explicit);
      const before = beforeSet(store, h.id);
      const unlinking = !!st.origLink;
      nodes.push(
        V.tree({
          hostId: h.id,
          hostLabel: h.label,
          tree: treeFor(inv),
          checked,
          locked: T.requiredBy(checked, inv.items),
          changed: (id) => checked.has(id) !== before.has(id),
          expanded: { has: (k) => store.expanded.has(`${h.id}|${k}`) },
          disabled: store.busy || unlinking,
          reason: unlinking ? `Apply to stop following ${other.label} first.` : "",
          onItem: (id, on) => setItem(h, id, on),
          onNode: (ids) => setNode(h, ids),
          onExpand: (k) => setExpanded(h, k),
        })
      );
      return nodes;
    }

    function paintFoot(c) {
      const { h } = c;
      const lock = loc.hosts[h.id];
      const ready = !!store.inv && !store.inv.error && !!store.hs && !store.hs[h.id].error;
      if (ready && staged(store, h.id)) {
        const info = changeInfo(store, h.id);
        const st = store.hs[h.id];
        const empty = !!lock && !st.link && !st.origLink && closureOf(store, st.explicit).size === 0;
        c.summary.className = "agent-summary";
        c.summary.textContent = empty ? "Select at least one item. Use Uninstall… under More to remove the kit." : info.text;
        c.actions.replaceChildren(
          el("button", { class: "btn", type: "button", text: "Revert", disabled: store.busy, on: { click: () => revert(h) } }),
          el("button", { class: "btn", type: "button", text: `Apply ${plural(info.n, "Change")}…`, disabled: store.busy || empty, on: { click: () => openPlan("apply", key, h.id) } })
        );
        return;
      }
      c.summary.className = "agent-summary muted";
      if (!lock) c.summary.textContent = "Check items to install the kit.";
      else if (ready) c.summary.textContent = `${plural(beforeSet(store, h.id).size, "item")} installed.`;
      else c.summary.textContent = `${plural(lock.tiers.length, "tier")} installed.`;
      c.actions.replaceChildren(
        el("button", { class: "btn", type: "button", text: "Update…", disabled: store.busy || !lock, title: lock ? `Update the installed items on ${h.label}.` : "", on: { click: () => openPlan("update", key, h.id) } })
      );
    }

    function paintCards() {
      // Rows are rebuilt on every change, so keep keyboard focus on the same control.
      const focused = grid.contains(document.activeElement) ? document.activeElement.getAttribute("data-focus") : null;
      for (const c of cards) {
        c.body.replaceChildren(...paintBody(c));
        paintFoot(c);
      }
      V.restoreFocus(grid, focused);
    }

    paintCards();
    return { node: el("div", { class: "agents" }, grid), paintCards };
  }

  function render(container, key) {
    container.replaceChildren();
    const I = zak.state.installs;
    if (!I) {
      const retry = el("button", { class: "btn", type: "button", text: "Try Again", on: { click: () => zak.refreshInstalls() } });
      container.append(
        el("div", { class: "toolbar", "data-tauri-drag-region": true }, el("div", { class: "titles" }, el("h1", { text: "This Mac" }))),
        zak.state.installsError
          ? el("div", { class: "empty" }, el("h2", { text: "Could not read installs" }), el("p", { text: zak.state.installsError }), retry)
          : el("div", { class: "empty" }, el("p", { class: "loading", text: "Reading lock files…" }))
      );
      view = null;
      return;
    }
    const loc = findLoc(key);
    if (!loc) {
      container.append(el("div", { class: "empty" }, el("h2", { text: "Project not found" }), el("p", { text: "It is no longer in the project list." })));
      view = null;
      return;
    }
    if (zak.cliInstall.missing()) {
      container.append(
        el("div", { class: "toolbar", "data-tauri-drag-region": true }, el("div", { class: "titles", "data-tauri-drag-region": true }, el("h1", { text: nameOf(loc) }))),
        zak.cliInstall.emptyState()
      );
      view = null;
      return;
    }
    const store = getStore(loc);
    const rows = {};
    const agents = agentCards(loc, store, key, rows);

    const checkBtn = el("button", { class: "btn", type: "button", text: "Check", on: { click: () => runCheck(key) } });
    const updateBtn = el("button", { class: "btn primary", type: "button", text: "Update…", on: { click: () => openPlan("update", key) } });
    const moreBtn = el("button", { class: "btn", type: "button" }, el("span", { text: "More" }), icon("chevron"));
    zak.attachMenu(moreBtn, () => [
      { label: "Install…", onSelect: () => openPlan("install", key) },
      { label: "Uninstall…", onSelect: () => openPlan("uninstall", key), danger: true },
      ...(loc.path != null ? [{ separator: true }, { label: "Remove from List…", onSelect: () => removeProject(loc) }] : []),
    ]);

    const toolbar = el(
      "div",
      { class: "toolbar", "data-tauri-drag-region": true },
      el("div", { class: "titles", "data-tauri-drag-region": true }, el("h1", { text: nameOf(loc) }), el("p", { class: "sub mono", text: lockDirs(loc), title: loc.path || "" })),
      el("div", { class: "actions" }, checkBtn, el("div", { class: "menu-wrap" }, moreBtn), updateBtn)
    );

    const notes = el("ul", { class: "notes", "aria-live": "polite", hidden: true });
    const results = el("div", { class: "results", "aria-live": "polite" });
    const inventory = el("div", { class: "results", "aria-live": "polite" });
    const bodyEl = el("div", { class: "page-body" });
    if (loc.error) bodyEl.append(zak.banner("error", `Could not read a lock file: ${loc.error}`));
    bodyEl.append(results, inventory, el("p", { class: "help", text: HELP }), agents.node, notes);
    container.append(toolbar, bodyEl);

    view = { key, root: container, rows, checkBtn, updateBtn, moreBtn, notes, results, inventory, paintCards: agents.paintCards };
    paint(key);
    // A page open reads the kit items again. The first open does it as part of Check.
    if (!checkedOnce.has(key)) runCheck(key);
    else if (!store.busy) loadInventory(key);
  }

  function removeProject(loc) {
    const key = keyOf(loc);
    const ctl = zak.sheet({
      title: `Remove “${nameOf(loc)}” from the list?`,
      subtitle: loc.path,
      content: el("p", { text: "This only forgets the project in this app. Kit files in the project stay where they are." }),
      confirm: { label: "Remove from List", danger: true },
      onConfirm: () => invoke("project_remove", { path: loc.path }),
    });
    ctl.done.then(async (ok) => {
      if (!ok) return;
      stores.delete(key);
      checkedOnce.delete(key);
      await zak.refreshInstalls();
      zak.select("global");
    });
  }

  zak.pages.installs = {
    render,
    locationDot,
    // Items follow the lock files again after every refresh. The next page open reads the inventory.
    onRefresh() {
      for (const s of stores.values()) {
        s.inv = null;
        s.hs = null;
      }
    },
  };
})();
