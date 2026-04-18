; All assignment syntax forms
; Verified against fasmg g.l4gs

; --- Infix forms ---
a = 1               ; numeric constant
dd a
b := 2              ; forward-reference-safe
dd b
c =: $              ; late-binding
dd c

; --- Infix text substitution ---
d equ 4
dd d
d reequ 44          ; replace top
dd d

; --- Prefix forms ---
define e 5
dd e
redefine e 55       ; replace top
dd e

; --- label and element are prefix ---
label f:dword at $
dd f
element g

; --- outscope with equ ---
macro defglobal name*, val*
  outscope name equ val
end macro

defglobal myglob, 42
dd myglob
