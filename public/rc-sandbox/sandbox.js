// Synced from https://dancing-road.web.app on 2026-11-27 by scripts/sync-rc-sandbox.mjs. Do not edit; change the QC web page and sync again.
"use strict";
// RC Sandbox tab. Drafts never touch Firebase Remote Config.
const state = { drafts: [], template: null, schema: null, current: null, base: null, variant: 0, dirty: false,
	mode: "drafts", fbFilter: "all", fbSelected: null };

const api = (method, path, body) => App.api(method, path, body);

// Connection ---------------------------------------------------------------

async function connect() {
	setStatus("Loading…");
	try {
		const [drafts, schema] = await Promise.all([api("GET", "/drafts"), api("GET", "/schema")]);
		state.drafts = drafts.drafts;
		state.schema = schema.schema;
		$("newBtn").disabled = false;
		$("cloneBtn").disabled = false;
		$("fetchBtn").disabled = false;
		setStatus("Connected · " + state.drafts.length + " drafts");
		renderDraftList();
		loadTemplate();
	} catch (e) {
		setStatus(e.message, true);
	}
}

async function loadTemplate() {
	try {
		state.template = await api("GET", "/template");
		const keys = new Set();
		for (const c of state.template.conditions) Object.keys(c.values).forEach((k) => keys.add(k));
		if (state.schema) Object.keys(state.schema.fields || {}).forEach((k) => keys.add(k));
		$("knownKeys").innerHTML = [...keys].sort().map((k) => "<option value=\"" + esc(k) + "\">").join("");
		if (state.current) renderEditor();
		renderFbHeader();
		renderFbList();
		if (state.mode === "firebase") renderViewer();
	} catch (e) {
		setStatus("Could not read Firebase template: " + e.message, true);
	}
}

// Draft list ---------------------------------------------------------------

function ago(ms) {
	const s = Math.max(1, Math.round((Date.now() - ms) / 1000));
	if (s < 60) return s + "s ago";
	if (s < 3600) return Math.round(s / 60) + " min ago";
	if (s < 86400) return Math.round(s / 3600) + " h ago";
	return new Date(ms).toLocaleDateString();
}

function renderDraftList() {
	const q = $("draftSearch").value.trim().toLowerCase();
	const list = state.drafts.filter((d) => !q || d.name.toLowerCase().includes(q) || d.author.toLowerCase().includes(q));
	$("draftList").innerHTML = list.length ? list.map((d) => {
		const active = state.current && state.current.id === d.id ? " active" : "";
		const variants = d.variants.length > 1 ? "<span class=\"pill ab\">" + d.variants.length + " variants</span>" : "";
		return "<div class=\"draft" + active + "\" data-id=\"" + esc(d.id) + "\"><div class=\"name\">" + esc(d.name) + variants +
			"</div><div class=\"meta\">" + esc(d.author || "unknown") + " · " + ago(d.updatedAt) + "</div></div>";
	}).join("") : "<div class=\"dim\" style=\"padding:12px\">No drafts yet.</div>";
}

function confirmDiscard() {
	return true;
}

function openDraft(draft, isNew) {
	if (!confirmDiscard()) return;
	state.current = JSON.parse(JSON.stringify(draft));
	state.base = isNew ? null : draft.updatedAt;
	state.variant = 0;
	setDirty(!!isNew);
	renderDraftList();
	renderEditor();
}

function newDraft(name, source, variants) {
	return { id: null, name, note: "", author: App.userName(), source: source || "", variants, updatedAt: 0 };
}

// Editor -------------------------------------------------------------------

function setDirty(dirty) {
	state.dirty = dirty;
	$("dirty").textContent = dirty ? "● Unsaved changes" : "";
}

function renderEditor() {
	if (state.mode === "firebase") {
		["emptyState", "editor", "saveBar"].forEach((id) => $(id).classList.add("hidden"));
		return;
	}
	$("viewer").classList.add("hidden");
	const d = state.current;
	$("emptyState").classList.toggle("hidden", !!d);
	$("editor").classList.toggle("hidden", !d);
	$("saveBar").classList.toggle("hidden", !d);
	if (!d) return;
	$("draftName").value = d.name;
	$("draftNote").value = d.note;
	$("draftSource").textContent = d.source ? "Cloned from Firebase condition: " + d.source : "";
	$("deleteBtn").classList.toggle("hidden", !d.id);
	$("schemaHint").innerHTML = state.schema
		? "Checked against the game's fields from <b>" + esc(state.schema.platform || "?") + " " + esc(state.schema.appVersion || "?") +
		  "</b> (" + Object.keys(state.schema.fields || {}).length + " fields, uploaded " + ago(state.schema.uploadedAt) + ")."
		: "The game's field list is not uploaded yet, so keys the game would ignore can't be flagged. Open <b>DevInfo → RC Conditions</b> once in an admin build on a device to upload it.";
	renderTabs();
	renderKeys();
	if (showingChanges) renderChanges();
}

function renderTabs() {
	const d = state.current;
	$("tabs").innerHTML = d.variants.map((v, i) =>
		"<button class=\"tab" + (i === state.variant ? " active" : "") + "\" data-i=\"" + i + "\">" + esc(v.name || ("Variant " + (i + 1))) + "</button>").join("");
	$("variantName").value = d.variants[state.variant].name;
	$("delVariantBtn").disabled = d.variants.length <= 1;
}

