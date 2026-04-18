; Symbol classes: expression / instruction / labeled-instruction coexistence
; Verified against fasmg g.l4gs

; --- Same name in all three classes simultaneously ---
define bar 42           ; expression class
macro bar               ; instruction class
  db 0AAh
end macro
struc bar               ; labeled-instruction class
  label .:byte
  .x db ?
end struc

dd bar                  ; expression context -> 42
bar                     ; instruction context -> macro -> 0xAA
myobj bar               ; labeled-instruction context -> struc
dd myobj.x

; --- Per-class removal ---
define baz 42
macro baz
  db 0BBh
end macro
struc baz
  label .:byte
  .v db ?
end struc

dd baz              ; 42 (expression)
baz                 ; 0xBB (instruction)
obj baz             ; struct (labeled-instruction)

purge baz           ; remove instruction class only
dd baz              ; 42 still (expression)
obj2 baz            ; struct still (labeled-instruction)

restruc baz         ; remove labeled-instruction class
dd baz              ; 42 still (expression)

restore baz         ; remove expression class
