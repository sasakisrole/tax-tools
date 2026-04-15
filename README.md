# Tax Tools

> Single-HTML Japanese tax & accounting calculators — payroll withholding, officer compensation, furusato-nozei, depreciation, and more. Runs 100% in the browser (no backend, no tracking).
>
> **English:** This overview is all that's in English. The tools themselves and full documentation below are in Japanese, as they target Japanese tax law.

**公開URL**: https://sasakisrole.github.io/tax-tools/

---

日本の税務・会計実務で使う計算ツールを**単一HTML**にまとめたWebツール集。
ブラウザ完結・外部送信なし・インストール不要で使える。

## 収録ツール

### `index.html`（メイン）
- **受取利息・配当金の逆算計算**（法人用）
- **必要売上シミュレーター**
- **減価償却 耐用年数検索 / 償却計算**
- **税率一覧表**
- **主要税務スケジュール**
- **給与源泉税早見表**（月額表）
- **報酬源泉計算**
- **修繕費・資本的支出 判定フローチャート**
- **役員報酬シミュレーション**（社会保険料・手取り算出）
- **国民健康保険料シミュレーション**（大阪府統一料率）

### `beta.html`
- **各種の壁一覧**（103万/106万/130万/150万 など）
- **ふるさと納税 控除上限額シミュレーション**
- **法人・個人マネーフロー シミュレーター**
- **損益分岐点シミュレーター**

## 特徴

- **単一HTML**: 1ファイルをブラウザで開くだけ。インストール・アカウント登録不要
- **オフライン動作**: 一度開けばオフラインでも使える
- **プライバシー重視**: 入力データは一切送信しない（ブラウザ内計算のみ）
- **年度改正対応**: 令和8年（2026年）税制改正対応済み
  - 給与所得控除 +9万円特例
  - 基礎控除（所得税）逓減ルール
- **計算エンジン検証**: ゴールデンテストで計算ロジックを自動検証（ホーム画面から実行可能）

## 使い方

ブラウザで https://sasakisrole.github.io/tax-tools/ を開くだけ。

ローカルで使いたい場合：
```bash
git clone https://github.com/sasakisrole/tax-tools.git
```
して `index.html` をブラウザで開く。

## プライバシー

- 入力したデータは**ブラウザの外に一切出ません**
- GitHub Pages 経由のGoogle Analytics（PV計測のみ、個人データ送信なし）
- 詳細は [privacy.html](privacy.html)

## 年度改正チェックリスト

税制改正時の更新箇所は [TEST_CASES.md](TEST_CASES.md) を参照。

## 免責事項

本ツールは**計算の目安**を提供するものです。
実務の申告・判定にあたっては税理士・所轄税務署にご確認ください。
本ツールの計算結果に基づく判断で生じた損害について、作者は一切の責任を負いません。

## ライセンス

MIT License — [LICENSE](LICENSE) を参照
