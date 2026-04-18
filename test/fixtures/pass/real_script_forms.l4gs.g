; Real script forms drawn from in-the-wild fasmg sources.
; Verified against fasmg g.l4gs

; --- match with = binding ---
define MY_ARGS <42,99>
match =A,=B, MY_ARGS
  dd A
  dd B
end match

; --- else match chains ---
define PARAMS <1,2,3>

match =A, PARAMS
  dd A
else
  db 0
end match

; --- calminstruction with explicit (target) ---
calminstruction (target) MyInst arg*
  local tmp
  compute tmp, arg
  emit 4, tmp
end calminstruction

here MyInst 42

; --- Angle-bracket grouped arguments in macro ---
macro gatherer args&
end macro
gatherer <1,2,3>, <4,5,6>

; --- Leading-comma call style ---
macro _ args&
end macro
_, "file name: ", ico

; --- iterate with angle-group head (paired variables) ---
iterate <a,b>, 1,10, 2,20, 3,30
  dd a+b
end iterate

; --- Macro with ! unconditional modifier ---
macro! myfoo
  db 1
end macro
myfoo

macro mybar!
  db 2
end macro
mybar
