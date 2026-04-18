; Core lexical captures.
(comment) @comment
(string_literal) @string
(number_literal) @number

; Named syntax nodes from the grammar's public surface.
(label_definition
  name: (symbol_name) @label)

(macro_definition
  name: (symbol_name) @function.macro)

(calminstruction_definition
  name: (symbol_name) @function.special)

(parameter
  name: (symbol_name) @parameter)

; Directive-heavy statements are intentionally broad — sub-categorising
; (control vs data vs storage vs other) is left to downstream highlighters
; that read `spec/keyword-groups.json` if they need finer captures.
(directive_statement
  keyword: (directive_keyword) @keyword.directive)

(restore_statement) @keyword.directive
(purge_statement) @keyword.directive
