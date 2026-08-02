# FMT Video Saver v0.1.0

ブラウザ上の動画を検出し、用途別に保存できるManifest V3拡張機能です。

## 主な機能

- YouTube動画を1件にまとめて検出
- YouTubeの音声のみをWAVで保存
- YouTubeの映像＋音声をMP4に結合して保存
- YouTubeの1080p相当サムネイルを個別保存
- MP4、WebM、MOV、MKV、TSなどの直接動画URLを検出
- HLS、DASH、F4Mストリームをyt-dlpとffmpegで結合
- ログイン中のページのCookieを使用した取得
- 保存処理の進捗バー表示

## セットアップ

HLS/DASH結合とYouTube取得には、yt-dlp、ffmpeg、Node.js 22以上が必要です。

```powershell
python -m pip install --upgrade "yt-dlp[default]"
```

Native Messagingヘルパーのビルド後、拡張機能IDを指定して登録してください。

```powershell
.\build-native-helper.ps1
.\install-native-host.ps1 -ExtensionId "拡張機能ID"
```

## 注意事項

DRM保護の解除やアクセス制限の回避は行いません。CookieはローカルのNativeヘルパーへ渡されるため、内容を確認できる環境で使用してください。動画の権利および各サイトの利用規約を遵守してください。
