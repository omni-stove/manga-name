# @manga/ui

アプリ共通の見た目の部品と、色・文字・角丸のトークン。色の決まりは `src/tokens.css` の冒頭。

ストーリーは実ブラウザで走るので、初回は Chromium を入れる。

```sh
pnpm --filter @manga/ui exec playwright install chromium
```
