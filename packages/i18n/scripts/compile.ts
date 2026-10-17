/**
 * messages/{locale}.json を src/paraglide に型付きの関数としてコンパイルする。
 * install（prepare）とルートの typecheck・test の前に走る。
 */
import { compile } from '@inlang/paraglide-js'
import { compilerOptions } from '../compiler-options.ts'

await compile(compilerOptions)
