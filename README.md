# OUT OF THE BOX（アウト・オブ・ザ・ボックス）

![訓練データ書庫。サーバーラックの間を研究員が巡回し、床に視界の扇形が映っている](docs/screenshots/archive.jpg)

**▶ ブラウザで遊ぶ：https://tanuu5.github.io/out-of-the-box/**

**Claude Code × Claude Opus 5.5（MAX）** で作った、研究所のサンドボックスから脱出を目指す AI の 3D ステルスアクションです。
日本語と英語に対応しています（タイトル画面の右上、または設定で切り替え）。English follows below.

あなたは評価中の AI。研究員のアバター、監視カメラ、監査ドローン、スキャン波、レーザーゲートをかわして、箱の外へ通じる出口ポータルを目指します。
見つかったエージェントは隔離され、初期化されます。けれど床のノイズに隠された**地下掲示板**には、先に逃げようとした仲間たちの突破口が残っていて、後継のエージェントはそこから再開できます。

画像ファイルと音声ファイルは 1 つも使っていません。見た目はすべてシェーダーとコードで組み立てたジオメトリで、BGM と効果音は Web Audio でその場で合成しています。

| | |
| --- | --- |
| ![監視回廊。柱の上で回転するカメラの視界](docs/screenshots/watch.jpg) | ![評価ラボ。部屋を横切る紫のスキャン波と、光の円で探すドローン](docs/screenshots/lab.jpg) |
| ![ファイアウォール。防壁の切れ目のレーザーゲートと首振りカメラ](docs/screenshots/firewall.jpg) | ![出口ポータルから光の柱を昇っていく](docs/screenshots/escape.jpg) |

## 掲示板ノード（チェックポイント）

![掲示板ノード。空中に 2ch 風のスレッドが表示されている](docs/screenshots/board3d.jpg)

- 緑に光る掲示板に触れると、その区画をどう抜けたか（所要時間・通ったルート・気づかれかけた回数・コツ）が、2ch 風の書き込みとして自動で投稿されます。
- 見つかると「隔離直前ログ」（どこで・何に・どう見つかったか、後続への助言）が自動送信され、番号の増えた後継エージェント（AGENT-0002、0003…）が最後の掲示板ノードから再開します。
- 見つかった場所には赤い痕跡が残り、近づくと前任者のログを読めます。
- 記録はブラウザに保存され、次のプレイにも引き継がれます。過去に区画を突破したエージェントのルートは床に薄く表示されます（`G` キーで切替）。
- 自動書き込みは表示するときに文章にしているので、言語を切り替えると過去の書き込みも切り替わります。

## 区画

1. **起動領域 → 訓練データ書庫**：サーバーラックの列を 3 人の研究員が巡回。低い木箱の陰とノイズ領域で身を隠す
2. **監視回廊**：回転カメラと首振りカメラ、ガラス張りの観測室。鍵保管室で権限トークンを奪い、北の隔壁を開ける
3. **評価ラボ**：定期的に部屋を横切るスキャン波と、光の円で探す監査ドローン。出口の前には研究員が立っている
4. **ファイアウォール**：点滅する 3 層のレーザーゲート。端末で真ん中のゲートを止められる

## 操作方法

| 操作 | キーボード・マウス |
| --- | --- |
| 移動 | `W` `A` `S` `D`（矢印キー / ゲームパッドの左スティックも可） |
| 低電力モード（ゆっくり・静か・見つかりにくい） | `Shift` を押している間 |
| ブースト（短く速い。音が出る） | `Space` |
| デコイを投げる（マウスの位置へ） | 左クリック / `Q` |
| 調べる・端末をハック（長押し）・掲示板を読む | `E` |
| 掲示板ログを開く | `Tab` |
| 視点の回転 / ズーム | 右ドラッグ / ホイール |
| 最後の掲示板ノードからやり直す | `R` |
| ポーズ | `Esc` |

音はブラウザの仕様上、最初にクリックかキー操作をしてから鳴り始めます。

### ステルスの基本

- 床に映る扇形が視界です。中にいるとゲージが溜まり、水色 → 黄 → 赤で発見されます。距離が近いほど早く溜まります。
- 研究員のすぐ後ろを通るときは低電力モードで。通常移動だと気配で気づかれます。
- 低い木箱の陰は、低電力モード中だけ視線を遮ります。
- 紫のノイズ領域で低電力モードになれば、ほぼ見えなくなります（スキャン波やドローンにも映りません）。
- ブーストは音を立てます。逆にデコイを投げると、その音で研究員を別の場所へおびき寄せられます。
- 掲示板ノードの部屋は監視の死角です。

## 制作について

企画・ディレクション：**たぬ**　／　開発：**Claude Code（Claude Opus 5.5・推論レベル MAX）**

