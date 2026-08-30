const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");

function inlineScript(fileName) {
  const html = fs.readFileSync(path.join(root, fileName), "utf8");
  const scripts = Array.from(html.matchAll(/<script>([\s\S]*?)<\/script>/g));
  assert.ok(scripts.length, `${fileName} must contain an inline script`);
  return scripts.at(-1)[1].replace(/\nsetup\(\);\s*$/, "\n");
}

function element() {
  return {
    value: "",
    textContent: "",
    innerHTML: "",
    children: [],
    classList: {
      add() {},
      remove() {},
      toggle() {},
      contains() { return false; }
    },
    addEventListener() {},
    appendChild(child) { this.children.push(child); },
    focus() {},
    querySelector() { return element(); },
    querySelectorAll() { return []; },
    remove() {},
    select() {}
  };
}

function documentStub() {
  const elements = new Map();
  return {
    createElement() { return element(); },
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, element());
      return elements.get(id);
    },
    querySelector() { return element(); },
    querySelectorAll() { return []; }
  };
}

function loadBeppyou() {
  const storage = { raw: null };
  const document = documentStub();
  const context = vm.createContext({
    console,
    document,
    localStorage: {
      getItem() { return storage.raw; },
      setItem(_key, value) { storage.raw = value; }
    }
  });
  const expose = `\nglobalThis.testApi = {
    parseMoney, formatInput, readStore, refreshSavedList, loadSelected
  };`;
  vm.runInContext(inlineScript("beppyou4-keisan.html") + expose, context);
  return { api: context.testApi, document, storage };
}

function loadNozei() {
  const document = documentStub();
  const context = vm.createContext({ console, document, location: { search: "" } });
  const expose = `\nglobalThis.testApi = {
    state, normalizeMoneyText, updateStateFromInput, formatInputValue,
    formatYen, calculateCorporate
  };`;
  vm.runInContext(inlineScript("nozei-calendar.html") + expose, context);
  return { api: context.testApi, document };
}

function moneyInput(value) {
  return {
    value,
    dataset: { path: "corporate.prevYear.corpTax" },
    classList: { add() {}, remove() {} }
  };
}

// これは現状固定であって望ましい挙動ではない。修正時は期待値を未入力と0の区別へ反転する。
test("現状固定（望ましい挙動ではない）: 別表4の未入力と空文字は0になり、修正時は期待値を反転して未入力と0を区別する", () => {
  const { api } = loadBeppyou();
  for (const value of [undefined, ""]) {
    const input = { value };
    assert.equal(api.parseMoney(value), 0);
    api.formatInput(input);
    assert.equal(input.value, "");
  }
});

// これは現状固定であって望ましい挙動ではない。修正時は期待値を入力エラーへ反転する。
test("現状固定（望ましい挙動ではない）: 別表4の数字なし文字列は0と空欄になり、修正時は期待値を入力エラーへ反転する", () => {
  const { api } = loadBeppyou();
  const input = { value: "not-a-number" };
  assert.equal(api.parseMoney(input.value), 0);
  api.formatInput(input);
  assert.equal(input.value, "");
});

// これは現状固定であって望ましい挙動ではない。修正時は期待値を桁超過エラーへ反転する。
test("現状固定（望ましい挙動ではない）: 別表4の巨大桁は0と空欄になり、修正時は期待値を桁超過エラーへ反転する", () => {
  const { api } = loadBeppyou();
  const input = { value: "9".repeat(400) };
  assert.equal(api.parseMoney(input.value), 0);
  api.formatInput(input);
  assert.equal(input.value, "");
});

// 構文エラーだけは空の保存領域へ救済される現状を固定する。
test("現状固定: 別表4の壊れたJSONは空の保存領域として救済される", () => {
  const { api, storage } = loadBeppyou();
  storage.raw = "{";
  const store = api.readStore();
  assert.equal(store.version, "1.0");
  assert.equal(Object.keys(store.savedSets).length, 0);
});

// これは現状固定であって望ましい挙動ではない。修正時は期待値を安全な無視へ反転する。
test("現状固定（望ましい挙動ではない）: 別表4の形が壊れたsavedSetsは例外になり、修正時は期待値を安全な無視へ反転する", () => {
  const { api, storage } = loadBeppyou();
  storage.raw = JSON.stringify({ savedSets: { broken: null } });
  assert.throws(() => api.refreshSavedList(""), /null|name/);
});

// これは現状固定であって望ましい挙動ではない。修正時は期待値を安全な拒否へ反転する。
test("現状固定（望ましい挙動ではない）: 別表4の形が壊れたdataはfillRowsで例外になり、修正時は期待値を安全な拒否へ反転する", () => {
  const { api, document, storage } = loadBeppyou();
  storage.raw = JSON.stringify({
    savedSets: { broken: { name: "Sample", data: "invalid-shape" } }
  });
  document.getElementById("saved-select").value = "broken";
  assert.throws(() => api.loadSelected(), /forEach/);
});

// これは現状固定であって望ましい挙動ではない。修正時は期待値を未入力または入力エラーへ反転する。
test("現状固定（望ましい挙動ではない）: 納税カレンダーの未入力・空文字・数字なし文字列は空欄と0になり、修正時は期待値を未入力またはエラーへ反転する", () => {
  const { api } = loadNozei();
  for (const value of [undefined, "", "not-a-number"]) {
    const input = moneyInput(value);
    api.updateStateFromInput(input);
    assert.equal(input.value, "");
    assert.equal(api.state.corporate.prevYear.corpTax, 0);
  }
});

// これは現状固定であって望ましい挙動ではない。修正時は期待値を不正文字エラーへ反転する。
test("現状固定（望ましい挙動ではない）: 納税カレンダーの混在する不正文字は黙って除かれ、修正時は期待値を入力エラーへ反転する", () => {
  const { api } = loadNozei();
  const input = moneyInput("12abc3");
  api.updateStateFromInput(input);
  assert.equal(input.value, "123");
  assert.equal(api.state.corporate.prevYear.corpTax, 123);
});

// これは現状固定であって望ましい挙動ではない。修正時は期待値を有限値または桁数エラーへ反転する。
test("現状固定（望ましい挙動ではない）: 納税カレンダーの巨大桁はInfinityで表示・計算され、修正時は期待値を有限値または桁数エラーへ反転する", () => {
  const { api } = loadNozei();
  const huge = "9".repeat(400);
  const input = moneyInput(huge);
  api.updateStateFromInput(input);

  assert.equal(input.value, huge);
  assert.equal(api.state.corporate.prevYear.corpTax, Infinity);
  assert.equal(api.formatInputValue(Infinity), "∞");
  assert.equal(api.formatYen(Infinity), "∞円");

  api.state.corporate.fiscalMonth = 3;
  const result = api.calculateCorporate();
  const finalEvent = result.events.find((event) => event.taxKey === "corpTax" && event.deadlineType === "確定");
  assert.equal(finalEvent.amount, Infinity);
});
