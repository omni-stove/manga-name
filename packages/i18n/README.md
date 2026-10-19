# @manga/i18n

画面に出す文言の置き場。`messages/{package}/{locale}.json` を Paraglide JS で型付きの関数（`m`）にコンパイルして export する。文言はそれを出すパッケージのファイルに置き、キーはパッケージ名を頭に付ける（`api_error_*`, `web_*` など）。

どのパッケージでも同じ意味で出す一般的な語（「キャンセル」「閉じる」「削除」など）は `messages/common` に一つずつ置き、キーは語そのものにする（`cancel`, `remove`）。

`@manga/schema` の概念、プロパティ、enum 値の名前は `messages/schema` に一つずつ置き、どのパッケージもそれを使う。キーはスキーマをたどった snake_case にする（`character`, `character_short_name`, `bubble_shape_shout`）。同じ名前のプロパティでも概念ごとに呼び名が違うので、概念ごとに別のキーにする（`page_note` は「メモ」、`panel_note` は「指示メモ」）。