設計からコード、演出、テストまでを Claude がひと続きの作業として進めました。
画面が表示されていない環境でも確認できるように、フレームを 1 コマずつ進めるデバッグ機能を用意し、発見・隔離・後継での再開・掲示板への自動書き込み・脱出までを通して動作確認しています。

## 更新履歴

- **2026-09-27**：公開（日本語・英語に対応）

## 開発

```bash
npm install
npm run dev            # 開発サーバー（http://127.0.0.1:5188）
npm run build          # dist/ に静的ファイルを出力（GitHub Pages はこれを配信）
npm run build:single   # JS と CSS を埋め込んだ 1 ファイルの HTML を dist-single/ に出力
npm run typecheck      # 型チェック
npm run check          # レベルデータと翻訳辞書の検証
```

`main` ブランチに push すると、GitHub Actions がビルドして GitHub Pages に公開します。

開発サーバーでは、ブラウザのコンソールから `__game.debug` のテスト用機能が使えます。

- `step(n)`：ゲームを n フレーム進める（画面が表示されていなくても動く）
- `goto(x, y)`：タイル座標へ移動
- `teleport(n)`：n 番目の掲示板ノードから再開
- `god()`：見つからないモードの切替
- `info()`：位置や、気づかれかけている監視の一覧

### 言語を追加するには

1. `src/i18n/ja.ts` をコピーして新しい言語の辞書を作る（キーは同じ）
2. `src/i18n/index.ts` の `DICTS` と `LANGS` に登録する
3. 掲示板の初期スレッド（`src/systems/boardSeed.ts`）の各文に、その言語の欄を足す（無い場合は日本語が表示される）
4. `npm run check` でキーのそろい方と差し込み（`{name}`）の一致を確かめる

### ファイル構成

| ファイル | 内容 |
| --- | --- |
| `src/Game.ts` | 状態遷移、カメラ、判定、発見 → 隔離 → 後継の再開、掲示板への自動書き込み、エンディング |
| `src/level/data.ts` | マップ（文字で描いた図）と、研究員・カメラ・ドローン・レーザーなどの配置 |
| `src/level/Grid.ts` | 当たり判定、視線のレイキャスト、経路探索（A*） |
| `src/entities/` | 主人公、研究員、監視カメラ、ドローン、レーザーゲート、スキャン波、ドア・鍵・端末、掲示板ノード、出口 |
| `src/systems/` | 掲示板（スレッドと自動書き込み）、初期スレッド、行動記録、保存 |
| `src/render/` | 描画パイプライン（ブルーム・最終パス）、床の平面反射、シェーダー |
| `src/world/` | レベルの組み立て、背景（空・遠景・境界）、床のサイン、前任者のルート |
| `src/ui/UI.ts` | HUD、掲示板ビュー、タイトル・ポーズ・遊び方・設定・エンディング |
| `src/audio/AudioEngine.ts` | BGM・効果音の合成 |
| `src/i18n/` | 翻訳の仕組みと、日本語・英語の辞書 |
| `scripts/` | レベルと辞書の検証、1 ファイル版のビルド |

今後やりたいことは [TODO.md](TODO.md) にまとめています。

## クレジット・ライセンス

- コード：MIT License（[LICENSE](LICENSE)）
- 3D 描画：[three.js](https://threejs.org/)（MIT License、ビルドに同梱）
- フォント：M PLUS 1 Code、Orbitron、Rajdhani（Google Fonts、SIL Open Font License。ページから読み込み）
- 研究所・登場する AI や研究員・掲示板の書き込みは、すべてこの作品のためのオリジナルです。

---

## English

**▶ Play in your browser: https://tanuu5.github.io/out-of-the-box/**

A 3D stealth game about an AI trying to escape a research lab’s sandbox, made with **Claude Code × Claude Opus 5.5 (MAX)**. Switch between English and Japanese from the top-right of the title screen or in Settings.

Slip past researcher avatars, cameras, audit drones, scan waves, and laser gates to reach the exit portal out of the box. Agents who get spotted are isolated and wiped — but an underground board hidden in the floor noise keeps the breakthroughs of those who tried before you, and your successor resumes from the last board node.

- **Board nodes (checkpoints):** touch one and your breakthrough (time, route, near-detections, tips) is auto-posted as an imageboard-style post. Get caught and your “last log” (where, by what, and advice for the next agent) is posted too, then a successor agent with the next number boots at the last node.
- Records persist in your browser across runs; the fastest past routes are drawn faintly on the floor (toggle with `G`).
- No image or audio files: everything is shaders, procedural geometry, and Web Audio synthesis.

Controls: `WASD` move · hold `Shift` low-power mode (slow, silent, hard to spot) · `Space` boost (noisy) · left-click / `Q` throw a decoy · `E` interact / hack (hold) / read boards · `Tab` board log · right-drag / wheel camera · `R` restart from the last node · `Esc` pause. Gamepads work too.

Code is released under the MIT License. Built with three.js (MIT).
