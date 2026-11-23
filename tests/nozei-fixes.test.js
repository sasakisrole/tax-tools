const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const html = fs.readFileSync(path.join(__dirname, "..", "nozei-calendar.html"), "utf8");
const scripts = Array.from(html.matchAll(/<script>([\s\S]*?)<\/script>/g), (match) => match[1]);
assert.ok(scripts.length, "インラインスクリプトがある");

function element(tagName = "", dataPath = "", classes = []) {
  const listeners = new Map();
  const classNames = new Set(classes);
  return {
    tagName,
    dataset: { path: dataPath },
    value: "",
    innerHTML: "",
    textContent: "",
    classList: {
      add(name) { classNames.add(name); },
      remove(name) { classNames.delete(name); },
      contains(name) { return classNames.has(name); }
    },
    addEventListener(type, callback) { listeners.set(type, callback); },
    dispatch(type) { listeners.get(type)(); },
    appendChild() {},
    select() {}
  };
}

function loadPage() {
  const byId = new Map();
  const inputs = Array.from(html.matchAll(/<(input|select)\b([^>]*\bdata-path="([^"]+)"[^>]*)>/g), (match) => {
    const classes = match[2].match(/\bclass="([^"]*)"/)?.[1].split(/\s+/) ?? [];
    return element(match[1].toUpperCase(), match[3], classes);
  });
  const document = {
    getElementById(id) {
      if (!byId.has(id)) byId.set(id, element());
      return byId.get(id);
    },
    createElement: () => element(),
    querySelectorAll(selector) {
      if (selector === "[data-path]") return inputs;
      assert.equal(selector, 'select[data-path="corporate.fiscalMonth"]');
      return inputs.filter((input) => input.dataset.path === "corporate.fiscalMonth");
    }
  };
  const context = vm.createContext({ document, location: { search: "?nozeitest=1" } });
  vm.runInContext(
    "globalThis.window = globalThis; globalThis.Date = class extends Date {" +
    "  constructor(...args) { super(...(args.length ? args : [2026, 3, 1, 12])); }" +
    "};",
    context
  );
  for (const script of scripts) vm.runInContext(script, context, { filename: "nozei-calendar.html" });

  return {
    api: context.nozeiTestApi,
    input: inputs.find((input) => input.dataset.path === "corporate.prevYear.corpTax"),
    warning: () => document.getElementById("validation-message").textContent,
    result: (tab) => document.getElementById(tab + "-result").innerHTML
  };
}

function interimDates(events) {
  return Array.from(
    events.filter((event) => event.taxKey === "consumptionNational" && event.deadlineType === "中間"),
    (event) => [event.year, event.month, event.date.getDate()].join("/")
  );
}

function scheduleRows(result) {
  return new Map(Array.from(result.matchAll(/<tr data-month="(\d+)" data-year="(\d+)"[^>]*>([\s\S]*?)<\/tr>/g),
    ([, month, year, body]) => [year + "/" + month, body]));
}

function assertInvalid(page, value, warning) {
  assert.equal(page.api.state.corporate.prevYear.corpTax, 0, value);
  assert.match(page.warning(), warning, value);
  assert.ok(page.input.classList.contains("invalid"), value);
  assert.equal(page.input.value, value);
}

test("REQ-1 符号から1文字ずつ打っても負数は0扱いのまま", () => {
  for (const sign of "-－ー―△▲") {
    const page = loadPage();
    page.input.dispatch("focus");
    let typed = "";
    for (const char of sign + "300000") {
      typed += char;
      page.input.value += char;
      page.input.dispatch("input");
      assertInvalid(page, typed, /負数/);
    }
    page.input.dispatch("change");
    assertInvalid(page, typed, /負数/);
  }
});

test("REQ-2 半角・全角の小数点は入力途中も貼り付けも0扱い", () => {
  for (const dot of ".．") {
    const page = loadPage();
    for (const value of ["200000", "200000" + dot, "200000" + dot + "5"]) {
      page.input.value = value;
      page.input.dispatch("input");
      if (value.includes(dot)) {
        assertInvalid(page, value, /小数/);
      } else {
        assert.equal(page.api.state.corporate.prevYear.corpTax, 200000);
      }
    }
    const pasted = "１００，０００" + dot + "５円";
    page.input.value = pasted;
    page.input.dispatch("input");
    assertInvalid(page, pasted, /小数/);
    page.input.value = "１００，０００円";
    page.input.dispatch("input");
    assert.equal(page.api.state.corporate.prevYear.corpTax, 100000);
    assert.equal(page.warning(), "");
    assert.equal(page.input.classList.contains("invalid"), false);
  }
});

