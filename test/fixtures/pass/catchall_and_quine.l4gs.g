; Catch-all calminstruction forms and the quine mechanism
; Verified against fasmg g.l4gs

; --- Named '?' catch-all ---
calminstruction ? n&
  stringify n
  emit lengthof n,n
end calminstruction
hello
purge ?

; --- '!' unconditional catch-all ---
calminstruction ! n&
  assemble n
end calminstruction
db 0
purge ?

; --- '?!' combined catch-all (instruction-suppress + unconditional) ---
calminstruction ?! n&
  assemble n
end calminstruction
db 0
purge ?

; --- '!?' reversed order also valid (no space before param) ---
calminstruction !?n&
  assemble n
end calminstruction
db 0
purge ?

; --- Catch-all with no space before parameter ---
calminstruction !n&
  assemble n
end calminstruction
db 0
purge ?

; --- Catch-all with ?! and no space before parameter (the quine form) ---
calminstruction ?!n&
  assemble n
end calminstruction
db 0
purge ?

; --- CALM 'take' with no space before comma (empty first arg) ---
calminstruction take_test src&
  local stk
  take stk,src      ; push src onto stk
  take,stk          ; pop from stk, discard (empty first arg)
  jno fail
  emit 2,'ok'
  exit
fail:
  emit 4,'fail'
end calminstruction
take_test hello

; --- CALM 'assemble' bypasses catch-all ---
calminstruction ! n&
  assemble n        ; executes n directly, does not re-enter catch-all
end calminstruction
db 0AAh             ; should actually emit 0xAA, not get swallowed
purge ?

; --- 'stringify' modifies variable in-place ---
calminstruction strtest src*
  stringify src
  emit lengthof src,src
end calminstruction
strtest hello
