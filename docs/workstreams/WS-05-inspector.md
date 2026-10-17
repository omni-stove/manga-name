# WS-05 inspector

Phase 1 / 開発中の依存: DOC のみ / パッケージ: `packages/inspector`

## 目的
選択中の要素を編集するフォーム群。キャンバスでは扱いにくい属性（セリフ、話者、指示メモ、カメラ、キャラの外見、生成履歴）を編集する。

## 公開 API
```ts
export function PanelInspector(p: { panel: Panel; characters: Character[]; diagnosis?: PanelDiagnosis; onChange(patch: Patch): void; onGenerate(instruction?: string): void; resolveAsset(ref: string): Promise<string> }): JSX.Element;
export function BubbleInspector(p: { bubble: Bubble; characters: Character[]; onChange(patch: Patch): void }): JSX.Element;
export function CharacterInspector(p: { character: Character; onChange(patch: Patch): void; onPickReference(): void; resolveAsset(ref: string): Promise<string> }): JSX.Element;
export function PageInspector(p: { page: Page; diagnosis?: PageDiagnosis; onChange(patch: Patch): void; onGenerateAll(): void }): JSX.Element;
export function ProjectSettingsInspector(p: { settings: ProjectSettings; onChange(patch: Patch): void }): JSX.Element;
export function FocusInspector(...)、VectorInspector(...)   // Phase 2（WS-11）
export function IssueList(...)                               // Phase 2（WS-11）
```
Patch の path は渡されたオブジェクト root 基準。親への変換は `apps/web` が行う。

## 内容
- PanelInspector: order（入替 UI）、camera、note（複数行）、登場キャラ（話者と焦点から拾ったキャラは理由つきで表示、`cast` への追加と削除）、Bubble 一覧（順序入替）。生成セクション: 「生成」ボタン、修正指示のテキスト欄と「修正して再生成」、`arts` のサムネイル一覧（`artId` の切替、`instruction` と `createdAt` を表示、採用中を強調）、実際に送った `prompt` の折りたたみ表示。
- BubbleInspector: speakerId、text（複数行）、shape、order。
- CharacterInspector: name、shortName、appearance（複数行）、参照画像のサムネイルと差し替え、note。
- PageInspector: side、note、「このページを全部生成」。
- ProjectSettingsInspector: direction、pageSize、dpi、style.prompt、style.negative。

## モック
- 型は `src/contract.ts`。
- `src/dev/` でフィクスチャの各要素を順に表示するプレイグラウンド。

## 受け入れ条件
- [ ] 各フォームの全フィールドが Patch を発火する
- [ ] text / note / appearance の変更は 300ms debounce、それ以外は即時
- [ ] 不正値（dpi 範囲外など）はフォーム側で弾き、Patch を出さない
- [ ] `arts` が 3 件ある Panel で切替が `replace /artId` の Patch になる
- [ ] `diagnosis` 省略時も崩れない
