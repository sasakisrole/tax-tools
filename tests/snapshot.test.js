"use strict";
// 現状固定テスト（beta.html・nozei-calendar.html・beppyou4-keisan.html）
//
// ここにある期待値は、テストを書いた時点のコードが返した値をそのまま記録したもので、
// 税額・保険料・控除額・最低賃金・有給日数・納期限などが法令や公表資料に照らして正しいかは確かめていない。
// 目的は「意図せず計算結果が変わったこと」に気づくことだけ。計算を意図して直したときは、
// 直した理由を確かめたうえで、ここの期待値も新しい出力に合わせて書き換える。
//
// HTML は変えず、インラインの <script> を node:vm に読み込み、最小限の偽 DOM の上で関数を直接呼ぶ。
// 「今日」の日付を使う処理があるため、読み込み時の引数なしの new Date() は固定日時にしている。
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");

// vm の中で作られたオブジェクトを、比較しやすい素のオブジェクトにする。
const plain = (value) => JSON.parse(JSON.stringify(value));

// src 属性のないインラインの <script> を、ページに書かれた順に取り出す。
function inlineScripts(html, fileName) {
  const scripts = Array.from(html.matchAll(/<script>([\s\S]*?)<\/script>/g), (match) => match[1]);
  assert.ok(scripts.length, `${fileName} must contain an inline script`);
  return scripts;
}

// 読み込み時の処理が読む value は、HTML に書かれた初期値（input の value 属性、select の選択肢）を返す。
function initialValue(html, id) {
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const tag = html.match(new RegExp(`<(input|select|textarea)\\b[^>]*\\bid="${escaped}"[^>]*>`));
  if (!tag) return "";
  if (tag[1] === "input") {
    const value = tag[0].match(/\bvalue="([^"]*)"/);
    return value ? value[1] : "";
  }
  if (tag[1] === "textarea") return "";
  const body = html.slice(tag.index + tag[0].length, html.indexOf("</select>", tag.index));
  const options = Array.from(body.matchAll(/<option\b([^>]*)>([\s\S]*?)<\/option>/g));
  if (!options.length) return "";
  const chosen = options.find((option) => /\bselected\b/.test(option[1])) || options[0];
  const value = chosen[1].match(/\bvalue="([^"]*)"/);
  return value ? value[1] : chosen[2].trim();
}

// 何でも受け付ける偽オブジェクト（グラフ描画ライブラリや history など、計算に関係しないもの用）。
function anyStub() {
  const store = new Map();
  return new Proxy(function () {}, {
    get(_target, key) {
      if (store.has(key)) return store.get(key);
      if (key === Symbol.toPrimitive) return () => "";
      if (key === Symbol.iterator) return function* () {};
      if (key === "then") return undefined;
      if (key === "length") return 0;
      if (typeof key === "symbol") return undefined;
      const child = anyStub();
      store.set(key, child);
      return child;
    },
    set(_target, key, value) {
      store.set(key, value);
      return true;
    },
    apply() { return anyStub(); },
    construct() { return anyStub(); }
  });
}

// 計算関数が読み書きする範囲だけを持つ偽 DOM 要素。
function element(value = "") {
  return {
    value,
    textContent: "",
    innerHTML: "",
    className: "",
    hidden: false,
    style: {},
    dataset: {},
    children: [],
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    appendChild(child) { this.children.push(child); return child; },
    addEventListener() {},
    removeEventListener() {},
    querySelector() { return element(); },
    querySelectorAll() { return []; },
    setAttribute() {},
    getAttribute() { return null; },
    focus() {},
    select() {},
    remove() {}
  };
}

// 引数なしの new Date() と Date.now() だけを固定日時にする（引数ありの new Date(...) はそのまま）。
function fixedDateSource(fixed) {
  const args = [fixed.getFullYear(), fixed.getMonth(), fixed.getDate(), fixed.getHours(), fixed.getMinutes()];
  return `(function () {
    const RealDate = Date;
    const FIXED = new RealDate(${args.join(", ")}).getTime();
    class FixedDate extends RealDate {
      constructor(...a) { if (a.length === 0) super(FIXED); else super(...a); }
      static now() { return FIXED; }
    }
    globalThis.Date = FixedDate;
  })();\n`;
}

// fileName のインラインスクリプトを順に読み込み、関数を呼べる状態のサンドボックスを返す。
// options.now: 「今日」を固定する日時（Date）。options.checked: querySelector(":checked") が返す value。
function loadPage(fileName, options = {}) {
  const html = fs.readFileSync(path.join(root, fileName), "utf8");
  const elements = new Map();
  const alerts = [];
  const checked = options.checked || {};
  const document = {
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, element(initialValue(html, id)));
      return elements.get(id);
    },
    createElement() { return element(); },
    querySelector(selector) {
      const name = selector.match(/name="([^"]+)"\]:checked/);
      if (name) return element(checked[name[1]] || "");
      return element();
    },
    querySelectorAll() { return []; },
    documentElement: element()
  };
  const storage = new Map();
  const context = {
    console,
    document,
    location: { search: "", hash: "", pathname: "/", href: "" },
    history: anyStub(),
    navigator: anyStub(),
    google: anyStub(),
    XLSX: anyStub(),
    localStorage: {
      getItem(key) { return storage.has(key) ? storage.get(key) : null; },
      setItem(key, value) { storage.set(key, String(value)); },
      removeItem(key) { storage.delete(key); }
    },
    addEventListener() {},
    removeEventListener() {},
    setTimeout() { return 0; },
    clearTimeout() {},
    requestAnimationFrame() { return 0; },
    matchMedia() { return { matches: false, addEventListener() {}, addListener() {} }; },
    getComputedStyle() { return { getPropertyValue() { return ""; } }; },
    alert(message) { alerts.push(String(message)); },
    prompt() { return null; },
    confirm() { return false; },
    scrollTo() {},
    print() {}
  };
  context.window = context;
  vm.createContext(context);
  if (options.now) vm.runInContext(fixedDateSource(options.now), context);
  for (const source of inlineScripts(html, fileName)) {
    vm.runInContext(source, context, { filename: fileName });
  }
  return {
    context,
    document,
    alerts,
    // const / let で宣言された値も読めるよう、式として評価する。
    evaluate(expression) { return vm.runInContext(expression, context); },
    // 入力欄の値をまとめて書き込む。
    setValues(values) {
      for (const [id, value] of Object.entries(values)) document.getElementById(id).value = value;
    },
    // 結果欄の innerHTML からタグを除いた文字列を返す。
    text(id) {
      const node = document.getElementById(id);
      return String(node.innerHTML || node.textContent).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
    }
  };
}

