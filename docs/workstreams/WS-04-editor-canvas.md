# WS-04 editor-canvas

Phase 1 / 開発中の依存: DOC のみ / パッケージ: `packages/editor-canvas`

## 目的
1 ページを SVG で描き、コマ割りとフキダシを操作し、生成画像をコマ内に表示する React コンポーネント。Phase 2 で焦点、ベクトル、診断オーバーレイ（WS-11）、参考画像（WS-09）が載る。

## 公開 API
```ts
type Selection = { kind: 'panel' | 'bubble' | 'focus' | 'vector'; id: ID } | null;
type Tool = 'select' | 'panel' | 'bubble' | 'focus' | 'vector' | 'scribble';

interface EditorCanvasProps {
  page: Page;
  settings: ProjectSettings;
  characters: Character[];
  diagnosis: PageDiagnosis | null;               // Phase 2
  selection: Selection;
  tool: Tool;
  layers: { reference: boolean; art: boolean; scribble: boolean; hints: boolean; diagnosis: boolean };
  /** 生成中のコマ。スピナーを重ねる */
  generating: Set<ID>;
  onChange(patch: Patch): void;                  // page を root とした JSON Patch
  onSelect(sel: Selection): void;
  onGenerate?(panelId: ID): void;                // コマのホバーに出す「生成」ボタン
  resolveAsset(ref: string): Promise<string>;
}
export function EditorCanvas(props: EditorCanvasProps): JSX.Element;
```

## 描画仕様
- ページ: 白地。`pageSize` のアスペクト比。
- コマ枠: 黒 1px。右上に赤丸の番号。選択中は青枠。
- 生成画像: `currentArt` の `ref` を `resolveAsset` で解決し、`<image>` を `rect` に `preserveAspectRatio="xMidYMid slice"` で配置、`<clipPath>` で枠にクリップ。未生成コマは白地に `camera` と `note` を灰色で表示。`generating` に含まれるコマは半透明の白とスピナーを重ねる。
- フキダシ: `shape` ごとの輪郭（normal 楕円、shout ギザギザ、thought 雲、narration 角丸）。中にセリフを縦書き（SVG `writing-mode: vertical-rl`）。収まらなければ末尾を省略記号にする。順番を小さく表示。`tail` があればしっぽ。
- レンダラ（WS-02）と見た目を揃えるが、文字の折り返し位置までの一致は求めない。
- 焦点、ベクトル、診断オーバーレイは Phase 2（WS-11）で足す。レイヤーの枠だけ用意する。

## 操作
- `panel` ツール: ドラッグで矩形作成。既存コマを選択して分割（縦 / 横）、結合、ハンドルでリサイズ。隣接コマの端をスナップ（0.01 以内）。分割後は `order` を rtl 順で振り直す。
- `bubble` ツール: クリックで `createBubble` 相当の Bubble を作成。ドラッグで移動、ハンドルでリサイズ、しっぽの先端をドラッグ。
- `select`: クリックで選択、ドラッグで移動。
- Delete キーで選択要素を削除。
- Undo / Redo はキャンバスの責務ではない。`onChange` を出すだけ。
- ドラッグ中は Patch を出さず、pointerup で 1 回だけ出す。

## モック
- 型は `src/contract.ts` に写す。
- 画像は `docs/fixtures/art/*.png` を `resolveAsset` でそのまま返す。
- `src/dev/` に Vite プレイグラウンド。フィクスチャをロードし、`onChange` をローカル state に適用して動作確認する。

## 受け入れ条件
- [ ] フィクスチャを描画するとコマ 6 とフキダシ 3 が見え、セリフが縦書きで出る
- [ ] `arts` にフィクスチャ画像を入れるとコマ内に表示される
- [ ] 上記の全操作が `onChange` の JSON Patch として出る。Patch の path はページ root 基準
- [ ] ズームとパン（ホイール、ピンチ、Space ドラッグ）
- [ ] 60fps を維持（フキダシのドラッグ中に再描画がもたつかない）
- [ ] `diagnosis: null` で動く
- [ ] キーボードだけで選択要素を 0.01 刻みで移動できる
