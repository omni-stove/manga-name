# 07. 依存関係図

3 種類の依存を分けて描く。混ぜると「着手に必要なもの」と「統合に必要なもの」の区別がつかなくなる。

1. パッケージの import 依存（コード上の制約）
2. ワークストリームの着手時依存（今日から始められるかどうか）
3. ワークストリームの統合時依存（Phase 末に何が揃っている必要があるか）

## 1. パッケージの import 依存

`packages/*` は `schema` 以外を import しない。横の配線は `apps/web` が担う。`workers/api` だけは `ai` のプロンプト構築を使う。

```mermaid
graph BT
  schema["@manga/schema"]

  render["@manga/render"] --> schema
  ai["@manga/ai"] --> schema
  canvas["@manga/editor-canvas"] --> schema
  inspector["@manga/inspector"] --> schema
  diagnosis["@manga/diagnosis"] --> schema
  storage["@manga/storage"] --> schema
  ui["@manga/ui"]

  web["apps/web"] --> render & ai & canvas & inspector & diagnosis & storage & ui & schema
  desktop["apps/desktop"] --> web
  api["workers/api"] --> schema & ai

  classDef core fill:#fde68a,stroke:#b45309,color:#000
  classDef pkg fill:#dbeafe,stroke:#1d4ed8,color:#000
  classDef app fill:#dcfce7,stroke:#15803d,color:#000
  classDef srv fill:#fce7f3,stroke:#be185d,color:#000
  class schema core
  class render,ai,canvas,inspector,diagnosis,storage,ui pkg
  class web,desktop app
  class api srv
```

## 2. 着手時依存

矢印の元が揃えば着手できる。`DOC` は `03-data-model.md` と `04-diagnosis-spec.md`。
`DOC` だけに依存するものは、今日から全部同時に始められる。

```mermaid
graph LR
  DOC[("DOC<br/>03 + 04 凍結")]
  Q1{"未決 #1 #2<br/>画像プロバイダ"}
  Q3{"未決 #3<br/>認証方式"}
  Q4{"未決 #4<br/>LLM プロバイダ"}
  Q11{"未決 #11<br/>協業スコープ"}

  subgraph today["今日から着手可能"]
    direction TB
    WS01[WS-01 schema]
    WS02[WS-02 render]
    WS03[WS-03 ai-core]
    WS04[WS-04 editor-canvas]
    WS05[WS-05 inspector]
    WS06[WS-06 app-shell]
    WS07[WS-07 panel-art]
    WS08[WS-08 export]
    WS09[WS-09 reference-image]
    WS10[WS-10 diagnosis]
    WS11[WS-11 hints-overlay]
    WS12[WS-12 layout-proposal]
    WS13[WS-13 workers-api]
    WS15[WS-15 cloud-storage]
    WS16[WS-16 critique]
    WS17[WS-17 desktop-shell]
    WS19[WS-19 collaboration]
    WS20[WS-20 scribble]
  end

  subgraph nodep["依存なし"]
    WS00[WS-00 scaffold]
    WS18[WS-18 distribution]
    WS21[WS-21 e2e]
  end

  subgraph blocked["決定待ち"]
    WS03r["WS-03 実画像プロバイダ接続"]
    WS12r["WS-12 / WS-16 実 LLM 接続"]
    WS14[WS-14 auth]
    WS19r["WS-19 権限と招待"]
  end

  DOC --> today
  Q1 --> WS03r
  Q4 --> WS12r
  Q3 --> WS14
  Q11 --> WS19r

  classDef doc fill:#fde68a,stroke:#b45309,color:#000
  classDef q fill:#fee2e2,stroke:#b91c1c,color:#000
  class DOC doc
  class Q1,Q3,Q4,Q11 q
```

WS-03、WS-12、WS-16、WS-19 は Fake プロバイダや Yjs のローカル動作までは今日から進められる。実プロバイダ接続と権限設計だけが決定待ち。

## 3. 統合時依存

Phase 末に `apps/web` で配線するときに揃っている必要があるもの。矢印は「元が先に完成している必要がある」。

```mermaid
graph TD
  subgraph P1["Phase 1 コア"]
    WS00[WS-00 scaffold]
    WS01[WS-01 schema]
    WS02[WS-02 render]
    WS03[WS-03 ai-core]
    WS04[WS-04 editor-canvas]
    WS05[WS-05 inspector]
    WS06[WS-06 app-shell]
    WS07[WS-07 panel-art]
  end

  subgraph P2["Phase 2 納品"]
    WS08[WS-08 export]
    WS09[WS-09 reference-image]
    WS10[WS-10 diagnosis]
    WS11[WS-11 hints-overlay]
    WS12[WS-12 layout-proposal]
    WS21[WS-21 e2e]
  end

  subgraph P3["Phase 3 クラウド"]
    WS13[WS-13 workers-api]
    WS14[WS-14 auth]
    WS15[WS-15 cloud-storage]
    WS16[WS-16 critique]
  end

  subgraph P4["Phase 4 配布と協業"]
    WS17[WS-17 desktop-shell]
    WS18[WS-18 distribution]
    WS19[WS-19 collaboration]
    WS20[WS-20 scribble]
  end

  WS00 --> WS01
  WS01 --> WS02 & WS03 & WS04 & WS05 & WS06 & WS10 & WS13
  WS04 --> WS06
  WS05 --> WS06
  WS02 --> WS07
  WS03 --> WS07
  WS04 --> WS07
  WS06 --> WS07

  WS02 --> WS08
  WS06 --> WS08
  WS04 --> WS09
  WS07 --> WS09
  WS10 --> WS11
  WS04 --> WS11
  WS05 --> WS11
  WS07 --> WS11
  WS03 --> WS12
  WS06 --> WS12
  WS07 --> WS21

  WS03 --> WS13
  WS14 --> WS13
  WS06 --> WS15
  WS13 --> WS15
  WS14 --> WS15
  WS11 --> WS16

  WS06 --> WS17
  WS17 --> WS18
  WS06 --> WS19
  WS13 --> WS19
  WS04 --> WS20

  classDef p1 fill:#dbeafe,stroke:#1d4ed8,color:#000
  classDef p2 fill:#dcfce7,stroke:#15803d,color:#000
  classDef p3 fill:#fef3c7,stroke:#b45309,color:#000
  classDef p4 fill:#fce7f3,stroke:#be185d,color:#000
  class WS00,WS01,WS02,WS03,WS04,WS05,WS06,WS07 p1
  class WS08,WS09,WS10,WS11,WS12,WS21 p2
  class WS13,WS14,WS15,WS16 p3
  class WS17,WS18,WS19,WS20 p4
```

## 4. モックの供給関係

誰が最初に何を commit すると、誰が解放されるか。

```mermaid
graph LR
  WS01 -- "dist/schema.json" --> WS03 & WS12
  WS03 -- "createFakeImageProvider + fixtures/art/*.png" --> WS02 & WS04 & WS07 & WS08
  WS03 -- "createFakeLlmProvider" --> WS12 & WS16
  WS06 -- "createMemoryStorage" --> WS07 & WS09 & WS15
  WS10 -- "sample-page-01.diagnosis.json" --> WS11 & WS16
  WS13 -- "wrangler dev + X-Debug-User" --> WS15 & WS19

  classDef sup fill:#fde68a,stroke:#b45309,color:#000
  class WS01,WS03,WS06,WS10,WS13 sup
```

供給側は、自分の本体が完成していなくてもモックだけ先に commit する。各ブリーフにその旨を書いてある。
