# FMT Video Saver

[![最新リリース](https://img.shields.io/github/v/release/Fortniteleakjp/fmt-video-saver?display_name=tag)](https://github.com/Fortniteleakjp/fmt-video-saver/releases)

ページ内の動画やストリームを検出し、ブラウザから保存できるManifest V3拡張機能です。

YouTubeでは、通信ごとのFMTを大量に表示せず、動画単位で次の保存方法を選択できます。

- 音声のみ（WAV）
- 映像＋音声のみ（MP4）
- サムネイルのみ（1080p相当）

HLS / DASH / F4Mの結合、ログイン中のページからのCookie利用、保存状況のプログレスバーにも対応しています。

## 最新リリース

[FMT Video Saver v0.1.0をダウンロード](https://github.com/Fortniteleakjp/fmt-video-saver/releases/tag/v0.1.0)

リリースには、Native Messaging用の [native_helper.exe](https://github.com/Fortniteleakjp/fmt-video-saver/releases/download/v0.1.0/native_helper.exe) を含めています。

## 必要な環境

- Windows 10 / 11
- Google Chrome または Microsoft Edge
- Node.js 22以上（YouTubeのチャレンジ解決用）
- `yt-dlp[default,curl-cffi]`
- `ffmpeg` / `ffprobe`

Python 3.10以上は、リリース済みの `native_helper.exe` を使わず、Nativeヘルパーをソースからビルドする場合に必要です。

## インストール

### 1. 拡張機能を読み込む

1. ChromeまたはEdgeで `chrome://extensions` を開きます。
2. 「デベロッパーモード」を有効にします。
3. 「パッケージ化されていない拡張機能を読み込む」を選択します。
4. このリポジトリのフォルダを選択します。

### 2. yt-dlpとffmpegを準備する

`yt-dlp.exe`、`ffmpeg.exe`、`ffprobe.exe`、Node.jsをPATHに追加してください。

```powershell
python -m pip install --upgrade "yt-dlp[default,curl-cffi]"
```

`yt-dlp[default,curl-cffi]` には、YouTubeのEJSソルバーと、一部サイトで必要なブラウザ偽装用の`curl_cffi`が含まれます。

HLSはメディアセグメントではなくプレイリスト（`.m3u8` / `.mpd` / `.f4m`）を選択してください。個別の`.ts`セグメントは候補一覧から除外しています。

### 3. Native Messagingヘルパーを登録する

リリースから `native_helper.exe` をダウンロードしてリポジトリのルートに置くか、ソースからビルドします。

```powershell
.\build-native-helper.ps1
```

拡張機能ページに表示される拡張機能IDを確認し、次のコマンドを実行します。

```powershell
.\install-native-host.ps1 -ExtensionId "拡張機能ID"
```

その後、Chrome / Edgeを再起動し、動画ページを再読み込みしてください。

## 使い方

1. 動画ページを開きます。
2. 必要に応じて動画を再生します。
3. ツールバーの「FMT Video Saver」を開きます。
4. 保存したい形式のボタンを押します。

保存先は既定で次のフォルダです。

```text
%USERPROFILE%\Downloads
```

保存先を変更する場合は、`FMT_VIDEO_SAVER_DOWNLOAD_DIR` 環境変数を設定してください。

## 対応形式

| 種類 | 動作 |
| --- | --- |
| MP4 / WebM / MOV / MKV / TSなど | 直接ファイルとして保存 |
| `.fmt` / `fmt` / `format` / `itag` | FMT候補として表示 |
| HLS (`.m3u8`) | yt-dlp / ffmpegで取得・結合 |
| DASH (`.mpd`) | yt-dlp / ffmpegで取得・結合 |
| F4M (`.f4m`) | Nativeヘルパー経由で取得 |
| YouTube音声 | WAVとして保存 |
| YouTube映像＋音声 | MP4として結合・保存 |
| YouTubeサムネイル | `maxresdefault.jpg`のみ保存 |

## Cookieとセキュリティ

ログインが必要な動画では、現在のタブと動画URLに適用されるCookieを取得し、一時的なNetscape形式ファイルとしてローカルNativeヘルパーへ渡します。Cookieを外部サーバーへ送信する処理はありません。

ただし、この拡張機能はCookieを読み取る権限を持ちます。コードとNativeヘルパーの内容を確認できる環境で使用し、不要になった場合は拡張機能を削除してください。

## 制限事項

- DRM保護の解除には対応していません。
- ログイン制限、地域制限、アクセス制限の回避は行いません。
- `blob:` URLや暗号化された再生APIのみを使用するサイトでは検出できない場合があります。
- サイトのCORS、Referer、Cookie、ネットワーク設定により取得できない場合があります。
- YouTubeの仕様変更により、yt-dlpやNode.jsの更新が必要になる場合があります。

動画の権利と各サイトの利用規約を確認したうえで使用してください。

## 開発用ファイル

```text
manifest.json                 拡張機能のManifest V3設定
background.js                 検出・保存・Native Messaging処理
content.js                    ページ内メディアとYouTube情報の検出
popup.html / popup.js         ポップアップUI
popup.css                    ポップアップのスタイル
native_helper.py              yt-dlp / ffmpegを呼び出すNativeヘルパー
native-host-manifest.template.json  Native Messaging設定テンプレート
```

`build/`、`dist/`、PyInstallerの`.spec`ファイル、ローカル固有のNative host manifestはGit管理対象外です。
