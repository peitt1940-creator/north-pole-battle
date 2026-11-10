# 北極 16 宮格攻防戰

老師控制台搭配紅、綠、金三組平板。每回合各組提交兩項行動，老師統一揭曉並結算。

老師登入後以學生平板畫面上的裝置 UID 配對。每組只能讀取自己的封存指令，結算後四台裝置同步顯示結果。

網站使用 Firebase Authentication 和 Realtime Database。Firebase 網頁設定由 Firebase Hosting 提供，教師授權由資料庫內的 teachers 節點管理。部署後需以虛構資料完成四台裝置測試。