function sourceValues() {
	if (!state.template || !state.current.source) return null;
	const variant = state.current.variants[state.variant];
	const exact = state.template.conditions.find((c) => c.name === variant.source) ||
		state.template.conditions.find((c) => c.name === state.current.source);
	return exact ? exact.values : null;
}

function renderKeys() {
	const values = state.current.variants[state.variant].values;
	const original = sourceValues();
	const keys = Object.keys(values).sort();
	$("keys").innerHTML = keys.length ? keys.map((key) => {
		const changed = original && original[key] !== undefined && normalize(original[key]) !== normalize(values[key]) ? "<span class=\"pill changed\">EDITED</span>" : "";
		const added = original && original[key] === undefined ? "<span class=\"pill changed\">NEW</span>" : "";
		return "<div class=\"card\" data-key=\"" + esc(key) + "\"><div class=\"head\"><span class=\"key\">" + esc(key) + changed + added + "</span>" +
			"<button class=\"small\" data-act=\"format\">Format JSON</button>" +
			"<button class=\"small\" data-act=\"copy\">Copy value</button>" +
			(changed ? "<button class=\"small\" data-act=\"revert\">Revert to Firebase</button>" : "") +
			"<button class=\"small danger\" data-act=\"remove\">Remove</button></div>" +
			"<textarea rows=\"" + rowsFor(values[key]) + "\" spellcheck=\"false\">" + esc(values[key]) + "</textarea>" +
			"<div class=\"checks\">" + checksHtml(key, values[key]) + "</div></div>";
	}).join("") : "<div class=\"dim\" style=\"margin:10px 0 16px\">No keys in this variant yet. Add one below.</div>";
}

// Same content regardless of spacing, so pretty-printing never counts as an edit
function normalize(raw) {
	const p = parseJson(raw);
	return p.error || p.value === null || typeof p.value !== "object" ? String(raw) : JSON.stringify(p.value);
}

function pretty(raw) {
	const p = parseJson(raw);
	return !p.error && p.value !== null && typeof p.value === "object" ? JSON.stringify(p.value, null, 2) : raw;
}

function prettyAll(values) {
	const out = {};
	for (const [k, v] of Object.entries(values)) out[k] = pretty(v);
	return out;
}

function rowsFor(value) {
	return Math.min(16, Math.max(2, String(value).split("\n").length));
}

// Validation: follows the same naming rules as RemoteConfig.cs ---------------

function parseJson(raw) {
	try { return { value: JSON.parse(raw) }; } catch (e) { return { error: e.message }; }
}

function isObject(v) { return v !== null && typeof v === "object" && !Array.isArray(v); }

function fieldsOf(key, raw) {
	const out = { fields: [], notes: [] };
	if (key.startsWith("GroupSettings_")) {
		if (raw.trim() === "") { out.notes.push(["info", "Empty: this group sets nothing (control group)."]); return out; }
		const p = parseJson(raw);
		if (p.error || !isObject(p.value)) { out.error = "Not a valid JSON object: the game skips the whole key. " + (p.error || ""); return out; }
		for (const [name, v] of Object.entries(p.value)) {
			if (name.startsWith("GroupSettings_")) { out.notes.push(["bad", name + ": a group inside a group is skipped."]); continue; }
			if (name.includes("Settings")) {
				const nested = isObject(v) ? v : (typeof v === "string" ? parseJson(v).value : null);
				if (!isObject(nested)) { out.notes.push(["bad", name + ": not a JSON object, skipped."]); continue; }
				const prefix = name.split("Settings").join("");
				for (const [sub, sv] of Object.entries(nested)) out.fields.push({ name: prefix + sub, value: sv, plain: false });
			} else {
				out.fields.push({ name, value: v, plain: false });
			}
		}
	} else if (key.includes("Settings")) {
		const p = parseJson(raw);
		if (p.error || !isObject(p.value)) { out.error = "Not a valid JSON object: the game skips the whole key. " + (p.error || ""); return out; }
		const prefix = key.split("Settings").join("");
		for (const [sub, sv] of Object.entries(p.value)) out.fields.push({ name: prefix + sub, value: sv, plain: false });
	} else {
		out.fields.push({ name: key, value: raw, plain: true });
	}
	return out;
}

function isNum(v) { return typeof v === "number" || (typeof v === "string" && v.trim() !== "" && !isNaN(Number(v))); }
function isInt(v) { return isNum(v) && Number.isInteger(Number(v)); }

function typeProblem(type, field) {
	const v = field.value;
	if (field.plain) {
		const s = String(v).trim();
		if (type === "bool" && !/^(true|false|1|0)$/i.test(s)) return "expects true / false";
		if ((type === "int" || type === "long") && !/^-?\d+$/.test(s)) return "expects a whole number";
		if (type === "float" && !isNum(s)) return "expects a number";
		return null;
	}
	if (type === "bool" && !(typeof v === "boolean" || v === 0 || v === 1 || v === "0" || v === "1")) return "expects true / false";
	if ((type === "int" || type === "long") && !isInt(v)) return "expects a whole number";
	if (type === "float" && !isNum(v)) return "expects a number";
	if (type === "int[]" && !(Array.isArray(v) && v.every(isInt))) return "expects a list of whole numbers, e.g. [1, 2]";
	return null;
}