test("REQ-3 法人の年11回は最初の2回が同じ納期限で翌々年分まで表に出る", () => {
  const page = loadPage();
  page.api.setState({ corporate: { fiscalMonth: 12, prevYear: { consumptionTaxNational: 48000001 } } });
  assert.deepEqual(interimDates(page.api.calculateCorporate().events), [
    "2027/4/30", "2027/4/30", "2027/5/31", "2027/6/30", "2027/7/31", "2027/8/31",
    "2027/9/30", "2027/10/31", "2027/11/30", "2027/12/31", "2028/1/31"
  ]);
  const rows = scheduleRows(page.result("corporate"));
  assert.deepEqual([...rows.keys()], [
    "2026/12", "2027/1", "2027/2", "2027/3", "2027/4", "2027/5", "2027/6",
    "2027/7", "2027/8", "2027/9", "2027/10", "2027/11", "2027/12", "2028/1"
  ]);
  assert.match(rows.get("2027/12"), /2027\/12\/31/);
  assert.match(rows.get("2028/1"), /2028\/01\/31/);
});

test("REQ-3 個人の年11回は5月末に3回、以後は翌年1月末まで", () => {
  const page = loadPage();
  page.api.setState({ individual: { consumptionTaxNational: 48000001 } });
  assert.deepEqual(interimDates(page.api.calculateIndividual().events), [
    "2026/5/31", "2026/5/31", "2026/5/31", "2026/6/30", "2026/7/31", "2026/8/31",
    "2026/9/30", "2026/10/31", "2026/11/30", "2026/12/31", "2027/1/31"
  ]);
  assert.match(scheduleRows(page.result("individual")).get("2026/5"), /15,384,615円/);
});

test("REQ-3 延長特例の注記は法人の年11回が載る表にだけ出る", () => {
  const page = loadPage();
  const note = /確定申告期限の延長特例を受けている法人は期限が異なります/;
  page.api.setState({
    corporate: { fiscalMonth: 3, prevYear: { consumptionTaxNational: 48000000 } },
    individual: { consumptionTaxNational: 48000001 }
  });
  for (const tab of ["corporate", "individual", "combined"]) {
    assert.doesNotMatch(page.result(tab), note);
  }
  page.api.setState({ corporate: { fiscalMonth: 3, prevYear: { consumptionTaxNational: 48000001 } } });
  assert.match(page.result("corporate"), note);
  assert.match(page.result("combined"), note);
  assert.doesNotMatch(page.result("individual"), note);
});

test("REQ-4 個人の翌年1月と3月の期限は翌年の行だけに載る", () => {
  const page = loadPage();
  page.api.setState({ individual: { residentTaxByPeriod: [0, 0, 0, 30000], consumptionTaxNational: 800000 } });
  const rows = scheduleRows(page.result("individual"));
  const baseMonths = Array.from({ length: 12 }, (_, i) => "2026/" + (i + 1));
  assert.deepEqual([...rows.keys()], [...baseMonths, "2027/1", "2027/3"]);
  for (const [month, date] of [[1, "2027/01/31"], [3, "2027/03/31"]]) {
    assert.ok(rows.get("2027/" + month).includes(date));
    assert.match(rows.get("2027/" + month), /2027年/);
    assert.ok(!rows.get("2026/" + month).includes(date));
  }
});

