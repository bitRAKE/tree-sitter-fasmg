; Basic macro, labeled macro, conditional assembly.

        macro int? number
                if number = 3
                        db 0CCh
                else
                        db 0CDh, number
                end if
        end macro

        struc POINT
                label . : qword
                .x dd ?
                .y dd ?
        end struc

start:  int 20h
my      POINT
        assert my.x - my = 0
