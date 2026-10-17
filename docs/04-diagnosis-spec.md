# 04. 診断仕様

`packages/diagnosis` が実装する純粋関数の仕様。入力は `Page` と `ProjectSettings`、出力は `PageDiagnosis`。
副作用なし。同じ入力には同じ出力。

診断は補助機能。結果はキャンバスのオーバーレイと、生成プロンプトに渡す `hint` に使う。

## 0. フキダシを焦点として扱う

各 `Bubble` を `{ id: bubble.id, kind: 'bubble', pos: bubble.pos, weight: 0.4 }` の焦点とみなし、Panel の `focusPoints` に合成してから以下を計算する。
以降「焦点」は FocusPoint とこの合成焦点の両方を指す。`FocusDiagnosis.kind` で区別する。

## 既定値

| 項目 | 値 |
|---|---|
| `pathBand` | 0.40（コマ高さに対する比率） |
| `requireStrongForOk` | false |
| 既定 sweep | `{ kind: 'centre', y: 0.5 }` |

## 1. 読み順の推定

Panel の配置から読み順を推定し、`Panel.order` と比較する。

1. 各 Panel の矩形中心と上端を取る。
2. 上端が近い（差が 0.03 以下）Panel を同じ段とみなす。
3. 段を上から順に並べる。段内は `direction === 'rtl'` なら右から左、`ltr` なら左から右。
4. 得られた順を `inferredOrder` に入れる。
5. `inferredOrder` と `order` の並びが一致すれば `readingOrderOk = true`。不一致なら `Issue { code: 'READING_ORDER', severity: 'warning' }` を 1 件出す。

段の判定が曖昧な変形コマ割りは、ユーザーが `order` を手で直す前提。推定は提案に留める。

## 2. 視線経路（sweep path）

Panel ごとにページ座標の点列を作る。

- `centre`: コマ内の入口側端から出口側端へ、`y = sweep.y` の水平線。`rtl` なら右端から左端。
- `polyline`: 指定点をそのままページ座標に変換。
- Panel 間は、前コマの出口点から次コマの入口点を直線で結ぶ。キャンバスでは灰色破線の斜線で描く。

ページ全体の経路は `order` 順に連結したもの。UI は各コマの水平線と、コマ間の斜線を区別して描く。

## 3. 焦点の t 値と距離

各 FocusPoint について、所属 Panel の sweep path（コマ内部分のみ）に射影する。

- `t`: 射影点の経路上の位置を `0..1` に正規化。入口が 0、出口が 1。
- `distance`: 焦点から射影点までの距離を、コマの高さで割った値。

`centre` sweep かつ `rtl` の場合、`t = 1 - pos.x`、`distance = |pos.y - sweep.y|` に単純化できる。

## 4. 誘導線の集計

FocusPoint ごとに、`targetFocusId` がその焦点を指す Vector を数える。

- `strong`: `strength === 'strong'` の本数
- `weak`: `strength === 'weak'` の本数

`targetFocusId` が省略された Vector は、終点から最も近い焦点（距離がコマ高さの 0.1 以内）を対象とみなす。該当なしなら集計しない。

`kind === 'bubble'` の焦点は bubble chain 上にあるため、常に `strong` を 1 本加算する。フキダシは最も強い視線誘導であり、経路から外れていても読者は追う、という前提。

## 5. 焦点のステータス

```
if distance <= pathBand:
    status = (requireStrongForOk && strong == 0) ? 'weak' : 'ok'
else if strong >= 1:
    status = 'ok'              # 経路から外れているが強い誘導がある
else if weak >= 1:
    status = 'weak'            # 弱い誘導しかない
else:
    status = 'miss'            # 経路外で誘導なし
```

`weak` は `Issue { code: 'FOCUS_WEAK', severity: 'info' }`、`miss` は `Issue { code: 'FOCUS_MISS', severity: 'warning' }` を出す。
`reason` には「経路から 0.45 外れており誘導線がない」のような短い説明を入れる。

## 6. フキダシ順の整合

Panel 内の Bubble を `order` 順に並べ、合成焦点の `t` が単調増加であれば `bubbleOrderOk = true`。
逆転があれば `Issue { code: 'BUBBLE_ORDER', severity: 'warning' }`。

## 7. bubble chain

ページ内の全 Bubble を「Panel.order、次に Bubble.order」で並べ、`pos` をページ座標に変換して点列にする。
キャンバスではマゼンタの太線で描く。Bubble がないページでは空配列。

## 8. その他の Issue

- `EMPTY_PANEL` (info): FocusPoint も Bubble も note もない Panel。
- `OVERLAP` (error): Panel の輪郭（`shape`、無ければ `rect`）が他の Panel と重なる。共通部分は、片方の輪郭ともう片方の輪郭の凸包の共通部分として 2 通り求め、どちらも次の 3 つを満たすときに重なりとする。
  - 共通部分を囲む矩形が縦横とも 0.01 以上
  - 厚み（共通部分の面積 ÷ 囲む矩形の対角線）が 0.01 / √2 以上。斜めの辺を共有して接するだけの 2 コマは共通部分が線分になり、囲む矩形だけでは重なりと区別できないため
  - 2 通りとも満たす。凹んだ輪郭の凹みに接するだけのコマを、凸包の側で重なりと誤らないため

## 9. 集計

`summary = { total, ok, weak, miss }`。`total` は合成焦点を含む全焦点数。

## 10. 生成ヒント

Panel ごとに `hint` を 1 文で作る。焦点を `t` の昇順に並べ、「視線は <位置> の <label> から <位置> の <label> へ流れる」の形にする。位置は `pos` を 3x3 の格子（右上、中央、左下など）に丸めた日本語。
合成焦点の label は「フキダシ」とする。焦点が 1 つなら「視線は <位置> の <label> に集まる」。焦点がなければ空文字。`weight` が 0.5 以上の焦点には「大きく」を添える。
`miss` の焦点は含めない。ヒントは生成プロンプトにそのまま連結するので、記号や改行を入れない。

## フィクスチャの期待値

`docs/fixtures/sample-page-01.json` に対する期待値。`centre` sweep、`rtl`、既定の閾値。bubble の行は合成焦点。

| Panel | 焦点 | 期待 t | 期待 status |
|---|---|---|---|
| 1 | glass-crystal forest | 0.35 | ok |
| 1 | E tiny, walking | 0.70 | ok |
| 1 | bubble 1 | 0.08 | ok |
| 2 | E masked, intent | 0.25 | ok |
| 2 | sample vial, glowing spores | 0.55 | ok |
| 3 | bubble 3 | 0.15 | ok |
| 3 | E looks up | 0.55 | ok |
| 4 | beast porcelain mask | 0.55 | ok |
| 4 | E crouched, still | 0.18 | ok |
| 5 | E eyes behind lenses | 0.38 | ok |
| 6 | bubble 6 | 0.15 | ok |
| 6 | fresh sprouts in footprint | 0.60 | ok |

`readingOrderOk = true`、全 Panel で `bubbleOrderOk = true`、`miss = 0`。
t の許容誤差は ±0.02。

テストは「同じフィクスチャの E crouched を `pos.y = 0.95` に動かしたとき `miss` になる」「Panel 2 と 3 の `order` を入れ替えたとき `READING_ORDER` が出る」も含めること。

Panel 4 の `hint` の期待値: 「視線は中央の beast porcelain mask を大きく捉え、右下の E crouched, still へ流れる」に相当する内容。文言の完全一致は求めず、label の出現順と「大きく」の有無をテストする。
