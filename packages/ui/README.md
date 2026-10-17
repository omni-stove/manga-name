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

部品ごとの見た目と操作は `src/*.stories.tsx` にあり、play function が正常系の操作を確かめる。ストーリーは実ブラウザで走るので、初回は Chromium を入れる。

```sh
pnpm --filter @manga/ui exec playwright install chromium
make storybook        # http://localhost:6006
make test-storybook   # play function を headless Chromium で回す
```
