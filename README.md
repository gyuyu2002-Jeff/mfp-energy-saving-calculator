# 事務機節能計算器

線上網站：https://gyuyu2002-jeff.github.io/mfp-energy-saving-calculator/

以每週典型用電量（TEC，kWh/週）評估單一機型或多台設備組合的用電、電費與碳排差額。正值代表節省，負值代表增加；此工具不包含租金、購機、耗材或維修成本。

預設為 1 台 30 張／分的通用舊機情境（TEC 1.6，非官方實測），比較 1 台 Ricoh IM C3010（30 張／分，互盛能源署紀錄 TEC 0.8）。還原設定與初始多台組合均採相同配置。

TEC 拉桿常用範圍為 0～5 kWh／週；選到較高 TEC 機型或直接輸入高值時，會以 5 為間距延伸上限並同步刻度。拖動時保持範圍穩定，切回一般機型或還原設定時縮回常用範圍。

## TEC 資料規則

1. 優先採經濟部能源署（原能源局）影印機／印表機的**實測 TEC 欄位**，不採合格門檻。
2. **Ricoh 同型號有互盛有效節能標章時，只採用互盛；互盛沒有有效標章時，才採台灣理光。**互盛有有效標章但實測 TEC 缺漏或來源衝突時，該型號列待核實，不自動改採台灣理光或 ENERGY STAR 補值。
3. 其餘機型只有查無同型號可用政府實測 TEC，才使用 ENERGY STAR 官方現行或歷史紀錄。依上述公司優先規則篩選後，同型號不同證書、不同 TEC 仍分別保留，不挑最低值。現行原版紀錄優先於歷史紀錄；翻新版本不取代原版。
4. 查核日期、原始連結、獲證公司官方全名、證書／資料編號、可確認的標準與電壓跟隨每筆數值。獲證公司在選單、來源摘要、複製文字與 PDF 中顯示；自訂 TEC 僅將原紀錄列為調整前參考，不視為官方實測。來源沒有明列的欄位保持未知，不宣稱為 v3.0 或 110V。
5. 來源相互矛盾、只有睡眠功率 W、或兩邊都找不到可核實週 TEC 的機型，不帶入舊站估值；詳見 `data/tec-catalog.json` 的 `unresolved`、`excluded`。
6. 通用機齡值與手動調整值明確標為情境假設／自訂，不標示為官方實測或認證值。

選單的「舊版認證資料」指 ENERGY STAR 在 2019-10-11 標準改版前封存的 Version 2.0 認證清單，並非使用者操作紀錄，也不代表目前仍有效認證。

2026-11-06 快照提供 196 筆能源署及 21 筆 ENERGY STAR 來源紀錄，原清單有 47 個機型暫未納入可用 TEC。14 筆台灣理光紀錄因同型號已有互盛有效節能標章而不列入試算；另依指定排除 GreenLine IM C3000（ESUID 2634757），一般 IM C3000 舊版資料仍保留。原始資料與排除原因仍保留，數量以 `data/tec-catalog.json` 為準。

例如 IM C2010 採互盛證書 1120711續1 的 1.3 kWh/週；台灣理光證書 1150300 的 0.7 kWh/週保留為原始證據，不列入試算，也不以其他來源的 0.20 覆蓋。IM 7000 的互盛實測來源有衝突，因此列待核實，不改採台灣理光數值。

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
