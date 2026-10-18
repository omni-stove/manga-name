# @manga/i18n

画面に出す文言の置き場。`messages/{package}/{locale}.json` を Paraglide JS で型付きの関数（`m`）にコンパイルして export する。文言はそれを出すパッケージのファイルに置き、キーはパッケージ名を頭に付ける（`api_error_*`, `web_*` など）。LLM に送るプロンプトと開発者向けのエラーは載せない。

生成物の `src/paraglide` はコミットしない。
