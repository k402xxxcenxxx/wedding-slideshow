# 婚紗輪播

在瀏覽器裡把一個資料夾的照片和音樂排成輪播影片，可以編輯後輸出 mp4。這是純靜態網頁，所有處理都在使用者自己的瀏覽器裡完成，照片和音樂不會上傳。

需要電腦版 Chrome 或 Edge（會用到資料夾讀寫和 WebCodecs）。

## 使用方式

1. 把照片（jpg / png / webp）和歌曲（mp3 / m4a / wav / ogg / flac）放進同一個資料夾，可以有子資料夾。名稱以 `_` 或 `.` 開頭的資料夾會被略過。
2. 開啟網頁，按「選擇資料夾…」並允許讀寫。
3. 第一次開啟時會建立縮圖、分析歌曲（頭尾靜音、音量），並自動排出時間軸。
4. 在編輯器裡調整後按「儲存」，再用「輸出 mp4…」輸出影片。

工具會在你選的資料夾裡建立 `_slideshow/`：

| 路徑 | 內容 |
|---|---|
| `_slideshow/library.json` | 照片尺寸、歌曲分析結果的快取 |
| `_slideshow/thumbs/` | 縮圖 |
| `_slideshow/timeline.json` | 編輯好的時間軸（刪掉它，下次開啟就會重新自動排版） |
| `_slideshow/export/` | 輸出的 mp4 和可以接續輸出的暫存檔 |

## 部署到 GitHub Pages

把這個資料夾的檔案（`index.html`、`*.js`）放到 repo 根目錄，到 repo 的 **Settings → Pages**，Source 選 `Deploy from a branch`、分支選 `main`、資料夾選 `/ (root)`。

本機測試：`python -m http.server 8765`，然後開啟 http://localhost:8765 。
