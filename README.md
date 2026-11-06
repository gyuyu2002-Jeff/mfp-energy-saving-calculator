# 事務機節能計算器

線上網站：https://gyuyu2002-jeff.github.io/mfp-energy-saving-calculator/

以每週典型用電量（TEC，kWh/週）評估單一機型或多台設備組合的用電、電費與碳排差額。正值代表節省，負值代表增加；此工具不包含租金、購機、耗材或維修成本。

## TEC 資料規則

1. 優先採經濟部能源署（原能源局）影印機／印表機的**實測 TEC 欄位**，不採合格門檻。
2. 只有查無同型號可用政府實測 TEC，才使用 ENERGY STAR 官方現行或歷史紀錄。
3. 同型號不同證書、不同 TEC 分別保留並供使用者選擇，不挑最低值。現行原版紀錄優先於歷史紀錄；翻新版本不取代原版。
4. 查核日期、原始連結、證書／資料編號、可確認的標準與電壓跟隨每筆數值。來源沒有明列的欄位保持未知，不宣稱為 v3.0 或 110V。
5. 來源相互矛盾、只有睡眠功率 W、或兩邊都找不到可核實週 TEC 的機型，不帶入舊站估值；詳見 `data/tec-catalog.json` 的 `unresolved`、`excluded`。
6. 通用機齡值與手動調整值明確標為情境假設／自訂，不標示為官方實測或認證值。

2026-11-06 快照提供 210 筆能源署及 22 筆 ENERGY STAR 來源紀錄（包含同機型不同證書），原清單有 46 個機型暫未納入可用 TEC。數量以 `data/tec-catalog.json` 為準。例如 IM C2010 政府兩張證書分別列 1.3 與 0.7 kWh/週；不以其他來源的 0.20 覆蓋。

政府明細未完整揭露逐筆測試版本與電壓。不同版本／未知條件的差額只作情境推估，不能當成相同印量條件下的實測節電率。排碳係數預設為 114 年度產業值 0.466 kg CO₂e/度，使用者更改後會標成自訂。

## 本地使用與驗證

原生 HTML/CSS/JavaScript，沒有框架或建置服務。兩個 HTML 入口共用 `assets/`，可用靜態伺服器開啟：

```sh
python -m http.server 8765 --bind 127.0.0.1
```

另一終端執行：

```sh
python -m pip install -r scripts/requirements.txt
node --test tests/calculator.test.js
python -m unittest discover -s tests -p test_catalog.py
node --test tests/browser-regressions.cjs
```

瀏覽器回歸測試需 Playwright 與 Chromium：`npm install --no-save playwright@1.61.1`、`npx playwright install chromium`。測試預設連線到 `http://127.0.0.1:8765/`。

## 更新資料

```sh
# 完整重新查核官方來源
python scripts/sync_mfp_models.py

# 不連網，從保留的原始證據重建
python scripts/sync_mfp_models.py --offline
```

每月 GitHub Actions 安裝依賴，先抓能源署再抓 ENERGY STAR；來源或驗證失敗即中止，不提交部分資料。原始 HTML／CSV／JSON／歷史 XLSX 與雜湊放在 `data/*-evidence/`；網頁只載入產生的 `assets/tec-data.js`，不需訪客即時向官方網站查詢。

`index.html` 是版型來源，`mfp-tec-deck.html` 在同步流程中更新為相同內容。修改後須執行離線同步及回歸測試。

## PDF 與隱私

PDF 套件 html2pdf.js 0.14.0 隨網站託管，按下載時才載入；套件授權、npm 完整性及 SHA-256 保留在 `assets/vendor/`。手機匯出使用固定 A4 版面，列印／另存可使用瀏覽器的文字型 PDF。計算與報告於瀏覽器本機完成，程式不儲存或傳送試算輸入；字型仍由 Google Fonts 載入。

## 官方參考

- [能源署產品查詢](https://ea03.moeaea.gov.tw/e0410/01/purchasing/product/upt.aspx?p0=32)
- [能源署開放資料](https://ea03.moeaea.gov.tw/e0410/01/other/opendata/list.aspx)
- [ENERGY STAR 官方影像設備資料](https://data.energystar.gov/resource/t2v6-g4nf.json)
- [ENERGY STAR 歷史清單入口](https://www.energystar.gov/products/imaging_equipment/partners)
- [114 年度電力排碳係數](https://www.moeaea.gov.tw/ECW/PDA.aspx?kind=1&news_id=34473)
