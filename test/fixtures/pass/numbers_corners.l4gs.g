; Number-literal corner cases that fasmg g.l4gs accepts.

; --- 0x hex: separators anywhere, even immediately after 0x ---
        dd      0x_0                    ; = 0
        dd      0x_                     ; = 0
        dd      0x__0
        dd      0x0__0
        dd      0x0_
        dd      0xDEAD_BEEF
        dd      0xDE'AD'BE'EF

; --- $ hex: first char must be a hex digit ---
        dd      $A
        dd      $DEAD_BEEF
        dd      $0_0

; --- h-suffix hex: must start with 0-9, separators allowed ---
        dd      0Ah
        dd      0aH                     ; h-suffix is case-insensitive
        dd      0AH
        dd      0_h
        dd      0_0h
        dd      0'0h

; --- binary / octal / decimal separator edge cases ---
        db      0_b
        db      0_0b
        db      0''0b
        dd      0_0
        dd      1_000d
        dd      1_000_                  ; trailing separator ok
        dd      1'
        dd      1_

; --- multiple / mixed adjacent separators ---
        dd      1__0
        dd      1''0
        dd      1_'0
        dd      1'_0

; --- float: dot, exponent, f-suffix (mutually exclusive with exponent) ---
        dq      1.0
        dq      1.5e5
        dq      1.5e05
        dq      1.0e+5
        dq      1.0e-5
        dq      1e5                     ; exponent without dot
        dq      0f                      ; f-suffix without dot or exponent
        dq      1_f
        dq      1.0_f
        dq      1_.0
        dq      1._0f
        dq      3.141_592f

; --- float: separators freely in (and adjacent to) the exponent ---
        dq      1.0e_10
        dq      1.0e10_
        dq      1.0e+_10
        dq      1.0e1_0
        dq      1_0e10
        dq      1_0_.0_0
