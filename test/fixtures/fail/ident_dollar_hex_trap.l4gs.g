; `$` followed by a hex digit begins a hex number, not an identifier,
; so `$foo` tokenises as `$f` (= 15) followed by `oo`, which is illegal.
        $foo = 1
