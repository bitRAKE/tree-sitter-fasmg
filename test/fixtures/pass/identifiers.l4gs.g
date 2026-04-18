; Identifier corner cases that fasmg g.l4gs accepts.

; --- ordinary names ---
        foo         = 1
        foo_bar     = 1
        foo1        = 1
        _foo        = 1
        _           = 1

; --- characters that LOOK special but are plain name chars ---
        foo@bar     = 1     ; @ is not in the special set
        foo^bar     = 1
        foo%bar     = 1
        foo$bar     = 1
        @foo        = 1     ; leading @ is fine
        ^foo        = 1
        %foo        = 1
        $G          = 1     ; $ + non-hex-digit -> identifier
        $_          = 1

; --- quotes are name chars MID-TOKEN ---
; A quote only starts a string when it's the first char of a contiguous
; non-whitespace sequence. Inside a token, it's just another character.
        foo"bar     = 1
        foo'bar     = 1
        a'b'c       = 1

; --- ? modifier ---
        foo?        = 1     ; case-insensitive suffix
        ?foo        = 1     ; whole-identifier instruction-suppression
        ?ns.foo     = 1
        ns.foo?     = 1

; --- # concatenation / context marker ---
        foo#bar     = 1
        #foo        = 1
        foo#        = 1
        foo##bar    = 1
        ##foo       = 1

; --- dot chains and leading dots ---
        ns:
        ns.x        = 1
        ns.x.y      = 1
        .anon       = 1
        ..deep      = 1
        ...deeper   = 1

; --- numeric segments after a dot (relaxed tokenisation) ---
        ns.1        = 1
        ns.01       = 1
        ns.1a       = 1
        ns.1.2.3    = 1
        ns.0x       = 1     ; even "malformed number" forms become names here
        ns.0x1      = 1
        ns.1b       = 1
        ns.1e5      = 1

; --- built-ins can be shadowed ---
        %%          = 1
        %t          = 1
        __line__    = 1

; --- unicode ---
        café        = 1
        日本        = 1
