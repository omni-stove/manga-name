# @manga/ui

アプリ共通の見た目の部品と、色・文字・角丸のトークン。部品は props とローカルの状態だけで動き、ストアやスキーマには依存しない。色の決まりは `src/tokens.css` の冒頭。

使う側は入口で一度だけ CSS を読む。

```ts
import '@manga/ui/tokens.css'
import '@manga/ui/base.css'
```

```sh
pnpm --filter @manga/ui test
pnpm --filter @manga/ui typecheck
```
