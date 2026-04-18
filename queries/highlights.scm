; Core lexical captures.
(comment) @comment
(string_literal) @string
(number_literal) @number

; Statement-level modifiers and permissive recovery forms are useful context
; for manual diagnostics, so highlight them even when they're not part of a
; downstream editor's final theme.
(line_modifier) @attribute
(stray_bracket) @punctuation.bracket
(free_begin_clause) @keyword
(free_end_clause) @keyword

; Named syntax nodes from the grammar's public surface.
(label_definition
  name: (symbol_name) @property)

(macro_definition
  name: (symbol_name) @function)

(macro_definition
  decorator: [
    "!"
    ":"
  ] @punctuation.special)

(struc_definition
  name: (symbol_name) @type)

(struc_definition
  decorator: [
    "!"
    ":"
  ] @punctuation.special)

(calminstruction_definition
  name: (symbol_name) @function.builtin)

(calminstruction_definition
  decorator: [
    "!"
    ":"
  ] @punctuation.special)

(parameter
  name: (symbol_name) @variable.parameter)

(assignment_statement
  name: (identifier) @variable)

(instruction_statement
  name: (symbol_name) @function)

; The target binding in `calminstruction` / `struc` forms is a distinct
; interface marker worth surfacing separately from ordinary identifiers.
(calm_target
  (identifier) @type.builtin)

; Directive-heavy statements are intentionally broad — sub-categorising
; (control vs data vs storage vs other) is left to downstream highlighters
; that read `spec/keyword-groups.json` if they need finer captures.
(directive_statement
  keyword: (directive_keyword) @keyword)

(restore_statement) @keyword
(purge_statement) @keyword
