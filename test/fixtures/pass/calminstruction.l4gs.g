; CALM DSL: labels, jumps, match with modifiers, emit.

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

        calminstruction bigendian64? value*
                emit    8, value bswap 8
        end calminstruction
