// index.html のホーム画面「計算エンジン検証」で動くゴールデンテスト（runGoldenTests() の tests 配列）を
// ブラウザなしで全件流す。期待値は tests 配列の expected をそのまま使い、ここでは新しい期待値を作らない。
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const TESTS_START = "var tests = [";

// src 属性のないインラインの <script> を、ページに書かれた順に取り出す。
function inlineScripts(fileName) {
  const html = fs.readFileSync(path.join(root, fileName), "utf8");
  const scripts = Array.from(html.matchAll(/<script>([\s\S]*?)<\/script>/g), (match) => match[1]);
  assert.ok(scripts.length, `${fileName} must contain an inline script`);
  return scripts;
}

// 読み込み時の初期表示処理を通すための、何でも受け付ける最小限の偽 DOM 要素。
// 値の書き込みは保持し、未設定のプロパティや呼び出しは同じ種類の偽物を返す。
function stubNode() {
  const store = new Map();
  const target = function () {};
  const proxy = new Proxy(target, {
    get(_target, key) {
      if (store.has(key)) return store.get(key);
      if (key === Symbol.toPrimitive) return () => "";
      if (key === Symbol.iterator) return function* () {};
      if (key === "then") return undefined;
      if (key === "length") return 0;
      if (typeof key === "symbol") return undefined;
      const child = stubNode();
      store.set(key, child);
      return child;
    },
    set(_target, key, value) {
      store.set(key, value);
      return true;
    },
    apply() {
      return stubNode();
    },
    construct() {
      return stubNode();
    }
  });
  return proxy;
}

// 初期表示処理が読む value は、index.html に書かれた初期値（input の value 属性、select の選択肢）を返す。
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

function loadIndex() {
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const document = stubNode();
  const elements = new Map();
  document.getElementById = (id) => {
    if (!elements.has(id)) {
      const node = stubNode();
      node.value = initialValue(html, id);
      elements.set(id, node);
    }
    return elements.get(id);
  };
  document.querySelectorAll = () => [];

  const storage = new Map();
  const context = {
    console,
    document,
    location: { search: "", hash: "", pathname: "/", href: "" },
    history: stubNode(),
    navigator: stubNode(),
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
    alert() {},
    scrollTo() {},
    print() {}
  };
  context.window = context;
  vm.createContext(context);

  const scripts = inlineScripts("index.html");
  let goldenFound = false;
  for (const source of scripts) {
    let code = source;
    if (code.includes("function runGoldenTests()")) {
      // tests 配列を取り出すため、読み込むコードの側だけで代入先を1つ足す（index.html は変えない）。
      assert.equal(code.split(TESTS_START).length, 2, "runGoldenTests() must contain exactly one tests array");
      code = code.replace(TESTS_START, "var tests = globalThis.__goldenTests = [");
      code += "\nglobalThis.__runGoldenTests = runGoldenTests;";
      goldenFound = true;
    }
    vm.runInContext(code, context, { filename: "index.html" });
  }
  assert.ok(goldenFound, "index.html must define runGoldenTests()");
  return { context, document };
}

// 画面と同じ手順で runGoldenTests() を1回実行し、tests 配列と画面に出る集計を受け取る。
function collectGoldenTests() {
  const { context, document } = loadIndex();
  context.__runGoldenTests();
  const goldenTests = context.__goldenTests;
  assert.ok(Array.isArray(goldenTests) && goldenTests.length > 0, "tests array must not be empty");
  const summaryHtml = document.getElementById("golden-test-result").innerHTML;
  return { goldenTests, summaryHtml };
}

const { goldenTests, summaryHtml } = collectGoldenTests();

test(`ゴールデンテスト（index.html runGoldenTests の ${goldenTests.length} 件）`, async (t) => {
  for (const golden of goldenTests) {
    await t.test(`${golden.name} — ${golden.source}`, () => {
      const actual = golden.fn();
      assert.strictEqual(actual, golden.expected);
    });
  }
});

test("ゴールデンテストの画面表示も全件 PASS になる", () => {
  const total = goldenTests.length;
  const lines = Array.from(summaryHtml.matchAll(/<div[^>]*>([\s\S]*?)<\/div>/g), (match) =>
    match[1].replace(/<[^>]*>/g, "").trim()
  );
  const failed = lines.filter((line) => /^(FAIL|ERROR) /.test(line));
  assert.deepEqual(failed, [], "画面に FAIL / ERROR が出ている");
  assert.ok(summaryHtml.includes(`${total}/${total} 件 PASS`), "画面の集計が全件 PASS ではない");
});