function checksHtml(key, raw) {
	const r = fieldsOf(key, raw);
	if (r.error) return "<div class=\"line bad\">✕ " + esc(r.error) + "</div>";
	const lines = r.notes.map(([cls, text]) => "<div class=\"line " + cls + "\">" + esc(text) + "</div>");
	const fields = state.schema && state.schema.fields;
	if (!fields) {
		if (r.fields.length) lines.push("<div class=\"line info\">Sets " + r.fields.length + " field(s). Game field list not loaded, names not checked.</div>");
		return lines.join("");
	}
	const ignored = [], wrong = [];
	let ok = 0;
	for (const f of r.fields) {
		const type = fields[f.name];
		if (!type) { ignored.push(f.name); continue; }
		const problem = typeProblem(type, f);
		if (problem) wrong.push(f.name + " " + problem); else ok++;
	}
	if (ok) lines.push("<div class=\"line ok\">✓ " + ok + " field(s) the game reads</div>");
	for (const w of wrong) lines.push("<div class=\"line warn\">⚠ " + esc(w) + "</div>");
	if (ignored.length) {
		const shown = ignored.slice(0, 4).map(esc).join(", ");
		const more = ignored.length > 4 ? " and " + (ignored.length - 4) + " more" : "";
		lines.push("<details class=\"line bad\"><summary>✕ " + ignored.length + " field(s) the game ignores (not in this build, or misspelled): " +
			shown + more + "</summary>" + ignored.map((n) => "<div class=\"mono\" style=\"padding-left:18px\">" + esc(n) + "</div>").join("") + "</details>");
	}
	return lines.join("");
}

// Firebase RC browser (read only) -------------------------------------------

function setMode(mode) {
	state.mode = mode;
	$("modeDrafts").classList.toggle("active", mode === "drafts");
	$("modeFirebase").classList.toggle("active", mode === "firebase");
	$("draftPane").classList.toggle("hidden", mode !== "drafts");
	$("firebasePane").classList.toggle("hidden", mode !== "firebase");
	renderEditor();
	if (mode === "firebase") renderViewer();
}

function platformOf(expression) {
	const ios = expression.includes(":ios:"), android = expression.includes(":android:");
	return ios === android ? "any" : (ios ? "ios" : "android");
}

function isAb(c) { return /\[abt_\d+ v\d+\]/.test(c.name); }

function op(o) { return { ">=": "≥", "<=": "≤", "==": "=" }[o] || o; }

