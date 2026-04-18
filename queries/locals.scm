; Base scope anchors. Conservative on purpose: fasmg's symbol-class stack
; (expression / instruction / labeled, with `?`/`:`/`!` decorators) is
; richer than tree-sitter `locals.scm` can express, so consumers needing
; full shadowing semantics layer their own analyser on top of this tree.

(macro_definition
  name: (symbol_name) @local.scope)

(struc_definition
  name: (symbol_name) @local.scope)

(calminstruction_definition
  name: (symbol_name) @local.scope)

(label_definition
  name: (symbol_name) @local.definition)

(assignment_statement
  name: (identifier) @local.definition)

(parameter
  name: (symbol_name) @local.definition)

(identifier) @local.reference
