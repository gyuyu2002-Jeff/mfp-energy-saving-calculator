# 事務機 節能計算器 (MFP Energy Saving Calculator)

🌱 **企業多功能事務機（MFP）節能減碳、電費換算與 ESG 效益分析專業工具**

線上體驗：[https://gyuyu2002-jeff.github.io/mfp-energy-saving-calculator/](https://gyuyu2002-jeff.github.io/mfp-energy-saving-calculator/)

---

## 🌟 核心特色

1. **精準換機效益試算**
   - 支援 1～10 年客製評估週期與台數換算。
   - 動態計算：**年節電度數 (kWh)**、**累計省下電費 (NT$)**、**年減碳效益 (kgCO₂e)** 與 **等效吸收碳匯樹木株數**。
   - 預設指標公式透明對齊經濟部能源署最新電力排碳係數（0.494 kgCO₂e/度）與台電平均商業電費級距。

2. **完整 600+ 款多廠牌現役機種庫**
   - 深度涵蓋各大商用品牌：**Epson、Ricoh、Canon、HP、FUJIFILM、Konica Minolta、Sharp、KYOCERA、Toshiba、Brother**。
   - 保留台灣原廠官網主力機型（如 Epson 免加熱微噴影印機 EM-C8101、AM-C4000 等，TEC 僅 0.17～0.24 kWh/週）。

3. **TEC 測試原理與節能標章圖解**
   - 深度圖解典型用電量（TEC）標準量測週期（一整週工作日與週末待機模式）。
   - 完整整合專業節能分析：[影印機耗電量多少？如何計算影印機消耗電量與節能省電？（震旦集團 EOSASC）](https://www.eosasc.com.tw/mfp-power-consumption-energy-saving)。

4. **🤖 每月自動巡查排程 (GitHub Actions CI/CD)**
   - 透過 `.github/workflows/monthly-mfp-sync.yml` 排程工作流，於**每月 1 號自動連線美國能源之星 (ENERGY STAR) SODA API**。
   - 自動巡檢各大廠牌最新通過能源之星認證之多功能事務機。
   - 若有新機型推出，自動融合寫入 `index.html` 與 `mfp-tec-deck.html` 快照資料庫並提交更新，使網站永遠保持最新狀態！

---

## 📁 專案結構

```
MFP換機TEC值計算網頁/
├── .github/
│   └── workflows/
│       └── monthly-mfp-sync.yml    # 每月 1 號自動巡查新機種之 GitHub Actions 排程
├── scripts/
│   └── sync_mfp_models.py          # 能源之星 API 自動抓取、比對與快照注入腳本
├── index.html                      # 事務機 節能計算器 主入口網頁（支援 RWD & 簡報展示）
├── mfp-tec-deck.html               # 簡報式全螢幕互動看板
├── .gitignore                      # Git 忽略配置
└── README.md                       # 專案說明文件
```

---

## ⚙️ 本地運行與手動更新

### 1. 本地啟動預覽
本工具為原生純前端架構（Vanilla HTML/CSS/JS），無須任何前端編譯工具，直接使用瀏覽器開啟 `index.html` 即可：

```bash
# 也可使用任何本機靜態伺服器開啟
npx serve .
# 或
python -m http.server 8080
```

### 2. 手動觸發新機種巡查
若想立即檢查是否有新機種認證並更新網頁資料庫：

```bash
python scripts/sync_mfp_models.py
```

---

## 📄 授權與引用聲明

- TEC 測試標準依據：[ENERGY STAR Multifunction Devices (MFD) Testing Method](https://data.energystar.gov/resource/t2v6-g4nf.json)
- 節能標章與計算參考：[經濟部能源署節能標章標準](https://www.energylabel.org.tw/)
- 耗電分析專題參考：[震旦辦公設備（EOSASC）專題報導](https://www.eosasc.com.tw/mfp-power-consumption-energy-saving)