// ==================== beta.html ====================
{
  // 「今日」は2026年11月5日に固定している（パート労務チェックの判定基準日の初期値などに使われる）。

  const checked = { "pt-basis": "week" };
  const page = loadPage("beta.html", { now: new Date(2026, 10, 5, 12, 0), checked });
  const api = page.context;

  test("現状固定: マネーフローの標準報酬月額は等級の境目で次の等級に移る", () => {
    const cases = [
      [62999, { health: 58000, pension: 88000 }],
      [63000, { health: 68000, pension: 88000 }],
      [92999, { health: 88000, pension: 88000 }],
      [93000, { health: 98000, pension: 98000 }],
      [634999, { health: 620000, pension: 620000 }],
      [635000, { health: 650000, pension: 650000 }],
      [664999, { health: 650000, pension: 650000 }],
      [665000, { health: 680000, pension: 650000 }],
      [1354999, { health: 1330000, pension: 650000 }],
      [1355000, { health: 1390000, pension: 650000 }]
    ];
    for (const [monthly, expected] of cases) {
      assert.deepEqual(plain(api.mfGetHyojun(monthly)), expected, `月額 ${monthly}`);
    }
  });

  test("現状固定: マネーフローの給与所得控除は区分の境目の前後でこの値を返す", () => {
    // 1,625,001円で 650,000円を下回る値になる点も含め、今の出力をそのまま記録している。
    const cases = [
      [1625000, 650000],
      [1625001, 550000.4],
      [1800000, 620000],
      [1800001, 620000.2999999999],
      [3600000, 1160000],
      [3600001, 1160000.2000000002],
      [6600000, 1760000],
      [6600001, 1760000.1],
      [8500000, 1950000],
      [8500001, 1950000]
    ];
    for (const [annual, expected] of cases) {
      assert.equal(api.mfCalcKyuyoKojo(annual), expected, `年収 ${annual}`);
    }
  });

  test("現状固定: マネーフローの所得税（復興税加算前）は速算表の境目の前後でこの値を返す", () => {
    const cases = [
      [0, 0],
      [1000, 50],
      [1949000, 97450],
      [1950000, 97500],
      [3299000, 232400],
      [3300000, 232500],
      [6949000, 962300],
      [6950000, 962500],
      [8999000, 1433770],
      [9000000, 1434000],
      [17999000, 4403670],
      [18000000, 4404000],
      [39999000, 13203600],
      [40000000, 13204000]
    ];
    for (const [taxable, expected] of cases) {
      assert.equal(api.mfCalcShotokuzei(taxable), expected, `課税所得 ${taxable}`);
    }
  });

  test("現状固定: マネーフローの法人税等は800万円の前後でこの値を返す", () => {
    const cases = [
      [-1, 0],
      [0, 0],
      [1, 0],
      [8000000, 2000000],
      [8000001, 2000000],
      [10000000, 2700000]
    ];
    for (const [profit, expected] of cases) {
      assert.equal(api.mfCalcCorpTax(profit), expected, `利益 ${profit}`);
    }
  });

  test("現状固定: マネーフロー全体の結果（万円）", () => {
    const cases = [
      // 画面の初期値（売上3,000万・役員報酬1,200万・経費300万）
      [[3000, 1200, 300], { revenue: 3000, salary: 1200, expenses: 300, corpIncome: 1500, totalCorpTax: 445, corpRetained: 1055, socialIns: 142, companySocialIns: 142, incomeTax: 124, residentTax: 83, personalTakeHome: 852, totalTax: 935 }],
      [[1000, 600, 200], { revenue: 1000, salary: 600, expenses: 200, corpIncome: 200, totalCorpTax: 50, corpRetained: 150, socialIns: 91, companySocialIns: 91, incomeTax: 19, residentTax: 31, personalTakeHome: 459, totalTax: 282 }],
      // 役員報酬が「売上 − 経費」を超えると、その上限まで切り詰められる
      [[1000, 2000, 300], { revenue: 1000, salary: 700, expenses: 300, corpIncome: 0, totalCorpTax: 0, corpRetained: 0, socialIns: 107, companySocialIns: 107, incomeTax: 29, residentTax: 37, personalTakeHome: 527, totalTax: 281 }],
      // 経費が売上を超え、役員報酬0円のとき
      [[500, 0, 600], { revenue: 500, salary: 0, expenses: 600, corpIncome: 0, totalCorpTax: 0, corpRetained: 0, socialIns: 14, companySocialIns: 14, incomeTax: 0, residentTax: 1, personalTakeHome: 0, totalTax: 28 }],
      // スライダーの上限付近
      [[10000, 5000, 0], { revenue: 10000, salary: 5000, expenses: 0, corpIncome: 5000, totalCorpTax: 1670, corpRetained: 3330, socialIns: 171, companySocialIns: 171, incomeTax: 1613, residentTax: 460, personalTakeHome: 2757, totalTax: 4085 }]
    ];
    for (const [args, expected] of cases) {
      assert.deepEqual(plain(api.calcMoneyFlow(...args)), expected, `入力 ${args.join(" / ")}`);
    }
  });

  function breakevenSummary(revenue, variable, fixed) {
    page.setValues({ "be-revenue": revenue, "be-variable": variable, "be-fixed": fixed });
    api.updateBreakeven();
    return page.text("be-summary");
  }

  test("現状固定: 損益分岐点シミュレーターの要約表示", () => {
    assert.equal(breakevenSummary("3000", "1200", "800"), "営業利益 1,000万円 損益分岐点売上 1,333万円 限界利益率 60.0%");
    assert.equal(breakevenSummary("2000", "500", "1500"), "営業利益 0万円 損益分岐点売上 2,000万円 限界利益率 75.0%");
    assert.equal(breakevenSummary("100", "0", "0"), "営業利益 100万円 損益分岐点売上 0万円 限界利益率 100.0%");
    // 変動費 = 売上（限界利益率0%）と、変動費 > 売上（限界利益率がマイナス）のとき
    assert.equal(breakevenSummary("1000", "1000", "100"), "営業利益 -100万円 損益分岐点売上 算出不可 限界利益率 0.0%");
    assert.equal(breakevenSummary("1000", "1500", "100"), "営業利益 -600万円 損益分岐点売上 算出不可 限界利益率 -50.0%");
  });

  function wallSummary(year, employerSize, income) {
    page.setValues({ "wall-year": year, "employer-size": employerSize, "annual-income": income });
    page.document.getElementById("summary-text").textContent = "";
    page.alerts.length = 0;
    api.calcWalls();
    return page.document.getElementById("summary-text").textContent;
  }

  test("現状固定: 各種の壁（令和8年分）の判定は壁の金額の前後でこう変わる", () => {
    assert.equal(wallSummary("R8", "small", "0"), "全ての壁の手前です");
    assert.equal(wallSummary("R8", "small", "120"), "1個の壁を超過中 / 次の壁（130万の壁）まであと 10.0 万円");
    assert.equal(wallSummary("R8", "small", "177.9"), "3個の壁を超過中 / 次の壁（178万の壁（旧123万/103万））まであと 0.1 万円");
    assert.equal(wallSummary("R8", "small", "178"), "4個の壁を超過中 / 次の壁（201万の壁）まであと 23.0 万円");
    assert.equal(wallSummary("R8", "small", "201"), "全ての壁を超過しています");
  });

  test("現状固定: 各種の壁の106万の壁は従業員51人以上を選んだときだけ数える", () => {
    assert.equal(wallSummary("R8", "large", "105"), "1個の壁を超過中 / 次の壁（106万の壁）まであと 1.0 万円");
    assert.equal(wallSummary("R8", "large", "106"), "2個の壁を超過中 / 次の壁（130万の壁）まであと 24.0 万円");
  });

  test("現状固定: 各種の壁は令和7年分と令和8年分で使う壁が切り替わる", () => {
    assert.equal(wallSummary("R7", "small", "122"), "1個の壁を超過中 / 次の壁（123万の壁（旧103万））まであと 1.0 万円");
    assert.equal(wallSummary("R7", "small", "123"), "2個の壁を超過中 / 次の壁（130万の壁）まであと 7.0 万円");
    assert.equal(wallSummary("R7", "small", "150"), "4個の壁を超過中 / 次の壁（201万の壁）まであと 51.0 万円");
  });

  test("現状固定: 各種の壁は数字でない年収を受け付けずアラートを出す", () => {
    assert.equal(wallSummary("R8", "small", "abc"), "");
    assert.deepEqual(page.alerts, ["年収を正しく入力してください"]);
  });

  function furusato(year, income, deduction, jumin = "") {
    page.setValues({
      "furusato-year": year,
      "furusato-income": income,
      "furusato-deduction": deduction,
      "furusato-jumin-shotokuwari": jumin,
      "furusato-client": ""
    });
    api._furusatoData = undefined;
    page.alerts.length = 0;
    api.calcFurusato();
    return api._furusatoData ? plain(api._furusatoData) : undefined;
  }

  // 比較する項目（印刷用データのうち計算結果の部分）
  function furusatoNumbers(data) {
    const { taxableIncome, incomeTaxRate, juuminTaxBase, juuminMode, limit, incomeTaxDeduction, juuminBasicDeduction, juuminSpecialDeduction } = data;
    return { taxableIncome, incomeTaxRate, juuminTaxBase, juuminMode, limit, incomeTaxDeduction, juuminBasicDeduction, juuminSpecialDeduction };
  }

  test("現状固定: ふるさと納税の上限額は年分の切り替えで住民税所得割の概算が変わる", () => {
    const r8 = furusato("R8", "6000000", "1500000");
    assert.equal(r8.yearLabel, "令和8年分（2026年）");
    assert.deepEqual(furusatoNumbers(r8), { taxableIncome: 4500000, incomeTaxRate: 0.2, juuminTaxBase: 508500, juuminMode: "approx", limit: 148162, incomeTaxDeduction: 29846, juuminBasicDeduction: 14616, juuminSpecialDeduction: 101699 });

    const r7 = furusato("R7", "6000000", "1500000");
    assert.equal(r7.yearLabel, "令和7年分（2025年）");
    assert.deepEqual(furusatoNumbers(r7), { taxableIncome: 4500000, incomeTaxRate: 0.2, juuminTaxBase: 452500, juuminMode: "approx", limit: 132066, incomeTaxDeduction: 26559, juuminBasicDeduction: 13006, juuminSpecialDeduction: 90499 });

    // 令和6年分は令和7年分と同じ補正額で計算される
    const r6 = furusato("R6", "6000000", "1500000");
    assert.equal(r6.yearLabel, "令和6年分（2024年）");
    assert.deepEqual(furusatoNumbers(r6), furusatoNumbers(r7));
  });

  test("現状固定: ふるさと納税の上限額は住民税所得割を直接入力するとその額を使う", () => {
    const data = furusato("R8", "6000000", "1500000", "280000");
    assert.deepEqual(furusatoNumbers(data), { taxableIncome: 4500000, incomeTaxRate: 0.2, juuminTaxBase: 280000, juuminMode: "exact", limit: 82482, incomeTaxDeduction: 16434, juuminBasicDeduction: 8048, juuminSpecialDeduction: 55999 });
  });

  test("現状固定: ふるさと納税の所得税率は課税所得195万円の前後で切り替わる", () => {
    const at = furusato("R8", "3000000", "1050000");
    assert.deepEqual(furusatoNumbers(at), { taxableIncome: 1950000, incomeTaxRate: 0.05, juuminTaxBase: 253500, juuminMode: "approx", limit: 61720, incomeTaxDeduction: 3048, juuminBasicDeduction: 5972, juuminSpecialDeduction: 50699 });

    // 1,000円未満は切り捨てるので、1円の差では同じ区分にとどまる
    const truncated = furusato("R8", "3000000", "1049999");
    assert.deepEqual(furusatoNumbers(truncated), furusatoNumbers(at));

    const over = furusato("R8", "3000000", "1049000");
    assert.deepEqual(furusatoNumbers(over), { taxableIncome: 1951000, incomeTaxRate: 0.1, juuminTaxBase: 253600, juuminMode: "approx", limit: 65566, incomeTaxDeduction: 6490, juuminBasicDeduction: 6356, juuminSpecialDeduction: 50719 });
  });

  test("現状固定: ふるさと納税の上限額は高い税率の区分でこの値を返す", () => {
    const rate40 = furusato("R8", "20000000", "1999000");
    assert.deepEqual(furusatoNumbers(rate40), { taxableIncome: 18001000, incomeTaxRate: 0.4, juuminTaxBase: 1858600, juuminMode: "approx", limit: 758143, incomeTaxDeduction: 308808, juuminBasicDeduction: 75614, juuminSpecialDeduction: 371719 });

    const rate45 = furusato("R8", "50000000", "2000000");
    assert.deepEqual(furusatoNumbers(rate45), { taxableIncome: 48000000, incomeTaxRate: 0.45, juuminTaxBase: 4858500, juuminMode: "approx", limit: 2207652, incomeTaxDeduction: 1013386, juuminBasicDeduction: 220565, juuminSpecialDeduction: 971699 });
  });

  test("現状固定: ふるさと納税は入力が0円・課税所得0円のとき計算せずアラートを出す", () => {
    assert.equal(furusato("R8", "0", "100"), undefined);
    assert.deepEqual(page.alerts, ["総所得金額等を入力してください"]);
    assert.equal(furusato("R8", "100", "0"), undefined);
    assert.deepEqual(page.alerts, ["所得控除合計額を入力してください"]);
    assert.equal(furusato("R7", "1000000", "1000000"), undefined);
    assert.deepEqual(page.alerts, ["課税所得が0円以下のため、ふるさと納税の控除メリットがありません"]);
  });

  const ptDate = (text) => api.ptDate(text);
  const ptText = (date) => (date ? api.ptDateText(date) : date);

  test("現状固定: パート労務チェックの有給付与日の判定（6か月経過日と月末の前後）", () => {
    const timing = (hire, effective) => {
      const raw = api.ptLeaveTiming(ptDate(hire), ptDate(effective));
      const result = plain(raw);
      result.next = ptText(raw.next);
      if (raw.grant) result.grant = ptText(raw.grant);
      return result;
    };
    assert.deepEqual(timing("2026-04-01", "2026-09-30"), { reached: false, next: "2026-10-01" });
    assert.deepEqual(timing("2026-04-01", "2026-10-01"), { reached: true, index: 0, actualIndex: 0, grant: "2026-10-01", next: "2027-10-01" });
    // 6か月後の月に同じ日がないときは、その月の末日になる
    assert.deepEqual(timing("2025-08-31", "2026-02-28"), { reached: true, index: 0, actualIndex: 0, grant: "2026-02-28", next: "2027-02-28" });
    assert.deepEqual(timing("2024-03-31", "2025-09-30"), { reached: true, index: 1, actualIndex: 1, grant: "2025-09-30", next: "2026-09-30" });
    assert.deepEqual(timing("2024-03-31", "2026-09-30"), { reached: true, index: 2, actualIndex: 2, grant: "2026-09-30", next: "2027-09-30" });
    // 継続勤務が長くても表の最後の列（6年6か月以上）にとどまる
    assert.deepEqual(timing("2010-04-01", "2026-11-05"), { reached: true, index: 6, actualIndex: 16, grant: "2026-10-01", next: "2027-10-01" });
  });

  test("現状固定: パート労務チェックの付与区分は週30時間・週5日・年間日数の境目でこう変わる", () => {
    const mode = (basis, weekHours, weekDays, yearDays) => {
      checked["pt-basis"] = basis;
      page.setValues({ "pt-weekhours": weekHours, "pt-weekdays": weekDays, "pt-yeardays": yearDays });
      return plain(api.ptLeaveMode());
    };
    assert.deepEqual(mode("week", "30", "3", ""), { type: "normal", label: "通常付与（週30時間以上）" });
    assert.deepEqual(mode("week", "29.75", "4", ""), { type: "prorated", row: 4, label: "比例付与（週4日）" });
    assert.deepEqual(mode("week", "29.75", "5", ""), { type: "normal", label: "通常付与（週5日以上）" });
    assert.deepEqual(mode("year", "20", "", "47"), { unavailable: true, error: "年間所定労働日数が48日未満のため、比例付与表に区分がありません。個別確認が必要です。" });
    const rows = [["48", 1], ["72", 1], ["73", 2], ["120", 2], ["121", 3], ["168", 3], ["169", 4], ["216", 4]];
    for (const [days, row] of rows) {
      assert.equal(mode("year", "20", "", days).row, row, `年間 ${days} 日`);
    }
    assert.deepEqual(mode("year", "20", "", "217"), { type: "normal", label: "通常付与（年間217日以上）" });
    checked["pt-basis"] = "week";
  });

  // 画面の初期値に近い入力（都道府県と日付は固定）を基準に、一部だけ変えて全体を計算する。
  function parttime(overrides = {}) {
    checked["pt-basis"] = "week";
    page.setValues(Object.assign({
      "pt-pref": "東京", "pt-hire": "2024-04-01", "pt-asof": "2026-11-05", "pt-retire": "",
      "pt-weekdays": "3", "pt-yeardays": "156", "pt-weekhours": "18", "pt-dailyhours": "6",
      "pt-wage": "1200", "pt-total-days": "156", "pt-attended-days": "150", "pt-carryover": "0",
      "pt-avg-total": "", "pt-avg-caldays": "", "pt-avg-workdays": "", "pt-mw-manual": ""
    }, overrides));
    api.calcParttime();
    return { a: page.text("pt-result-a"), b: page.text("pt-result-b"), c: page.text("pt-result-c"), d: page.text("pt-result-d") };
  }

  test("現状固定: パート労務チェックの代表的な入力（週3日・継続勤務2年6か月）", () => {
    const result = parttime();
    assert.ok(result.a.includes("比例付与（週3日）・継続勤務 2年6か月 今回の付与日: 2026-10-01 付与日数: 6日"), result.a);
    assert.ok(result.a.includes("出勤率 96.2%（150日 / 156日）"), result.a);
    assert.ok(result.b.includes("保有日数: 6日（前年度繰越 0日 + 今回付与 6日） 今回付与分の消滅予定日: 2028-10-01 次回付与日: 2027-10-01"), result.b);
    assert.ok(result.c.includes("通常の賃金: 7,200円 / 日"), result.c);
    assert.ok(result.c.includes("平均賃金: 任意項目が未入力のため表示していません。"), result.c);
    assert.ok(result.d.includes("適用額: 1,280円（令和8年度・発効日 2026-10-01） 入力時給: 1,200円 / 差額: -80円"), result.d);
    assert.ok(result.d.includes("月間不足見込み: 約6,240円（月間所定労働時間 約78時間で概算）"), result.d);
  });

  test("現状固定: パート労務チェックの出勤率は80%ちょうどで付与し、79%で付与しない", () => {
    const at80 = parttime({ "pt-total-days": "100", "pt-attended-days": "80" });
    assert.ok(at80.a.includes("付与日数: 6日 8割出勤要件を満たしています（出勤率 80%（80日 / 100日））。"), at80.a);
    const at79 = parttime({ "pt-total-days": "100", "pt-attended-days": "79" });
    assert.ok(at79.a.includes("今回の付与日数: 0日 8割出勤要件を満たさないため、今回は付与されません（出勤率 79%（79日 / 100日））。 次回基準日: 2027-10-01"), at79.a);
    assert.ok(at79.b.includes("保有日数: 0日（前年度繰越 0日 + 今回付与 0日）"), at79.b);
  });

  test("現状固定: パート労務チェックの繰越・長期勤務・退職日の扱い", () => {
    const carry = parttime({ "pt-carryover": "5.5" });
    assert.ok(carry.b.includes("保有日数: 11.5日（前年度繰越 5.5日 + 今回付与 6日）"), carry.b);

    const long = parttime({ "pt-hire": "2015-04-01" });
    assert.ok(long.a.includes("継続勤務 6年6か月以上 今回の付与日: 2026-10-01 付与日数: 11日"), long.a);

    // 退職日が判定基準日より前なら、退職日で判定する（最低賃金も退職日時点の額）
    const retired = parttime({ "pt-retire": "2025-12-31" });
    assert.ok(retired.a.includes("継続勤務 1年6か月 今回の付与日: 2025-10-01 付与日数: 6日"), retired.a);
    assert.ok(retired.a.includes("退職日を上限として 2025-12-31 で判定しています。"), retired.a);
    assert.ok(retired.d.includes("適用額: 1,226円（令和7年度・発効日 2025-10-03） 入力時給: 1,200円 / 差額: -26円"), retired.d);
  });

  test("現状固定: パート労務チェックの平均賃金は原則額と最低保障額の大きい方を採る", () => {
    const principle = parttime({ "pt-avg-total": "300000", "pt-avg-caldays": "92", "pt-avg-workdays": "60" });
    assert.ok(principle.c.includes("平均賃金の原則額: 3,260.86円 最低保障額（時間給・日給・出来高払制）: 3,000.00円 平均賃金の採用額: 3,260.86円 / 日（原則額）"), principle.c);
    const guaranteed = parttime({ "pt-avg-total": "200000", "pt-avg-caldays": "92", "pt-avg-workdays": "30" });
    assert.ok(guaranteed.c.includes("平均賃金の原則額: 2,173.91円 最低保障額（時間給・日給・出来高払制）: 4,000.00円 平均賃金の採用額: 4,000.00円 / 日（最低保障額）"), guaranteed.c);
  });

  test("現状固定: パート労務チェックの最低賃金は発効日の前日と当日で年度が切り替わる", () => {
    const before = parttime({ "pt-pref": "沖縄", "pt-asof": "2026-12-01", "pt-wage": "1050" });
    assert.equal(before.d, "D. 最低賃金の下回り判定 適用額: 1,023円（令和7年度・発効日 2025-12-01） 入力時給: 1,050円 / 差額: +27円 最低賃金を満たしています。");
    const on = parttime({ "pt-pref": "沖縄", "pt-asof": "2026-12-02", "pt-wage": "1050" });
    assert.ok(on.d.includes("適用額: 1,086円（令和8年度・発効日 2026-12-02） 入力時給: 1,050円 / 差額: -36円"), on.d);
    assert.ok(on.d.includes("月間不足見込み: 約2,808円"), on.d);
  });

  test("現状固定: パート労務チェックの最低賃金は次年度改定の見込み日から表の額を使わない", () => {
    const dayBefore = parttime({ "pt-asof": "2027-09-30" });
    assert.ok(dayBefore.d.includes("適用額: 1,280円（令和8年度・発効日 2026-10-01）"), dayBefore.d);
    const onDay = parttime({ "pt-asof": "2027-10-01" });
    assert.equal(onDay.d, "D. 最低賃金の下回り判定 令和9年度の改定額は未登録です。厚生労働省の一覧で確認して手入力してください。古い額は表示していません。 収録データ更新日: 2026-10-01");
    const manual = parttime({ "pt-asof": "2027-10-01", "pt-mw-manual": "1300" });
    assert.ok(manual.d.includes("適用額: 1,300円（手入力値を使用・年度と発効日は未確認（判定日 2027-10-01 に適用する額）） 入力時給: 1,200円 / 差額: -100円"), manual.d);
  });

  test("現状固定: パート労務チェックの最低賃金は収録範囲の最初の発効日の前後でこう変わる", () => {
    const outside = parttime({ "pt-pref": "沖縄", "pt-hire": "2001-01-01", "pt-asof": "2002-09-30" });
    assert.equal(outside.d, "D. 最低賃金の下回り判定 判定日は収録範囲（平成14年度以降）より前です。適用額を確認して手入力してください。");
    const inside = parttime({ "pt-pref": "沖縄", "pt-hire": "2001-01-01", "pt-asof": "2002-10-01", "pt-wage": "604" });
    assert.equal(inside.d, "D. 最低賃金の下回り判定 適用額: 604円（平成14年度・発効日 2002-10-01） 入力時給: 604円 / 差額: +0円 最低賃金を満たしています。");
  });
}

