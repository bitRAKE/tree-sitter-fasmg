; Advanced CALM: match modifiers, bracket pairs, sigils
; Verified against fasmg g.l4gs

; --- CALM match with wildcard modifiers via sigil ---
calminstruction TypedMatch source*
  local val
  ; Use / as sigil; /expression as modifier on wildcard
  match val/expression, source, /
  jyes is_expr
  emit 1, 0xFF
  exit
is_expr:
  emit 1, 0x01
end calminstruction

TypedMatch 42
TypedMatch 1+2+3

; --- CALM match with :name modifier ---
calminstruction CALL? target&
        local   condition
        match   condition:name =, target, target, :
        jno     unconditional
        check   defined condition
        jno     error
        emit    1, 0C4h
        jump    address
    error:
        err     "unrecognized syntax"
    unconditional:
        emit    1, 0CDh
    address:
        emit    2, target
end calminstruction

; --- CALM match with bracket pair for balanced matching ---
calminstruction range definition
        match   from-to, definition, ()
        emit    1, from
        emit    1, to
    done:
end calminstruction

range (10-3)-10

; --- CALM match with :number and :quoted modifiers ---
calminstruction TypeCheck source*
  local val
  match val-number, source, -
  jyes is_num
  match val-quoted, source, -
  jyes is_str
  emit 1, 0
  exit
is_num:
  emit 1, 1
  exit
is_str:
  emit 1, 2
end calminstruction

TypeCheck 42
TypeCheck 'hello'
TypeCheck foo
