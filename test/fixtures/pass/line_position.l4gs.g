; Line position disambiguation and label forms
; Verified against fasmg g.l4gs

; --- Label + instruction on same line ---
start:  db 0
mylab:  dd 1

; --- Area label (double colon) ---
area1:: db 2

; --- Label alone on line ---
alone:

; --- Multiple labels on same line (chained) ---
a: b: c: db 0FFh
dd a
dd b
dd c

; --- Label + labeled-instruction on same line ---
macro emit_one
  db 1
end macro

struc emit_one
  label .:byte
  .v db ?
end struc

first: second emit_one
dd second.v