// ==================== nozei-calendar.html ====================
{
  // 基準年（BASE_YEAR）は読み込み時の new Date() から決まるため、2026年4月1日に固定している。
  // 入力欄の解析（空欄・混在する不正文字・巨大桁）は tests/input-behavior.test.js で扱っているので、ここでは足さない。

  const page = loadPage("nozei-calendar.html", { now: new Date(2026, 3, 1, 12, 0) });
  const api = page.context;
  const state = page.evaluate("state");

  const dateText = (date) =>
    date.getFullYear() + "-" + String(date.getMonth() + 1).padStart(2, "0") + "-" + String(date.getDate()).padStart(2, "0");
  // vm の中で作られた配列は realm が違い deepEqual が通らないため、Array.from で作り直す。
  const eventLines = (events) => Array.from(events, (event) => [event.taxKey, event.label, event.amount, dateText(event.date)].join("|"));

  function corporate(fiscalMonth, prevYear) {
    state.corporate.fiscalMonth = fiscalMonth;
    Object.assign(state.corporate.prevYear, { corpTax: 0, residentTax: 0, enterpriseTax: 0, consumptionTaxNational: 0 }, prevYear);
    const result = api.calculateCorporate();
    return {
      summary: plain(result.summary),
      notApplicable: plain(result.notApplicable),
      months: Array.from(result.months, (month) => month.year + "/" + month.month),
      events: eventLines(result.events)
    };
  }

  function individual(input) {
    Object.assign(state.individual, {
      incomeTaxBase: 0,
      residentTaxByPeriod: [0, 0, 0, 0],
      enterpriseTaxByPeriod: [0, 0],
      consumptionTaxNational: 0
    }, input);
    const result = api.calculateIndividual();
    return { summary: plain(result.summary), notApplicable: plain(result.notApplicable), events: eventLines(result.events) };
  }

  test("現状固定: 納税カレンダーの基準年は固定した「今日」の年になる", () => {
    assert.equal(page.evaluate("BASE_YEAR"), 2026);
  });

  test("現状固定: 納税カレンダーの消費税中間回数は48万・400万・4,800万の前後で切り替わる", () => {
    const cases = [[480000, 0], [480001, 1], [4000000, 1], [4000001, 3], [48000000, 3], [48000001, 11]];
    for (const [tax, count] of cases) {
      assert.equal(api.consumptionInterimCount(tax), count, `前期の消費税国税 ${tax}`);
    }
  });

  test("現状固定: 納税カレンダー（法人）の代表的な入力（3月決算）", () => {
    const result = corporate(3, { corpTax: 1000000, residentTax: 200000, enterpriseTax: 300000, consumptionTaxNational: 2000000 });
    assert.deepEqual(result.summary, { corpTaxInterim: 500000, residentInterim: 100000, enterpriseInterim: 150000, consumptionCount: 1 });
    assert.deepEqual(result.months, ["2026/3", "2026/4", "2026/5", "2026/6", "2026/7", "2026/8", "2026/9", "2026/10", "2026/11", "2026/12", "2027/1", "2027/2"]);
    assert.deepEqual(result.events, [
      "corpTax|法人税 確定|1000000|2026-05-31",
      "residentTax|法人住民税 確定|200000|2026-05-31",
      "enterpriseTax|法人事業税 確定|300000|2026-05-31",
      "consumptionNational|消費税国税 確定|2000000|2026-05-31",
      "consumptionLocal|地方消費税 確定|564103|2026-05-31",
      "corpTax|法人税 中間|500000|2026-11-30",
      "residentTax|法人住民税 中間|100000|2026-11-30",
      "enterpriseTax|法人事業税 中間|150000|2026-11-30",
      "consumptionNational|消費税国税 中間|1000000|2026-11-30",
      "consumptionLocal|地方消費税 中間|282051|2026-11-30"
    ]);
  });

  test("現状固定: 納税カレンダー（法人）の中間納付は前期法人税20万円ちょうどでは出ず、1円超えると出る", () => {
    const at = corporate(3, { corpTax: 200000, residentTax: 50000, enterpriseTax: 40000, consumptionTaxNational: 480000 });
    assert.deepEqual(at.summary, { corpTaxInterim: 0, residentInterim: 0, enterpriseInterim: 0, consumptionCount: 0 });
    assert.deepEqual(at.notApplicable, { corpTax: true, residentTax: true, enterpriseTax: true, consumptionNational: true, consumptionLocal: true });
    assert.deepEqual(at.events, [
      "corpTax|法人税 確定|200000|2026-05-31",
      "residentTax|法人住民税 確定|50000|2026-05-31",
      "enterpriseTax|法人事業税 確定|40000|2026-05-31",
      "consumptionNational|消費税国税 確定|480000|2026-05-31",
      "consumptionLocal|地方消費税 確定|135385|2026-05-31"
    ]);

    // 中間納付額は端数を丸めず、半分の値（小数）のまま持つ
    const over = corporate(3, { corpTax: 200001, residentTax: 50001, enterpriseTax: 40001, consumptionTaxNational: 480001 });
    assert.deepEqual(over.summary, { corpTaxInterim: 100000.5, residentInterim: 25000.5, enterpriseInterim: 20000.5, consumptionCount: 1 });
    assert.deepEqual(over.notApplicable, { corpTax: false, residentTax: false, enterpriseTax: false, consumptionNational: false, consumptionLocal: false });
    assert.deepEqual(over.events.slice(5), [
      "corpTax|法人税 中間|100000.5|2026-11-30",
      "residentTax|法人住民税 中間|25000.5|2026-11-30",
      "enterpriseTax|法人事業税 中間|20000.5|2026-11-30",
      "consumptionNational|消費税国税 中間|240000.5|2026-11-30",
      "consumptionLocal|地方消費税 中間|67692|2026-11-30"
    ]);
  });

  test("現状固定: 納税カレンダー（法人）の12月決算は確定・中間とも翌年に入る（年をまたぐ）", () => {
    const result = corporate(12, { corpTax: 1000000, consumptionTaxNational: 4000001 });
    assert.deepEqual(result.summary, { corpTaxInterim: 500000, residentInterim: 0, enterpriseInterim: 0, consumptionCount: 3 });
    assert.deepEqual(result.months, ["2026/12", "2027/1", "2027/2", "2027/3", "2027/4", "2027/5", "2027/6", "2027/7", "2027/8", "2027/9", "2027/10", "2027/11"]);
    assert.deepEqual(result.events, [
      "corpTax|法人税 確定|1000000|2027-02-28",
      "consumptionNational|消費税国税 確定|4000001|2027-02-28",
      "consumptionLocal|地方消費税 確定|1128205|2027-02-28",
      "corpTax|法人税 中間|500000|2027-08-31",
      "consumptionNational|消費税国税 中間|1000000.25|2027-05-31",
      "consumptionLocal|地方消費税 中間|282051|2027-05-31",
      "consumptionNational|消費税国税 中間|1000000.25|2027-08-31",
      "consumptionLocal|地方消費税 中間|282051|2027-08-31",
      "consumptionNational|消費税国税 中間|1000000.25|2027-11-30",
      "consumptionLocal|地方消費税 中間|282051|2027-11-30"
    ]);
  });

  test("現状固定: 納税カレンダー（法人）の消費税11回中間は決算月の3か月後から毎月並ぶ", () => {
    const result = corporate(1, { consumptionTaxNational: 48000001 });
    assert.equal(result.summary.consumptionCount, 11);
    const national = result.events.filter((line) => line.startsWith("consumptionNational|"));
    assert.equal(national.length, 12);
    assert.equal(national[0], "consumptionNational|消費税国税 確定|48000001|2026-03-31");
    assert.equal(national[1], "consumptionNational|消費税国税 中間1|4000000.0833333335|2026-04-30");
    assert.equal(national[11], "consumptionNational|消費税国税 中間11|4000000.0833333335|2027-02-28");
    const local = result.events.filter((line) => line.startsWith("consumptionLocal|"));
    assert.equal(local[0], "consumptionLocal|地方消費税 確定|13538462|2026-03-31");
    assert.ok(local.slice(1).every((line) => line.includes("|1128205|")), local.join("\n"));
  });

  test("現状固定: 納税カレンダー（法人）の2月決算と決算月未選択", () => {
    const february = corporate(2, { corpTax: 400000 });
    assert.deepEqual(february.events, ["corpTax|法人税 確定|400000|2026-04-30", "corpTax|法人税 中間|200000|2026-10-31"]);

    const unselected = corporate("", { corpTax: 1000000 });
    assert.deepEqual(unselected.months, []);
    assert.deepEqual(unselected.events, []);
    assert.deepEqual(unselected.summary, { corpTaxInterim: 500000, residentInterim: 0, enterpriseInterim: 0, consumptionCount: 0 });
    assert.deepEqual(unselected.notApplicable, { corpTax: true, residentTax: true, enterpriseTax: true, consumptionNational: true, consumptionLocal: true });
  });

  test("現状固定: 納税カレンダー（個人）の所得税予定納税は予定納税基準額15万円の前後で切り替わる", () => {
    const below = individual({ incomeTaxBase: 149999 });
    assert.equal(below.summary.incomeTaxPredict, 0);
    assert.deepEqual(below.events, []);
    const at = individual({ incomeTaxBase: 150000 });
    assert.equal(at.summary.incomeTaxPredict, 50000);
    assert.deepEqual(at.events, ["incomeTax|所得税予定 第1期|50000|2026-07-31", "incomeTax|所得税予定 第2期|50000|2026-11-30"]);
  });

  test("現状固定: 納税カレンダー（個人）の代表的な入力", () => {
    const result = individual({
      incomeTaxBase: 1000000,
      residentTaxByPeriod: [25000, 25000, 25000, 25000],
      enterpriseTaxByPeriod: [30000, 30000],
      consumptionTaxNational: 600000
    });
    assert.deepEqual(result.summary, { incomeTaxPredict: 333333, consumptionCount: 1 });
    assert.deepEqual(result.events, [
      "incomeTax|所得税予定 第1期|333333|2026-07-31",
      "incomeTax|所得税予定 第2期|333333|2026-11-30",
      "residentTax|個人住民税 1期|25000|2026-06-30",
      "residentTax|個人住民税 2期|25000|2026-08-31",
      "residentTax|個人住民税 3期|25000|2026-10-31",
      "residentTax|個人住民税 4期|25000|2027-01-31",
      "enterpriseTax|個人事業税 1期|30000|2026-08-31",
      "enterpriseTax|個人事業税 2期|30000|2026-11-30",
      "consumptionNational|消費税国税 中間|300000|2026-08-31",
      "consumptionLocal|地方消費税 中間|84615|2026-08-31",
      "consumptionNational|消費税国税 確定|600000|2027-03-31",
      "consumptionLocal|地方消費税 確定|169231|2027-03-31"
    ]);
  });

  test("現状固定: 納税カレンダー（個人）の消費税中間3回・11回の並び（年をまたぐ）", () => {
    const three = individual({ consumptionTaxNational: 4000001 });
    assert.deepEqual(three.events.filter((line) => line.startsWith("consumptionNational|")), [
      "consumptionNational|消費税国税 中間|1000000.25|2026-05-31",
      "consumptionNational|消費税国税 中間|1000000.25|2026-08-31",
      "consumptionNational|消費税国税 中間|1000000.25|2026-11-30",
      "consumptionNational|消費税国税 確定|4000001|2027-03-31"
    ]);

    const eleven = individual({ consumptionTaxNational: 48000001 });
    const national = eleven.events.filter((line) => line.startsWith("consumptionNational|"));
    assert.equal(national.length, 12);
    assert.equal(national[0], "consumptionNational|消費税国税 中間1|4000000.0833333335|2026-03-31");
    assert.equal(national[9], "consumptionNational|消費税国税 中間10|4000000.0833333335|2026-12-31");
    assert.equal(national[10], "consumptionNational|消費税国税 中間11|4000000.0833333335|2027-01-31");
    assert.equal(national[11], "consumptionNational|消費税国税 確定|48000001|2027-03-31");
  });

  test("現状固定: 納税カレンダーの円表示は四捨五入し、全角数字・△・小数点はこう読む", () => {
    const yen = [[0, "0円"], [0.5, "1円"], [1.5, "2円"], [-0.5, "-0円"], [1234567.4, "1,234,567円"], [-1234, "-1,234円"], [null, "0円"]];
    for (const [value, expected] of yen) assert.equal(api.formatYen(value), expected, `値 ${value}`);

    assert.equal(api.formatInputValue(0), "");
    assert.equal(api.formatInputValue(1234567), "1,234,567");
    assert.equal(api.formatInputValue(-500), "");

    assert.deepEqual(plain(api.normalizeMoneyText("１２３")), { text: "123", negative: false });
    assert.deepEqual(plain(api.normalizeMoneyText("△500")), { text: "500", negative: true });
    // 小数点は取り除かれ、桁がつながる
    assert.deepEqual(plain(api.normalizeMoneyText("12.5")), { text: "125", negative: false });
  });

  test("現状固定: 納税カレンダーの土日祝の判定（収録している祝日表は2026年・2027年分）", () => {
    const check = (text) => {
      const [year, month, day] = text.split("-").map(Number);
      const date = new Date(year, month - 1, day);
      return [api.formatDate(date), api.isWeekendOrHoliday(date), api.holidayName(date)];
    };
    assert.deepEqual(check("2026-05-31"), ["2026/05/31（日）", true, ""]);
    assert.deepEqual(check("2026-11-30"), ["2026/11/30（月）", false, ""]);
    assert.deepEqual(check("2026-05-06"), ["2026/05/06（水）", true, "振替休日"]);
    assert.deepEqual(check("2026-09-22"), ["2026/09/22（火）", true, "国民の休日"]);
    assert.deepEqual(check("2027-03-22"), ["2027/03/22（月）", true, "振替休日"]);
    assert.deepEqual(check("2027-03-31"), ["2027/03/31（水）", false, ""]);
    // 祝日表にない年は祝日名が空になる（2028-01-01 は土曜なので土日として判定される）
    assert.deepEqual(check("2028-01-01"), ["2028/01/01（土）", true, ""]);
  });
}

