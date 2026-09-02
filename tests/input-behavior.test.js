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
  const selectors = new Map();
  const node = {
    value: "",
    textContent: "",
    _innerHTML: "",
    children: [],
    dataset: {},
    classList: {
      add() {},
      remove() {},
      toggle() {},
      contains() { return false; }
    },
    addEventListener() {},
    appendChild(child) {
      child.parentNode = this;
      this.children.push(child);
    },
    focus() {},
    querySelector(selector) {
      if (!selectors.has(selector)) {
        const child = element();
        if (selector === ".preset-select") {
          const selected = this._innerHTML.match(/<option value="([^"]*)" selected>/);
          child.value = selected ? selected[1] : "";
        }
        selectors.set(selector, child);
      }
      return selectors.get(selector);
    },
    querySelectorAll(selector) {
      return selector === ".adjust-row"
        ? this.children.filter((child) => child.className === "adjust-row")
        : [];
    },
    remove() {
      if (!this.parentNode) return;
      this.parentNode.children = this.parentNode.children.filter((child) => child !== this);
    },
    select() {}
  };
  Object.defineProperty(node, "innerHTML", {
    get() { return this._innerHTML; },
    set(value) {
      this._innerHTML = value;
      if (value === "") this.children = [];
    }
  });
  return node;
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
    parseMoney, formatInput, getRows, collectData, calculate, updateResults, saveCurrent,
    addRow, setup,
    readStore, refreshSavedList, loadSelected
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

test("別表4の空欄と明示的な0はどちらも0として計算する", () => {
  const { api, document } = loadBeppyou();
  for (const value of [undefined, ""]) {
    const input = { value };
    assert.equal(api.parseMoney(value), undefined);
    assert.equal(api.formatInput(input), true);
    assert.equal(input.value, "");
  }
  assert.equal(api.parseMoney("0"), 0);
  assert.equal(api.parseMoney(0), 0);
  const zeroInput = { value: "0" };
  assert.equal(api.formatInput(zeroInput), true);
  assert.equal(zeroInput.value, "0");

  assert.equal(api.updateResults(), true);
  assert.equal(document.getElementById("income-amount").textContent, "0円");

  document.getElementById("current-profit").value = "0";
  document.getElementById("loss-carryforward").value = "0";
  assert.equal(api.updateResults(), true);
  assert.equal(document.getElementById("income-amount").textContent, "0円");
});

test("別表4の初期表示後に当期利益を入力すると所得金額を計算する", () => {
  const { api, document } = loadBeppyou();
  api.setup();

  assert.equal(document.getElementById("additions-list").children.length, 1);
  assert.equal(document.getElementById("subtractions-list").children.length, 1);
  assert.equal(document.getElementById("afterTentative-list").children.length, 1);
  document.getElementById("current-profit").value = "5,000,000";

  assert.equal(api.updateResults(), true);
  assert.equal(document.getElementById("income-amount").textContent, "5,000,000円");
  assert.notEqual(document.getElementById("income-amount").textContent, "0円");
});

test("別表4の空行はgetRowsの集計対象に含めない", () => {
  const { api } = loadBeppyou();
  api.addRow("additions");
  assert.equal(api.getRows("additions").length, 0);
});

test("別表4の数字なし文字列は入力エラーになり、値を消さない", () => {
  const { api, document } = loadBeppyou();
  const input = { value: "not-a-number" };
  assert.equal(api.parseMoney(input.value), null);
  assert.equal(api.formatInput(input), false);
  assert.equal(input.value, "not-a-number");
  document.getElementById("current-profit").value = input.value;
  document.getElementById("loss-carryforward").value = "0";
  assert.equal(api.updateResults(), false);
  assert.match(document.getElementById("storage-status").textContent, /当期利益又は当期欠損の額/);
});

test("別表4の巨大桁は入力エラーになり、値を消さない", () => {
  const { api, document } = loadBeppyou();
  const input = { value: "9".repeat(400) };
  assert.equal(api.parseMoney(input.value), null);
  assert.equal(api.formatInput(input), false);
  assert.equal(input.value, "9".repeat(400));
  document.getElementById("current-profit").value = input.value;
  document.getElementById("loss-carryforward").value = "0";
  assert.equal(api.updateResults(), false);
  assert.match(document.getElementById("storage-status").textContent, /当期利益又は当期欠損の額/);
});

test("別表4の無効入力はlocalStorageへ保存しない", () => {
  const { api, document, storage } = loadBeppyou();
  document.getElementById("current-profit").value = "-";
  document.getElementById("loss-carryforward").value = "0";
  assert.equal(api.saveCurrent(), false);
  assert.equal(storage.raw, null);
  assert.match(document.getElementById("storage-status").textContent, /当期利益又は当期欠損の額/);
});

test("別表4の有効入力は従来の算式どおりに計算する", () => {
  const { api } = loadBeppyou();
  const result = api.calculate({
    currentProfit: 1000000,
    additions: [{ amount: 250000 }],
    subtractions: [{ amount: 100000 }],
    afterTentative: [{ amount: 50000 }],
    lossCarryforward: 200000
  });
  assert.equal(result.additionTotal, 250000);
  assert.equal(result.subtractionTotal, 100000);
  assert.equal(result.tentative, 1150000);
  assert.equal(result.afterTentativeTotal, 50000);
  assert.equal(result.total, 1200000);
  assert.equal(result.income, 1000000);
});

// 構文エラーだけは空の保存領域へ救済される現状を固定する。
test("別表4の空欄は0として計算しつつ、どの欄を0にしたか画面に出す", () => {
  const { api, document } = loadBeppyou();
  api.setup();
  api.addRow("additions", "custom", "交際費", "");

  assert.equal(api.updateResults(), true);
  const notice = document.getElementById("input-notice");
  assert.equal(notice.hidden, false);
  assert.match(notice.textContent, /^空欄を0円として計算しました: /);
  assert.ok(notice.textContent.includes("当期利益又は当期欠損の額"));
  assert.ok(notice.textContent.includes("加算「交際費」"));
});

test("別表4の空欄を埋めると告知が消え、無効入力のときは結果の上に無効欄を出す", () => {
  const { api, document } = loadBeppyou();
  api.setup();
  const notice = document.getElementById("input-notice");

  document.getElementById("current-profit").value = "1,000,000";
  document.getElementById("loss-carryforward").value = "0";
  assert.equal(api.updateResults(), true);
  assert.equal(notice.hidden, true);
  assert.equal(notice.textContent, "");

  document.getElementById("current-profit").value = "not-a-number";
  assert.equal(api.updateResults(), false);
  assert.equal(notice.hidden, false);
  assert.equal(notice.textContent, "無効な金額欄があります: 当期利益又は当期欠損の額");
});

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