test("REQ-4 統合の2026年7月と2027年7月は別行・別合計になる", () => {
  const page = loadPage();
  page.api.setState({
    corporate: { fiscalMonth: 11, prevYear: { corpTax: 800000 } },
    individual: { incomeTaxBase: 600000, residentTaxByPeriod: [0, 0, 0, 30000], consumptionTaxNational: 800000 }
  });
  const rows = scheduleRows(page.result("combined"));
  const baseMonths = Array.from({ length: 12 }, (_, i) => "2026/" + (i + 1));
  assert.deepEqual([...rows.keys()], [...baseMonths, "2027/1", "2027/3", "2027/7"]);
  for (const [year, total] of [[2026, "200,000円"], [2027, "400,000円"]]) {
    const body = rows.get(year + "/7");
    assert.ok(body.includes(year + "年"));
    assert.ok(body.includes(year + "/07/31"));
    assert.ok(body.includes('<td class="total-cell">' + total + '</td>'));
  }
});

function amountsOf(events, taxKey, deadlineType) {
  return [...events.filter((event) => event.taxKey === taxKey && event.deadlineType === deadlineType).map((event) => event.amount)];
}

test("REQ-5 祝日表の収録年を越える期限があるときだけ、土日だけで判定している旨を出す", () => {
  const page = loadPage();
  const note = /2028年以降の祝日は内閣府の公表前のため、土日だけで判定しています/;
  page.api.setState({ corporate: { fiscalMonth: 3, prevYear: { corpTax: 800000, consumptionTaxNational: 48000001 } } });
  for (const tab of ["corporate", "individual", "combined"]) assert.doesNotMatch(page.result(tab), note);
  page.api.setState({ corporate: { fiscalMonth: 12, prevYear: { consumptionTaxNational: 48000001 } } });
  assert.match(page.result("corporate"), note);
  assert.match(page.result("combined"), note);
  assert.doesNotMatch(page.result("individual"), note);
});

test("REQ-6 個人の消費税確定は同じ年の中間を差し引いた見込み額、法人の確定は注記", () => {
  const page = loadPage();
  page.api.setState({ individual: { consumptionTaxNational: 4000001 } });
  const events = page.api.calculateIndividual().events;
  assert.deepEqual(amountsOf(events, "consumptionNational", "中間"), [1000000, 1000000, 1000000]);
  assert.deepEqual(amountsOf(events, "consumptionNational", "確定"), [1000001]);
  const localInterim = amountsOf(events, "consumptionLocal", "中間").reduce((a, b) => a + b, 0);
  assert.deepEqual(amountsOf(events, "consumptionLocal", "確定"), [Math.round(4000001 * 22 / 78) - localInterim]);
  const corporateNote = /法人の確定欄は前期の年税額そのままです/;
  page.api.setState({ corporate: { fiscalMonth: 3, prevYear: { corpTax: 800000 } } });
  assert.match(page.result("corporate"), corporateNote);
  assert.match(page.result("combined"), corporateNote);
  assert.doesNotMatch(page.result("individual"), corporateNote);
});

test("REQ-7 予定納税・中間の国税は100円未満を切り捨て、要否の判定は切捨て前の額で行う", () => {
  const page = loadPage();
  page.api.setState({ individual: { incomeTaxBase: 600100 } });
  assert.deepEqual(amountsOf(page.api.calculateIndividual().events, "incomeTax", "予定納税"), [200000, 200000]);
  page.api.setState({ individual: { incomeTaxBase: 150000 } });
  assert.deepEqual(amountsOf(page.api.calculateIndividual().events, "incomeTax", "予定納税"), [50000, 50000]);

  page.api.setState({ corporate: { fiscalMonth: 3, prevYear: { corpTax: 1000150, consumptionTaxNational: 6000300 } } });
  const corporate = page.api.calculateCorporate().events;
  assert.deepEqual(amountsOf(corporate, "corpTax", "中間"), [500000]);
  assert.deepEqual(amountsOf(corporate, "consumptionNational", "中間"), [1500000, 1500000, 1500000]);
  // 地方消費税は切捨て前の基礎額（1,500,075円）×22/78 の円未満四捨五入
  assert.deepEqual(amountsOf(corporate, "consumptionLocal", "中間"), [423098, 423098, 423098]);

  // 前期20万1円は半額が10万円を超えるので中間が出る（切捨て後は10万円ちょうど）
  page.api.setState({ corporate: { fiscalMonth: 3, prevYear: { corpTax: 200001 } } });
  assert.deepEqual(amountsOf(page.api.calculateCorporate().events, "corpTax", "中間"), [100000]);
});