// ==================== beppyou4-keisan.html ====================
{
  // 空欄・明示的な0・数字なし・巨大桁の解析、保存データの扱い、基本の加減算1件は
  // tests/input-behavior.test.js で扱っているので、ここでは足さない。

  const page = loadPage("beppyou4-keisan.html", { now: new Date(2026, 3, 1, 12, 0) });
  const api = page.context;

  const calculate = (data) => plain(api.calculate(Object.assign({
    currentProfit: 0, additions: [], subtractions: [], afterTentative: [], lossCarryforward: 0
  }, data)));

  test("現状固定: 別表4の金額入力は全角数字・区切り・△▲・全角マイナスをこう読む", () => {
    // [入力, 入力中の整形, 確定時の整形, parseMoney の結果]
    const cases = [
      ["１，２３４，５６７円", "1234567", "1234567", 1234567],
      ["△500", "-500", "-500", -500],
      ["▲1,000", "-1000", "-1000", -1000],
      ["－300", "-300", "-300", -300],
      ["ー", "-", "", null],
      ["-", "-", "", null],
      ["007", "7", "7", 7],
      [" 2 000 ", "2000", "2000", 2000],
      // 小数点は取り除かれ、桁がつながる
      ["1.5", "15", "15", 15]
    ];
    for (const [input, typing, final, parsed] of cases) {
      assert.equal(api.normalizeMoneyText(input, false), typing, `入力中 ${input}`);
      assert.equal(api.normalizeMoneyText(input, true), final, `確定時 ${input}`);
      assert.equal(api.parseMoney(input), parsed, `parseMoney ${input}`);
    }
  });

  test("現状固定: 別表4の金額表示はマイナスを△で示し、小数は切り捨てる", () => {
    const cases = [
      [-1234, "△1,234円"],
      [1234.9, "1,234円"],
      [-0.9, "-0円"],
      [Number.NaN, "0円"],
      [0, "0円"],
      [12345678901, "12,345,678,901円"]
    ];
    for (const [value, expected] of cases) {
      assert.equal(api.formatYen(value), expected, `値 ${value}`);
    }
  });

  test("現状固定: 別表4の当期欠損に加算があるとき、仮計・合計・所得金額はマイナスのまま", () => {
    assert.deepEqual(calculate({ currentProfit: -3000000, additions: [{ amount: 500000 }] }), {
      additionTotal: 500000, subtractionTotal: 0, tentative: -2500000, afterTentativeTotal: 0, total: -2500000, income: -2500000
    });
  });

  test("現状固定: 別表4の複数行（マイナスの減算行を含む）と、欠損金控除で所得金額がちょうど0円になる入力", () => {
    assert.deepEqual(calculate({
      currentProfit: 2000000,
      additions: [{ amount: 300000 }, { amount: 200000 }],
      subtractions: [{ amount: 100000 }, { amount: -50000 }],
      afterTentative: [{ amount: 10000 }, { amount: 20000 }],
      lossCarryforward: 2480000
    }), {
      additionTotal: 500000, subtractionTotal: 50000, tentative: 2450000, afterTentativeTotal: 30000, total: 2480000, income: 0
    });
  });

  test("現状固定: 別表4の欠損金等の控除額が合計を超えると、所得金額はマイナスになる", () => {
    assert.deepEqual(calculate({ currentProfit: 1000000, lossCarryforward: 1500000 }), {
      additionTotal: 0, subtractionTotal: 0, tentative: 1000000, afterTentativeTotal: 0, total: 1000000, income: -500000
    });
  });

  test("現状固定: 別表4の旧形式の保存データ（仮計後加算がオブジェクト）は行の配列に直して読む", () => {
    const normalized = plain(api.normalizeLoadedData({
      currentProfit: "1200000",
      additions: null,
      afterTentative: {
        donation: 30000,
        withholdingTax: 4084,
        foreignTaxCredit: 0,
        custom: [{ preset: "custom", label: "その他A", amount: 1000 }]
      },
      lossCarryforward: undefined
    }));
    assert.deepEqual(normalized, {
      currentProfit: 1200000,
      additions: [],
      afterTentative: [
        { preset: "donation", label: "寄附金の損金不算入額", amount: 30000 },
        { preset: "withholding_tax", label: "法人税額から控除される所得税額", amount: 4084 },
        { preset: "custom", label: "その他A", amount: 1000 }
      ],
      lossCarryforward: 0,
      subtractions: []
    });
  });

  test("現状固定: 別表4のコピー用テキストの行は、項目名が空ならプリセット名を使う", () => {
    assert.equal(api.rowsToText([]), "なし");
    assert.equal(api.rowsToText([
      { preset: "entertainment", label: "", amount: 120000 },
      { preset: "custom", label: "", amount: -5000 },
      { preset: "donation", label: "寄附金X", amount: 1 }
    ]), "- 交際費等の損金不算入額: 120,000円\n- その他（カスタム入力）: △5,000円\n- 寄附金X: 1円");
  });
}
