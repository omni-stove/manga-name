#!/usr/bin/env -S node --no-webstorage
// --no-webstorage は、lib0 が触れる Node の localStorage が --localstorage-file 無しで毎回警告を出すため
// packages/* は拡張子無しの import と JSON の import を使い、Node の型除去だけでは読めないので tsx で読む
import { register } from 'tsx/esm/api'

register()
await import('../src/main.ts')
