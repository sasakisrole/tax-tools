"use strict";
// calc.html（税理士電卓）のテスト。
// - 報酬源泉と和暦は index.html の既存関数と「本文が同じ」かつ「結果が同じ」ことを確かめる（golden）。
//   期待値は index.html の関数の出力と、index.html の runGoldenTests() にある報酬源泉の expected をそのまま使う。
// - 消費税・端数処理・日付・電卓の四則は index.html に対応する関数がないため、手計算できる値で確かめる。
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const read = (name) => fs.readFileSync(path.join(root, name), "utf8");
const indexHtml = read("index.html");
const calcHtml = read("calc.html");

function inlineScripts(html) {
  return Array.from(html.matchAll(/<script>([\s\S]*?)<\/script>/g), (m) => m[1]);
}

// `function name(` または `const name = ` から、対応する閉じ括弧までの本文を取り出す。
function extractDecl(source, name) {
  const re = new RegExp(`(?:^|\\n)((?:function ${name}\\s*\\(|const ${name}\\s*=)[\\s\\S]*)`);
  const m = source.match(re);
  assert.ok(m, `${name} が見つからない`);
  const text = m[1];
  const open = text.search(/[{[]/);
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (c === "{" || c === "[") depth++;
    else if (c === "}" || c === "]") {
      depth--;
      if (depth === 0) {
        let end = i + 1;
        if (text[end] === ";") end++;
        return text.slice(0, end).replace(/\r\n/g, "\n");
      }
    }
  }
  throw new Error(`${name} の終わりが見つからない`);
}

// calc.html の計算エンジン（1つ目のインライン script。DOM を使わない）を読み込む。
function loadCalcEngine() {
  const engine = inlineScripts(calcHtml)[0];
  assert.ok(engine.includes("計算エンジン"), "calc.html の1つ目の script が計算エンジンではない");
  const context = {};
  vm.createContext(context);
  vm.runInContext(engine + "\n;globalThis.api = { calcHoshuForward, warekiLabel, eraForDate, divRound, taxFromExclusive, taxFromInclusive, parseYmd, addDays, daysBetween, weekday, formatEntry, formatNumber, applyOp, percentValue, tidy };", context, { filename: "calc.html" });
  return context.api;
}

// index.html の報酬源泉関数だけを取り出して読み込む。
function loadIndexHoshu() {
  const context = {};
  vm.createContext(context);
  vm.runInContext(extractDecl(indexHtml, "calcHoshuForward") + "\nglobalThis.f = calcHoshuForward;", context);
  return context.f;
}

// index.html の和暦変換の script を偽 DOM の上で読み込み、画面と同じ convertWarekiS2W() の表示を受け取る。
function loadIndexWareki() {
  const script = inlineScripts(indexHtml).find((s) => s.includes("function convertWarekiS2W()"));
  assert.ok(script, "index.html に convertWarekiS2W() がない");
  const elements = new Map();
  const el = (id) => {
    if (!elements.has(id)) elements.set(id, { id, value: "", innerHTML: "", style: {}, textContent: "" });
    return elements.get(id);
  };
  const document = {
    getElementById: el,
    querySelectorAll: () => [],
  };
  const context = { document, Date };
  vm.createContext(context);
  vm.runInContext(script, context, { filename: "index.html" });
  return (y, m, d) => {
    el("s2w-year").value = String(y);
    el("s2w-month").value = String(m);
    el("s2w-day").value = String(d);
    vm.runInContext("convertWarekiS2W()", context);
    const html = el("wareki-result").innerHTML;
    const hi = html.match(/class="result-row highlight"><span class="label">([^<]*)<\/span><span class="value">([^<]*)<\/span>/);
    return hi ? hi[2] : null; // 和暦にできない日付（明治より前）は警告表示になり、ここでは null
  };
}

const api = loadCalcEngine();

test("報酬源泉: calc.html の calcHoshuForward は index.html と本文が同じ", () => {
  assert.equal(extractDecl(inlineScripts(calcHtml)[0], "calcHoshuForward"), extractDecl(indexHtml, "calcHoshuForward"));
});

test("報酬源泉: index.html の golden の期待値と一致する", () => {
  // index.html runGoldenTests() の「報酬源泉」3件の expected（国税庁 No.2795 ほか）を、そこから読み取って使う。
  const goldens = Array.from(indexHtml.matchAll(/name: '(報酬源泉[^']*)', fn: function\(\)\{ return calcHoshuForward\((\d+)\); \}, expected: (\d+)/g));
  assert.ok(goldens.length >= 3, "index.html の報酬源泉 golden が見つからない");
  for (const [, name, input, expected] of goldens) {
    assert.equal(api.calcHoshuForward(Number(input)), Number(expected), name);
  }
});

test("報酬源泉: 0〜300万円の多数の金額で index.html と同じ結果", () => {
  const indexFn = loadIndexHoshu();
  const inputs = [];
  for (let g = 0; g <= 20000; g++) inputs.push(g);
  for (let g = 990000; g <= 1010000; g++) inputs.push(g);
  for (let g = 0; g <= 3000000; g += 997) inputs.push(g);
  inputs.push(99999999, 123456789);
  for (const g of inputs) assert.equal(api.calcHoshuForward(g), indexFn(g), `報酬 ${g}`);
});

test("和暦: WAREKI_ERAS・cmpWDate・eraForDate・fmtWarekiYear の本文が index.html と同じ", () => {
  const engine = inlineScripts(calcHtml)[0];
  for (const name of ["WAREKI_ERAS", "cmpWDate", "eraForDate", "fmtWarekiYear"]) {
    assert.equal(extractDecl(engine, name), extractDecl(indexHtml, name), name);
  }
});

test("和暦: 改元日の前後と各年で index.html の西暦→和暦の表示と同じ", () => {
  const indexS2W = loadIndexWareki();
  const dates = [];
  const edges = [[1868, 10, 22], [1868, 10, 23], [1912, 7, 29], [1912, 7, 30], [1926, 12, 24], [1926, 12, 25],
    [1989, 1, 7], [1989, 1, 8], [2019, 4, 30], [2019, 5, 1], [2026, 11, 5], [1900, 1, 1], [1850, 6, 1]];
  for (const e of edges) dates.push(e);
  for (let y = 1868; y <= 2040; y++) for (const [m, d] of [[1, 1], [4, 30], [5, 1], [7, 29], [7, 30], [12, 24], [12, 25], [12, 31]]) dates.push([y, m, d]);
  for (const [y, m, d] of dates) {
    const expected = indexS2W(y, m, d);
    // 1868年1月〜10月22日は index.html が慶応の注記を出す（和暦の行がない）ため、calc.html 側は和暦を出さないことだけ確かめる。
    const actual = api.warekiLabel(y, m, d);
    if (expected === null) assert.equal(actual, null, `${y}-${m}-${d}`);
    else assert.equal(actual, expected, `${y}-${m}-${d}`);
  }
  assert.equal(api.warekiLabel(2019, 5, 1), "令和元年5月1日");
  assert.equal(api.warekiLabel(2019, 4, 30), "平成31年4月30日");
});

test("端数処理: 切り捨て・四捨五入・切り上げ", () => {
  assert.equal(api.divRound(1234 * 10, 110, "floor"), 112); // 112.18...
  assert.equal(api.divRound(1234 * 10, 110, "round"), 112);
  assert.equal(api.divRound(1234 * 10, 110, "ceil"), 113);
  assert.equal(api.divRound(55, 10, "round"), 6); // ちょうど .5 は切り上がる
  assert.equal(api.divRound(54, 10, "round"), 5);
  assert.equal(api.divRound(1100, 110, "ceil"), 10); // 割り切れるときはどれも同じ
  assert.equal(api.divRound(0, 108, "ceil"), 0);
});

test("消費税: 税抜→税込（10%・8%）", () => {
  assert.deepEqual({ ...api.taxFromExclusive(1000, 10, "floor") }, { excl: 1000, tax: 100, incl: 1100 });
  assert.deepEqual({ ...api.taxFromExclusive(1234, 8, "floor") }, { excl: 1234, tax: 98, incl: 1332 }); // 98.72
  assert.equal(api.taxFromExclusive(1234, 8, "round").tax, 99);
  assert.equal(api.taxFromExclusive(1234, 8, "ceil").tax, 99);
  assert.equal(api.taxFromExclusive(1235, 10, "round").tax, 124); // 123.5
});

test("消費税: 税込→税抜と内税額（10%・8%）", () => {
  assert.deepEqual({ ...api.taxFromInclusive(1100, 10, "floor") }, { incl: 1100, tax: 100, excl: 1000 });
  assert.deepEqual({ ...api.taxFromInclusive(1000, 10, "floor") }, { incl: 1000, tax: 90, excl: 910 }); // 90.90...
  assert.equal(api.taxFromInclusive(1000, 10, "round").tax, 91);
  assert.equal(api.taxFromInclusive(1000, 8, "floor").tax, 74); // 74.07...
  assert.equal(api.taxFromInclusive(1000, 8, "ceil").tax, 75);
  assert.equal(api.taxFromInclusive(1080, 8, "ceil").tax, 80);
});

test("日付: ○日後・日数・曜日", () => {
  const base = api.parseYmd("2026-11-05");
  assert.deepEqual({ ...api.addDays(base, 60) }, { y: 2027, m: 1, d: 4, w: 1 });
  assert.deepEqual({ ...api.addDays(base, -5) }, { y: 2026, m: 10, d: 31, w: 6 });
  assert.equal(api.weekday(base), "木");
  assert.equal(api.daysBetween(api.parseYmd("2024-02-28"), api.parseYmd("2024-03-01")), 2); // うるう年
  assert.equal(api.daysBetween(api.parseYmd("2026-01-01"), api.parseYmd("2026-12-31")), 364);
  assert.equal(api.daysBetween(api.parseYmd("2026-03-10"), api.parseYmd("2026-03-01")), -9);
  assert.equal(api.parseYmd("2026-02-30"), null);
  assert.equal(api.parseYmd(""), null);
});

test("電卓: 四則・%・桁区切り表示", () => {
  assert.equal(api.applyOp(0.1, "+", 0.2), 0.3);
  assert.equal(api.applyOp(1200, "*", 3), 3600);
  assert.ok(Number.isNaN(api.applyOp(1, "/", 0)));
  assert.equal(api.applyOp(10, "/", 4), 2.5);
  assert.equal(api.percentValue(200, "+", 10), 20); // 200 + 10% → 20 を足す
  assert.equal(api.percentValue(null, null, 5), 0.05);
  assert.equal(api.formatEntry("1234567"), "1,234,567");
  assert.equal(api.formatEntry("-1234.50"), "-1,234.50");
  assert.equal(api.formatEntry("1000."), "1,000.");
  assert.equal(api.formatNumber(1234567.891), "1,234,567.891");
  assert.equal(api.formatNumber(NaN), "エラー");
});

test("index.html に calc.html へのリンクが1つある", () => {
  const links = indexHtml.match(/calc\.html/g) || [];
  assert.equal(links.length, 1);
});

test("サービスワーカーは calc.html だけを対象に登録する", () => {
  assert.match(calcHtml, /serviceWorker\.register\('calc-sw\.js', \{ scope: '\.\/calc\.html' \}\)/);
  const sw = read("calc-sw.js");
  for (const f of ["calc.html", "calc.webmanifest", "calc-icon.svg", "calc-icon-192.png", "calc-icon-512.png"]) {
    assert.ok(sw.includes(`'${f}'`), `${f} をキャッシュ対象に含む`);
    assert.ok(fs.existsSync(path.join(root, f)), `${f} が存在する`);
  }
  const manifest = JSON.parse(read("calc.webmanifest"));
  assert.equal(manifest.start_url, "calc.html");
  // 既存ページはサービスワーカーを登録しない（動作を変えない）
  for (const page of ["index.html", "beta.html", "nozei-calendar.html", "beppyou4-keisan.html", "privacy.html"]) {
    assert.ok(!read(page).includes("serviceWorker"), `${page} はサービスワーカーに関与しない`);
  }
});
