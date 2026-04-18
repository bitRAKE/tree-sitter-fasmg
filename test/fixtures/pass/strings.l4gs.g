; Line-based strings; doubled quote is the only escape.

        db      'Hello, world!',13,10
        db      "double-quoted"
        db      'it''s fine'            ; embedded single quote via ''
        db      "say ""hi"""            ; embedded double quote via ""
        db      'semicolons ; inside strings are literal'
        db      ''                      ; empty string
