; Symbol stacking: define/restore/purge and keyword shadowing
; Verified against fasmg g.l4gs

; --- Stacking with define/restore ---
define myval 1
define myval 2
define myval 3
dd myval          ; top of stack: 3
restore myval
dd myval          ; peeled to: 2
restore myval
dd myval          ; peeled to: 1

; --- Keyword shadowing ---
define db 42
dd db             ; db is now expression value 42, not a directive
restore db
db 0              ; db is a directive again

; --- Built-in $ shadowing ---
define $ 99
dd $              ; user-defined: 99
restore $         ; revert to built-in current-address

; --- purge peels one at a time ---
define pval 10
define pval 20
define pval 30
purge pval
dd pval           ; 20
purge pval
dd pval           ; 10

; --- Shadow 'if' keyword ---
define if 77
dd if
restore if

; --- reequ replaces top ---
myeq equ 1
myeq equ 2
myeq reequ 99
dd myeq           ; 99
restore myeq
dd myeq           ; 1
