; Backslash is a token-terminating special character, so it cannot appear
; inside an identifier. The line parses as `foo` + `\` + `bar = 1`,
; which is an illegal instruction.
        foo\bar = 1
