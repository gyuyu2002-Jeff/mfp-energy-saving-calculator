能源署節能標章資料證據

來源：類別 32（影印機）、33（印表機）的官方有效獲證清單、各產品明細，以及官方 Open Data CSV。
每個 .gz 檔案是伺服器原始回應的 gzip 快照，不是重新排版或人工摘要。
manifest.json 保存來源 URL、實際轉址、擷取時間及未壓縮內容的 SHA-256。

重建：
  python -m pip install beautifulsoup4
  python scripts/fetch_energylabel.py --offline

更新：
  python scripts/fetch_energylabel.py

腳本保留 TLS 驗證，最多同時 4 個明細請求；任何下載或格式錯誤會停止，不覆蓋最終 JSON。
TEC 僅採用明細的「典型用電量TEC(度/週)實測值」或 CSV 的「測試報告能源效率」TEC 欄位。
能源效率基準、待機功率、睡眠功率不會轉成 TEC。未刊載測試版本及電壓時為 null。
同型號不同證書均保留，不按最低 TEC 合併。原始顯像技術保存在 rawFields；無法映射 EP/IJ/HPIJ 者為 null。
needsReview=true 表示官方明細與 CSV 數值有差異，不能自動視為已消除疑義的試算依據。
missing 僅包括官方有效清單內未提供正數 TEC 的紀錄；其他歷史機型查無紀錄並不表示未曾獲證。