function countries(list) {
	const codes = list.replace(/'/g, "").split(",").map((x) => x.trim()).filter(Boolean);
	return codes.slice(0, 5).join(", ") + (codes.length > 5 ? " +" + (codes.length - 5) : "");
}

// Short readable version of a console expression, e.g. "version ≥ 3.3.8 · country VN, US"
function humanize(expression) {
	const s = expression
		.replace(/app\.id\s*==\s*'[^']*:(ios|android):[^']*'/g, "")
		.replace(/app\.(version|build)\.(>=|<=|==|>|<)\(\[([^\]]*)\]\)/g, (m, a, o, v) => a + " " + op(o) + " " + v.replace(/'/g, ""))
		.replace(/app\.(version|build)\.(exactlyMatches|matches|contains|notContains)\(\[([^\]]*)\]\)/g,
			(m, a, o, v) => a + " " + ({ exactlyMatches: "=", notContains: "not containing", contains: "containing" }[o] || "matching") + " " + v.replace(/'/g, ""))
		.replace(/device\.country in \[([^\]]*)\]/g, (m, v) => "country " + countries(v))
		.replace(/app\.firstOpenTimestamp\s*(>=|<=|>|<)\s*\(\s*'([^']*)'[^)]*\)/g, (m, o, d) => "first open " + op(o) + " " + d.slice(0, 10))
		.replace(/dateTime\s*(>=|<=|>|<)\s*dateTime\(\s*'([^']*)'[^)]*\)/g, (m, o, d) => "date " + op(o) + " " + d.slice(0, 10));
	return s.split("&&").map((x) => x.trim().replace(/\|\|/g, "or")).filter(Boolean).join(" · ");
}

function platformPill(p) {
	return p === "ios" ? "<span class=\"pill ios\">iOS</span>" : p === "android" ? "<span class=\"pill android\">Android</span>" : "<span class=\"pill\">All platforms</span>";
}

function renderFbHeader() {
	const t = state.template;
	if (!t) return;
	const when = t.publishedAt ? new Date(t.publishedAt).toLocaleString() : "";
	$("fbVersion").innerHTML = "<b>Template v" + esc(t.version) + "</b>" + (when ? "<br>" + esc(when) : "") +
		(t.publishedBy ? " · " + esc(t.publishedBy.split("@")[0]) : "");
}

function fbPasses(c) {
	switch (state.fbFilter) {
		case "ios": return platformOf(c.expression) === "ios";
		case "android": return platformOf(c.expression) === "android";
		case "ab": return isAb(c);
		case "rollout": return c.rolloutKeys.length > 0;
		default: return true;
	}
}

function renderFbList() {
	if (!state.template) { $("fbList").innerHTML = "<div class=\"dim\" style=\"padding:12px\">Press Fetch.</div>"; return; }
	const q = $("fbSearch").value.trim().toLowerCase();
	const list = state.template.conditions.filter((c) => fbPasses(c) && (!q || c.name.toLowerCase().includes(q) || c.expression.toLowerCase().includes(q)));
	$("fbList").innerHTML = list.map((c) => {
		const p = platformOf(c.expression);
		const summary = humanize(c.expression);
		const n = Object.keys(c.values).length;
		const pills = (isAb(c) ? "<span class=\"pill ab\">A/B</span>" : "") + (c.rolloutKeys.length ? "<span class=\"pill rollout\">ROLLOUT</span>" : "");
		return "<div class=\"cond-row " + p + (state.fbSelected === c.name ? " active" : "") + "\" data-name=\"" + esc(c.name) + "\"><div class=\"name\">" +
			esc(c.name) + pills + "</div><div class=\"meta\">" + (summary ? esc(summary) + " · " : "") + n + (n === 1 ? " key" : " keys") + "</div></div>";
	}).join("") || "<div class=\"dim\" style=\"padding:12px\">No condition matches.</div>";
}

function asText(v) { return typeof v === "string" ? v : JSON.stringify(v); }

// What a user who matches no condition gets: every default value merged the way the game does
function baselineFields() {
	const map = {};
	const defaults = (state.template && state.template.defaults) || {};
	const keys = Object.keys(defaults);
	const ordered = keys.filter((k) => !k.startsWith("GroupSettings_")).concat(keys.filter((k) => k.startsWith("GroupSettings_")).sort());
	for (const k of ordered) {
		const r = fieldsOf(k, defaults[k]);
		if (!r.error) for (const f of r.fields) map[f.name] = asText(f.value);
	}
	return map;
}

function fieldDiffHtml(key, raw, base) {
	const r = fieldsOf(key, raw);
	if (r.error) return "<div class=\"checks\"><div class=\"line bad\">✕ " + esc(r.error) + "</div></div>";
	const fields = state.schema && state.schema.fields;
	const changed = [], same = [], ignored = [];
	for (const f of r.fields) {
		if (fields && !fields[f.name]) { ignored.push(f); continue; }
		if (base[f.name] === asText(f.value)) same.push(f); else changed.push(f);
	}
	let html = "<div class=\"checks\">" + r.notes.map(([cls, t]) => "<div class=\"line " + cls + "\">" + esc(t) + "</div>").join("") +
		"<div class=\"line info\">" + changed.length + " differ from default · " + same.length + " same as default" +
		(ignored.length ? " · <span class=\"bad\">" + ignored.length + " ignored by the game</span>" : "") +
		(fields ? "" : " · game field list not loaded, names not checked") + "</div></div>";
	if (changed.length || ignored.length) {
		html += "<table class=\"diff\">";
		for (const f of changed) {
			const before = base[f.name];
			html += "<tr><td class=\"f\">" + esc(f.name) + "</td><td class=\"old\">" + (before === undefined ? "<i>not in RC (code default)</i>" : esc(before)) +
				"</td><td class=\"new\">→ " + esc(asText(f.value)) + "</td></tr>";
		}
		for (const f of ignored) {
			html += "<tr><td class=\"f bad\">✕ " + esc(f.name) + "</td><td class=\"bad\" colspan=\"2\">not in the game: ignored (check the spelling or key name)</td></tr>";
		}
		html += "</table>";
	}
	if (same.length) {
		html += "<details class=\"checks\"><summary class=\"info\">Show " + same.length + " field(s) equal to default</summary><table class=\"diff\">" +
			same.map((f) => "<tr class=\"same\"><td class=\"f\">" + esc(f.name) + "</td><td colspan=\"2\">" + esc(asText(f.value)) + "</td></tr>").join("") + "</table></details>";
	}
	return html;
}

function renderViewer() {
	const viewer = $("viewer");
	["emptyState", "editor", "saveBar"].forEach((id) => $(id).classList.add("hidden"));
	viewer.classList.remove("hidden");
	const c = state.template && state.template.conditions.find((x) => x.name === state.fbSelected);
	if (!c) {
		viewer.innerHTML = "<div class=\"empty\"><h2>Firebase Remote Config</h2><p>" +
			(state.template ? "Pick a condition on the left to see what it changes compared with the default." : "Connect, then press <b>Fetch</b> to load the live template.") +
			"<br>This view is read only.</p></div>";
		return;
	}
	const base = baselineFields();
	const pills = (isAb(c) ? "<span class=\"pill ab\">A/B</span>" : "") + (c.rolloutKeys.length ? "<span class=\"pill rollout\">ROLLOUT</span>" : "");
	let html = "<div class=\"vhead\"><h2>" + esc(c.name) + pills + "</h2><div class=\"sub\">" + platformPill(platformOf(c.expression)) + " " + esc(humanize(c.expression)) + "</div>" +
		"<details><summary>Raw condition expression</summary><div class=\"mono\" style=\"margin-top:6px\">" + esc(c.expression) + "</div></details>" +
		"<div class=\"actions\"><button class=\"primary\" id=\"viewerClone\">Clone to sandbox draft</button></div></div>";
	for (const key of Object.keys(c.values).sort()) {
		const raw = c.values[key];
		const rollout = c.rolloutKeys.includes(key) ? "<span class=\"pill rollout\">ROLLOUT</span>" : "";
		html += "<div class=\"card\" data-key=\"" + esc(key) + "\"><div class=\"head\"><span class=\"key\">" + esc(key) + rollout + "</span>" +
			"<button class=\"small\" data-act=\"copyraw\">Copy value</button></div>" + fieldDiffHtml(key, raw, base) +
			"<details class=\"checks\"><summary class=\"info\">Show raw value</summary><pre class=\"raw\">" + esc(pretty(raw)) + "</pre></details></div>";
	}
	viewer.innerHTML = html;
	$("main").scrollTop = 0;
}

// Clone --------------------------------------------------------------------

function renderCloneList() {
	if (!state.template) { $("cloneList").innerHTML = "<div class=\"dim\">Loading Firebase template…</div>"; return; }
	const q = $("cloneSearch").value.trim().toLowerCase();
	const list = state.template.conditions.filter((c) => !q || c.name.toLowerCase().includes(q) || c.expression.toLowerCase().includes(q));
	$("cloneList").innerHTML = list.map((c) => {
		const ab = /\[abt_/.test(c.name) ? "<span class=\"pill ab\">A/B</span>" : "";
		return "<div class=\"cond\" data-name=\"" + esc(c.name) + "\"><div><b>" + esc(c.name) + "</b>" + ab + "</div><div class=\"meta mono\">" +
			esc(c.expression.slice(0, 160)) + " · " + Object.keys(c.values).length + " key(s)</div></div>";
	}).join("") || "<div class=\"dim\">No match.</div>";
}

function cloneCondition(name) {
	const all = state.template.conditions;
	const ab = /^(.*) \[(abt_\d+) v\d+\]$/.exec(name);
	let draft;
	if (ab) {
		const group = all.filter((c) => c.name.startsWith(ab[1] + " [" + ab[2] + " v"));
		draft = newDraft(ab[1] + " " + ab[2] + " (copy)", ab[1] + " [" + ab[2] + "]",
			group.map((c) => ({ name: /\[abt_\d+ (v\d+)\]/.exec(c.name)[1], values: prettyAll(c.values), source: c.name })));
	} else {
		const c = all.find((x) => x.name === name);
		draft = newDraft(name + " (copy)", name, [{ name: "Default", source: name, values: prettyAll(c.values) }]);
	}
	$("cloneDialog").close();
	setMode("drafts");
	openDraft(draft, true);
}

// Save / delete ------------------------------------------------------------

function draftPayload() {
	const d = state.current;
	return {
		name: d.name, note: d.note, source: d.source,
		variants: d.variants.map((v) => ({ name: v.name, source: v.source || "", values: v.values })),
		baseUpdatedAt: state.base,
	};
}

async function save() {
	const d = state.current;
	if (!d) return;
	if (!d.name.trim()) { setStatus("Give the draft a name first", true); return; }
	const invalid = [];
	d.variants.forEach((v) => Object.entries(v.values).forEach(([k, raw]) => { if (fieldsOf(k, raw).error) invalid.push(v.name + " → " + k); }));
	setStatus("Saving…");
	try {
		const res = d.id ? await api("PUT", "/drafts/" + encodeURIComponent(d.id), draftPayload()) : await api("POST", "/drafts", draftPayload());
		const saved = res.draft;
		state.current = saved;
		state.base = saved.updatedAt;
		const i = state.drafts.findIndex((x) => x.id === saved.id);
		if (i >= 0) state.drafts[i] = saved; else state.drafts.unshift(saved);
		setDirty(false);
		setStatus("Saved · " + new Date(saved.updatedAt).toLocaleTimeString());
		renderDraftList();
		renderEditor();
	} catch (e) {
		setStatus(e.message, true);
	}
}

async function removeDraft() {
	const d = state.current;
	if (!d || !d.id) return;
	// Deleting cannot be undone: the first click arms the button, the second deletes
	const btn = $("deleteBtn");
	if (!btn.dataset.armed) {
		btn.dataset.armed = "1";
		btn.textContent = "Click again to delete";
		setTimeout(() => { delete btn.dataset.armed; btn.textContent = "Delete draft"; }, 3000);
		return;
	}
	delete btn.dataset.armed;
	btn.textContent = "Delete draft";
	try {
		await api("DELETE", "/drafts/" + encodeURIComponent(d.id));
		state.drafts = state.drafts.filter((x) => x.id !== d.id);
		state.current = null;
		setDirty(false);
		setStatus("Deleted");
		renderDraftList();
		renderEditor();
	} catch (e) {
		setStatus(e.message, true);
	}
}

// Events -------------------------------------------------------------------

$("draftSearch").addEventListener("input", renderDraftList);
$("modeDrafts").addEventListener("click", () => setMode("drafts"));
$("modeFirebase").addEventListener("click", () => setMode("firebase"));
$("fetchBtn").addEventListener("click", async () => {
	$("fetchBtn").disabled = true;
	setStatus("Fetching Firebase template…");
	await loadTemplate();
	$("fetchBtn").disabled = false;
	if (state.template) setStatus("Fetched template v" + state.template.version);
});
$("fbSearch").addEventListener("input", renderFbList);
$("fbChips").addEventListener("click", (e) => {
	const b = e.target.closest("button");
	if (!b) return;
	state.fbFilter = b.dataset.f;
	[...$("fbChips").children].forEach((x) => x.classList.toggle("on", x === b));
	renderFbList();
});
$("fbList").addEventListener("click", (e) => {
	const el = e.target.closest(".cond-row");
	if (!el) return;
	state.fbSelected = el.dataset.name;
	renderFbList();
	renderViewer();
});
$("viewer").addEventListener("click", async (e) => {
	if (e.target.id === "viewerClone") {
		if (confirmDiscard()) { setDirty(false); cloneCondition(state.fbSelected); }
		return;
	}
	if (e.target.dataset && e.target.dataset.act === "copyraw") {
		const key = e.target.closest(".card").dataset.key;
		const c = state.template.conditions.find((x) => x.name === state.fbSelected);
		const p = parseJson(c.values[key]);
		await navigator.clipboard.writeText(p.error ? c.values[key] : JSON.stringify(p.value));
		setStatus("Copied " + key);
	}
});
$("draftList").addEventListener("click", (e) => {
	const el = e.target.closest(".draft");
	if (el) openDraft(state.drafts.find((d) => d.id === el.dataset.id), false);
});
$("newBtn").addEventListener("click", () => openDraft(newDraft("New draft", "", [{ name: "Default", values: {} }]), true));
$("cloneBtn").addEventListener("click", () => { renderCloneList(); $("cloneDialog").showModal(); $("cloneSearch").focus(); });
$("cloneClose").addEventListener("click", () => $("cloneDialog").close());
$("cloneSearch").addEventListener("input", renderCloneList);
$("cloneList").addEventListener("click", (e) => {
	const el = e.target.closest(".cond");
	if (el && confirmDiscard()) { setDirty(false); cloneCondition(el.dataset.name); }
});

$("draftName").addEventListener("input", (e) => { state.current.name = e.target.value; setDirty(true); });
$("draftNote").addEventListener("input", (e) => { state.current.note = e.target.value; setDirty(true); });
$("tabs").addEventListener("click", (e) => {
	const el = e.target.closest(".tab");
	if (!el) return;
	state.variant = Number(el.dataset.i);
	renderTabs();
	renderKeys();
});
$("variantName").addEventListener("input", (e) => {
	state.current.variants[state.variant].name = e.target.value;
	setDirty(true);
	const tab = $("tabs").children[state.variant];
	if (tab) tab.textContent = e.target.value || ("Variant " + (state.variant + 1));
});
$("addVariantBtn").addEventListener("click", () => {
	const d = state.current;
	if (d.variants.length >= 8) { setStatus("A draft holds at most 8 variants", true); return; }
	d.variants.push({ name: "Variant " + (d.variants.length + 1), values: {} });
	state.variant = d.variants.length - 1;
	setDirty(true);
	renderTabs();
	renderKeys();
});
$("dupVariantBtn").addEventListener("click", () => {
	const d = state.current;
	if (d.variants.length >= 8) { setStatus("A draft holds at most 8 variants", true); return; }
	const src = d.variants[state.variant];
	d.variants.push({ name: src.name + " copy", source: src.source, values: Object.assign({}, src.values) });
	state.variant = d.variants.length - 1;
	setDirty(true);
	renderTabs();
	renderKeys();
});
$("delVariantBtn").addEventListener("click", () => {
	const d = state.current;
	if (d.variants.length <= 1) return;
	d.variants.splice(state.variant, 1);
	state.variant = 0;
	setDirty(true);
	renderTabs();
	renderKeys();
});

function addKey() {
	const key = $("newKey").value.trim();
	const values = state.current.variants[state.variant].values;
	if (!/^[A-Za-z0-9_]{1,128}$/.test(key)) { setStatus("Key names use letters, numbers and _ only", true); return; }
	if (values[key] !== undefined) { setStatus(key + " is already in this variant", true); return; }
	values[key] = key.includes("Settings") ? "{}" : "";
	$("newKey").value = "";
	setDirty(true);
	renderKeys();
}
$("addKeyBtn").addEventListener("click", addKey);
$("newKey").addEventListener("keydown", (e) => { if (e.key === "Enter") addKey(); });

$("keys").addEventListener("input", (e) => {
	if (e.target.tagName !== "TEXTAREA") return;
	const card = e.target.closest(".card");
	const key = card.dataset.key;
	state.current.variants[state.variant].values[key] = e.target.value;
	card.querySelector(".checks").innerHTML = checksHtml(key, e.target.value);
	setDirty(true);
});
$("keys").addEventListener("click", async (e) => {
	const act = e.target.dataset && e.target.dataset.act;
	if (!act) return;
	const card = e.target.closest(".card");
	const key = card.dataset.key;
	const values = state.current.variants[state.variant].values;
	if (act === "remove") {
		delete values[key];
		setDirty(true);
		renderKeys();
	} else if (act === "format") {
		const p = parseJson(values[key]);
		if (p.error) { setStatus(key + " is not valid JSON: " + p.error, true); return; }
		values[key] = JSON.stringify(p.value, null, 2);
		setDirty(true);
		renderKeys();
	} else if (act === "copy") {
		const p = parseJson(values[key]);
		await navigator.clipboard.writeText(p.error ? values[key] : JSON.stringify(p.value));
		setStatus("Copied " + key + " (compact, ready for the Firebase console)");
	} else if (act === "revert") {
		const original = sourceValues();
		if (original && original[key] !== undefined) { values[key] = pretty(original[key]); setDirty(true); renderKeys(); }
	}
});

$("saveBtn").addEventListener("click", save);
$("deleteBtn").addEventListener("click", removeDraft);
document.addEventListener("keydown", (e) => {
	// Only while the sandbox is on screen, so it does not catch Ctrl+S when embedded with other tools
	if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s" && $("editor").offsetParent) { e.preventDefault(); save(); }
});

App.registerTab("sandbox", { start: connect });

// Send to a test device -----------------------------------------------------
// Two ways: queue it for a device the game has registered, or show a QR code
// that opens the game on the phone. Either way the game asks before applying.

const send = { devices: [], tab: "device" };

async function openSendDialog() {
	const d = state.current;
	if (!d) return;
	if (state.dirty || !d.id) {
		await save();
		if (state.dirty || !state.current.id) return;
	}
	const v = state.current.variants[state.variant];
	$("sendTitle").textContent = "Send \"" + state.current.name + (state.current.variants.length > 1 ? " · " + v.name : "") + "\" to a test device";
	$("sendResult").textContent = "";
	$("qrBox").innerHTML = "";
	$("qrInfo").textContent = "";
	setSendTab("device");
	$("sendDialog").showModal();
	loadDevices();
}

function setSendTab(tab) {
	send.tab = tab;
	$("sendTabDevice").classList.toggle("active", tab === "device");
	$("sendTabQr").classList.toggle("active", tab === "qr");
	$("sendDevicePane").classList.toggle("hidden", tab !== "device");
	$("sendQrPane").classList.toggle("hidden", tab !== "qr");
	if (tab === "qr" && !$("qrBox").innerHTML) makeQr();
}

async function loadDevices() {
	$("deviceList").innerHTML = "<div class=\"dim\">Loading devices…</div>";
	try {
		send.devices = (await api("GET", "/devices")).devices;
		renderDevices();
	} catch (e) {
		$("deviceList").innerHTML = "<div class=\"bad\">" + esc(e.message) + "</div>";
	}
}

function renderDevices() {
	$("deviceList").innerHTML = send.devices.length ? send.devices.map((d) => {
		const online = Date.now() - d.lastSeen < 60 * 1000;
		return "<div class=\"device\"><div><div class=\"name\"><span class=\"dot" + (online ? " on" : "") + "\"></span>" + esc(d.code) +
			" <span class=\"dim\">· " + esc(d.model || "unknown device") + "</span></div><div class=\"meta\">" +
			esc(d.platform) + " " + esc(d.appVersion) + " · " + (online ? "online now" : "seen " + ago(d.lastSeen)) +
			(d.pending ? " · <span class=\"warn\">has a draft waiting</span>" : "") + "</div></div>" +
			"<button class=\"good small\" data-code=\"" + esc(d.code) + "\">Send</button></div>";
	}).join("") : "<div class=\"dim\">No test device yet. Open <b>DevInfo → RC Conditions</b> on the phone once (admin build, key entered); its code shows at the top of that popup and it appears here.</div>";
}

async function sendToDevice(code) {
	$("sendResult").textContent = "Sending…";
	try {
		await api("POST", "/push", { draftId: state.current.id, variant: state.variant, deviceCode: code });
		$("sendResult").innerHTML = "<span class=\"ok\">Sent to " + esc(code) + ".</span> If the game is open it shows the draft within ~20 seconds; " +
			"otherwise when the game is opened or brought back to the front. The tester still taps <b>Apply</b> there.";
		loadDevices();
	} catch (e) {
		$("sendResult").innerHTML = "<span class=\"bad\">" + esc(e.message) + "</span>";
	}
}

async function makeQr() {
	$("qrBox").innerHTML = "<div class=\"dim\">Creating QR…</div>";
	try {
		const res = await api("POST", "/push", { draftId: state.current.id, variant: state.variant });
		const qr = qrcode(0, "M");
		qr.addData(res.deepLink);
		qr.make();
		$("qrBox").innerHTML = qr.createSvgTag({ cellSize: 7, margin: 3, scalable: true });
		$("qrInfo").innerHTML = "Scan with the test phone's camera. It opens Dancing Road (admin build) and shows this draft ready to apply.<br>" +
			"Valid for 30 minutes · <span class=\"mono\">" + esc(res.deepLink) + "</span>";
	} catch (e) {
		$("qrBox").innerHTML = "<div class=\"bad\">" + esc(e.message) + "</div>";
	}
}

$("sendBtn").addEventListener("click", openSendDialog);
$("sendClose").addEventListener("click", () => $("sendDialog").close());
$("sendTabDevice").addEventListener("click", () => setSendTab("device"));
$("sendTabQr").addEventListener("click", () => setSendTab("qr"));
$("refreshDevices").addEventListener("click", loadDevices);
$("newQr").addEventListener("click", makeQr);
$("deviceList").addEventListener("click", (e) => {
	const code = e.target.dataset && e.target.dataset.code;
	if (code) sendToDevice(code);
});

// What a draft changes ------------------------------------------------------
// Merges each variant the way the game does (plain and *_Settings keys first,
// GroupSettings_* last) and compares every field with the Firebase default.

let showingChanges = false;

function variantFields(values) {
	const map = {}, broken = [];
	const keys = Object.keys(values);
	const ordered = keys.filter((k) => !k.startsWith("GroupSettings_")).concat(keys.filter((k) => k.startsWith("GroupSettings_")).sort());
	for (const k of ordered) {
		const r = fieldsOf(k, values[k]);
		if (r.error) { broken.push(k); continue; }
		for (const f of r.fields) map[f.name] = asText(f.value);
	}
	return { map, broken };
}

function setChangesView(on) {
	showingChanges = on;
	$("viewEdit").classList.toggle("active", !on);
	$("viewChanges").classList.toggle("active", on);
	$("editPane").classList.toggle("hidden", on);
	$("changes").classList.toggle("hidden", !on);
	if (on) renderChanges();
}

function renderChanges() {
	const d = state.current;
	if (!d || !showingChanges) return;
	if (!state.template) { $("changes").innerHTML = "<div class=\"dim\">Loading Firebase defaults…</div>"; return; }
	const base = baselineFields();
	const schemaFields = state.schema && state.schema.fields;
	const variants = d.variants.map((v) => variantFields(v.values));

	const names = new Set();
	variants.forEach((v) => Object.keys(v.map).forEach((n) => names.add(n)));
	const rows = [];
	let ignored = 0;
	for (const name of [...names].sort()) {
		const differs = variants.some((v) => v.map[name] !== undefined && v.map[name] !== base[name]);
		const isIgnored = !!schemaFields && !schemaFields[name];
		if (!differs && !isIgnored) continue;
		if (isIgnored) ignored++;
		rows.push({ name, isIgnored });
	}
	const broken = [];
	variants.forEach((v, i) => v.broken.forEach((k) => broken.push((d.variants[i].name || "Variant " + (i + 1)) + " → " + k)));

	let html = "<div class=\"chgsum\">" +
		"<div class=\"box\"><b>" + (rows.length - ignored) + "</b>field(s) differ from Firebase default</div>" +
		"<div class=\"box\"><b class=\"" + (ignored ? "bad" : "") + "\">" + ignored + "</b>field(s) the game ignores</div>" +
		"<div class=\"box\"><b class=\"" + (broken.length ? "bad" : "") + "\">" + broken.length + "</b>key(s) with broken JSON</div></div>";
	if (!schemaFields) html += "<div class=\"hint\">The game's field list is not uploaded yet, so ignored fields can't be detected.</div>";
	if (broken.length) html += "<div class=\"checks\">" + broken.map((b) => "<div class=\"line bad\">✕ " + esc(b) + ": not valid JSON, the game skips this key</div>").join("") + "</div>";

	if (!rows.length) {
		html += "<div class=\"dim\" style=\"margin-top:12px\">This draft sets nothing different from what users get by default.</div>";
	} else {
		html += "<table class=\"matrix\"><tr><th class=\"f\">Field</th><th>Firebase default</th>" +
			d.variants.map((v, i) => "<th>" + esc(v.name || "Variant " + (i + 1)) + "</th>").join("") + "</tr>";
		for (const row of rows) {
			const def = base[row.name];
			html += "<tr class=\"" + (row.isIgnored ? "ignored" : "") + "\"><td class=\"f\">" + (row.isIgnored ? "✕ " : "") + esc(row.name) +
				(row.isIgnored ? "<div class=\"bad\" style=\"font-family:inherit\">not in the game, ignored</div>" : "") + "</td>" +
				"<td class=\"def\">" + (def === undefined ? "<i>not in RC (code default)</i>" : esc(def)) + "</td>" +
				variants.map((v) => {
					const value = v.map[row.name];
					if (value === undefined) return "<td class=\"same\">—</td>";
					return "<td class=\"" + (value === def ? "same" : "diff") + "\">" + esc(value) + "</td>";
				}).join("") + "</tr>";
		}
		html += "</table><div class=\"dim\" style=\"font-size:12px;margin-top:8px\">— means the variant does not set this field, so the user keeps what they already have. " +
			"Compared with the default value; users who match other Firebase conditions may already have different values.</div>";
	}
	$("changes").innerHTML = html;
}

$("viewEdit").addEventListener("click", () => setChangesView(false));
$("viewChanges").addEventListener("click", () => setChangesView(true));
