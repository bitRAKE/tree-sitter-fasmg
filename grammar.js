const keywordGroups = require("./spec/keyword-groups.json");
const tokenization = require("./spec/tokenization.json");

const DIRECTIVE_KEYWORDS = [
  ...keywordGroups.controlDirectives.filter(
    (keyword) =>
      !keyword.startsWith("end ")
      && !keyword.startsWith("else")
      && keyword !== "if"
      && keyword !== "end"
      && keyword !== "match"
      && keyword !== "rawmatch"
      && keyword !== "rmatch"
      && keyword !== "while"
      && keyword !== "repeat"
      && keyword !== "rept"
      && keyword !== "iterate"
      && keyword !== "irp"
      && keyword !== "irpv"
      && keyword !== "namespace"
      && keyword !== "virtual"
      && keyword !== "postpone",
  ),
  ...keywordGroups.dataDirectives,
  ...keywordGroups.storageDirectives.filter((keyword) => keyword !== "restore" && keyword !== "purge"),
  ...keywordGroups.otherDirectives,
];

const END_KEYWORDS = keywordGroups.controlDirectives.filter((keyword) => keyword.startsWith("end "));
const BUILT_IN_SYMBOL_PATTERNS = keywordGroups.builtInSymbols.map((pattern) => new RegExp(pattern, "i"));
const WORD_OPERATOR_KEYWORDS = [...keywordGroups.wordOperators, ...keywordGroups.calmMatchModifiers];
const NUMBER_PATTERNS = [
  /0x[0-9A-Fa-f_']+/,
  /\$[0-9A-Fa-f][0-9A-Fa-f_']*/,
  /[0-9][0-9A-Fa-f_']*[hH]/,
  /[01][01_']*[bB]/,
  /[0-7][0-7_']*[oOqQ]/,
  /[0-9][0-9_']*\.[0-9][0-9_']*(?:[eE][+-]?[0-9_']*[0-9][0-9_']*|[fF])?/,
  /[0-9][0-9_']*[eE][+-]?[0-9_']*[0-9][0-9_']*/,
  /[0-9][0-9_']*[fF]/,
  /[0-9][0-9_']*[dD]?/,
];

function escapeRegex(text) {
  return text.replace(/[|\\{}()[\]^$+*?.-]/g, "\\$&");
}

function ciWord(word) {
  const pattern = word
    .split("")
    .map((character) => {
      if (/[A-Za-z]/.test(character)) {
        return `[${character.toLowerCase()}${character.toUpperCase()}]`;
      }

      return escapeRegex(character);
    })
    .join("");

  return new RegExp(pattern);
}

function ciPhrase(phrase) {
  return seq(...phrase.split(/\s+/).map((word) => keywordToken(word)));
}

function keywordToken(word) {
  return token(prec(1, ciWord(word)));
}

function keywordRule(keyword) {
  return keyword.includes(" ") ? ciPhrase(keyword) : keywordToken(keyword);
}

module.exports = grammar({
  name: "fasmg",

  word: ($) => $.identifier,

  extras: ($) => [/[ \t\r]+/, $.line_continuation, $.comment],

  externals: ($) => [$.match_pattern_text, $.free_end_clause],

  conflicts: ($) => [
    [$.parameter],
    [$.macro_definition],
    [$.struc_definition],
    [$.calminstruction_definition],
    // free_begin_clause is the opener-only fallback for block constructs
    // whose closer lives in a peer macro body. Declare conflicts so the
    // GLR parser explores both the full block and the opener-only paths
    // and prunes whichever can't complete.
    [$.namespace_block, $.free_begin_clause],
    [$.if_block, $.free_begin_clause],
    [$.while_block, $.free_begin_clause],
    [$.iterate_block, $.free_begin_clause],
    [$.repeat_block, $.free_begin_clause],
    [$.match_block, $.free_begin_clause],
    [$.virtual_block, $.free_begin_clause],
    [$.postpone_block, $.free_begin_clause],
    [$.irp_block, $.free_begin_clause],
  ],

  rules: {
    source_file: ($) => seq(repeat(choice($._statement, $._blank_line)), optional($._statement_no_nl)),

    _blank_line: () => /\n+/,

    _statement: ($) => seq($._statement_head, /\n/),

    _statement_no_nl: ($) => $._statement_head,

    _statement_head: ($) =>
      seq(
        optional(field("line_modifier", $.line_modifier)),
        choice(
          $.macro_definition,
          $.struc_definition,
          $.calminstruction_definition,
          $.if_block,
          $.match_block,
          $.while_block,
          $.repeat_block,
          $.iterate_block,
          $.irp_block,
          $.namespace_block,
          $.virtual_block,
          $.postpone_block,
          $.labeled_statement,
          $._simple_statement,
        ),
      ),

    line_modifier: ($) => prec(1, seq("{", optional($.argument_list), "}")),

    _simple_statement: ($) =>
      choice(
        $.restore_statement,
        $.purge_statement,
        $.assignment_statement,
        $.directive_statement,
        $.instruction_statement,
      ),

    labeled_statement: ($) =>
      prec.right(seq(
        $.label_definition,
        optional($._simple_statement),
      )),

    block_body: ($) =>
      prec.right(
        repeat1(
          choice(
            $._statement,
            $._blank_line,
          ),
        ),
      ),

    // Macro/struc bodies can contain `end X` clauses (e.g. `end namespace`)
    // that don't close a block opened in the body — they're emitted into
    // the caller's scope. The external scanner emits these as opaque
    // `free_end_clause` tokens only when `end` isn't followed by a closer
    // keyword (`macro`/`struc`/`calminstruction`), so the structured
    // grammar still sees its own closer correctly.
    //
    // The DUAL case — an opener whose closer is emitted by a peer macro
    // (idiomatic `macro NAME` / `macro end?.NAME?!` pair) — is handled by
    // `free_begin_clause`. When a `namespace X` (or `if`, `while`, etc.)
    // appears without its `end X` in the same body, the structured block
    // rule can't complete; free_begin_clause wins only in that case
    // because it's at lower precedence than the full block.
    permissive_block_body: ($) =>
      prec.right(
        repeat1(
          choice(
            $._statement,
            $.free_end_clause,
            $.free_begin_clause,
            $._blank_line,
          ),
        ),
      ),

    free_begin_clause: ($) =>
      prec.dynamic(-1, seq(
        choice(
          seq(keywordToken("namespace"), optional(field("arguments", $.argument_list))),
          seq(keywordToken("if"), field("condition", $.argument_list)),
          seq(keywordToken("while"), optional(field("condition", $.argument_list))),
          seq(keywordToken("iterate"), optional(field("arguments", $.argument_list))),
          seq(choice(keywordToken("repeat"), keywordToken("rept")), optional(field("arguments", $.argument_list))),
          seq(choice(keywordToken("match"), keywordToken("rawmatch"), keywordToken("rmatch")), field("pattern", $.match_pattern)),
          seq(keywordToken("virtual"), optional(field("arguments", $.argument_list))),
          seq(keywordToken("postpone"), optional(field("arguments", $.argument_list))),
          seq(choice(keywordToken("irp"), keywordToken("irpv")), optional(field("arguments", $.argument_list))),
        ),
        /\n/,
      )),

    comment: () => token(seq(";", /.*/)),

    line_continuation: () => token(seq("\\", /[ \t]*\r?\n/)),

    identifier: () =>
      token(
        prec(
          -1,
          /[^\s+\-/*=<>()\[\]{}:!,|&~`;\\#]+/,
        ),
      ),

    placeholder_name: () => token(/\?+/),

    symbol_name: ($) =>
      prec.right(
        seq(
          choice($.identifier, $.placeholder_name),
          repeat(seq("#", choice($.identifier, $.placeholder_name))),
        ),
      ),

    string_literal: () =>
      token(
        prec(
          2,
        choice(
          /'([^'\n]|'')*'/,
          /"([^"\n]|"")*"/,
        ),
        ),
      ),

    number_literal: () => token(prec(2, choice(...NUMBER_PATTERNS))),

    label_definition: ($) =>
      seq(
        field("name", $.symbol_name),
        field("operator", choice(token.immediate("::"), token.immediate(":"))),
      ),

    parameter_list: ($) => prec.right(seq($.parameter, repeat(seq(",", $.parameter)), optional(","))),

    parameter: ($) =>
      seq(
        optional("&"),
        field("name", $.symbol_name),
        repeat(choice("?", "*", "&")),
        optional(seq(":", field("default", $.argument))),
      ),

    name_list: ($) => prec.right(seq($.symbol_name, repeat(seq(",", $.symbol_name)), optional(","))),

    argument_list: ($) => prec.right(seq($.argument, repeat(seq(",", $.argument)), optional(","))),

    argument: ($) =>
      choice(
        $.angled_argument,
        prec.right(repeat1($.argument_atom)),
      ),

    instruction_argument_list: ($) =>
      prec.right(seq(
        $.instruction_argument,
        repeat(seq(",", optional($.argument))),
      )),

    instruction_argument: ($) =>
      choice(
        $.angled_argument,
        prec.right(
          seq(
            $.instruction_argument_head,
            repeat($.argument_atom),
          ),
        ),
      ),

    instruction_argument_head: ($) =>
      choice(
        $.number_literal,
        $.string_literal,
        $.built_in_symbol,
        $.sigil_token,
        $.word_operator,
        $.operator_token,
        $.identifier,
        $.parenthesized_argument,
        $.bracketed_argument,
        $.braced_argument,
      ),

    argument_atom: ($) =>
      choice(
        $.number_literal,
        $.string_literal,
        $.built_in_symbol,
        $.sigil_token,
        $.word_operator,
        $.identifier,
        $.operator_token,
        $.parenthesized_argument,
        $.bracketed_argument,
        $.braced_argument,
        $.stray_bracket,
      ),

    // fasmg's syntactical_characters (`[`/`]`/`(`/`)`/`{`/`}`) terminate
    // a token but do NOT need to balance at parse time. A stray bracket
    // (e.g., `dtail]` inside a match body where the opener lives in the
    // peer match pattern, or `current equ (` where the closer appears
    // in a later line of the peer match arm) is valid fasmg — the
    // assembler still reads tokens correctly. We accept it here as a
    // low-dynamic-precedence atom so that structured
    // `[ ... ]`/`( ... )`/`{ ... }` still wins when both halves live
    // in the same argument list.
    stray_bracket: () =>
      prec.dynamic(-10, token(choice("]", ")", "}"))),

    built_in_symbol: () => token(prec(3, choice(...BUILT_IN_SYMBOL_PATTERNS))),

    sigil_token: () =>
      token(
        prec(
          3,
          choice(
            /=:[^\s,)\]}>]+/,
            /=[A-Za-z_.?$%][^\s,()\[\]{}<>]*/,
            /`[^\s,()\[\]{}<>]+/,
            /:[A-Za-z_.?$%][^\s,()\[\]{}<>]*/,
          ),
        ),
      ),

    word_operator: () => prec.right(choice(...WORD_OPERATOR_KEYWORDS.map((keyword) => keywordRule(keyword)))),

    operator_token: () =>
      token(
        prec(
          -1,
          choice(
            ":==",
            "<>",
            "<=",
            ">=",
            "<<",
            ">>",
            "+",
            "-",
            "*",
            "/",
            "=",
            "<",
            ">",
            "&",
            "|",
            "~",
            "!",
            "?",
            ".",
            ":",
            "#",
          ),
        ),
      ),

    angled_argument: ($) =>
      prec(
        2,
        seq(
          "<",
          repeat(choice($.line_continuation, $.angled_text_fragment)),
          ">",
        ),
      ),

    angled_text_fragment: () => token(prec(1, /[^>\r\n\\]+/)),

    parenthesized_argument: ($) => seq("(", optional($.argument_list), ")"),

    bracketed_argument: ($) => seq("[", optional($.argument_list), "]"),

    braced_argument: ($) => seq("{", optional($.argument_list), "}"),

    match_pattern: ($) => choice($.argument_list, $.match_pattern_text),

    _expression: ($) =>
      choice(
        $.number_literal,
        $.string_literal,
        $.identifier,
        seq("(", $._expression, ")"),
      ),

    assignment_statement: ($) =>
      prec.right(2,
        seq(
        field("name", $.identifier),
        field("operator", choice("=", ":=", "=:", "equ", "reequ", "define", "redefine")),
        optional(field("value", $.argument_list)),
        ),
      ),

    restore_statement: ($) => seq(keywordToken("restore"), field("names", $.name_list)),

    purge_statement: ($) => seq(keywordToken("purge"), field("names", $.name_list)),

    match_statement: ($) =>
      seq(
        choice(keywordToken("match"), keywordToken("rawmatch"), keywordToken("rmatch")),
        field("pattern", $.match_pattern),
      ),

    asm_statement: ($) =>
      seq(
        keywordToken("asm"),
        field(
          "statement",
          choice(
            $.asm_virtual_statement,
            $.end_clause,
            $.labeled_statement,
            $._simple_statement,
          ),
        ),
      ),

    asm_virtual_statement: ($) =>
      seq(keywordToken("virtual"), field("arguments", $.argument_list)),

    directive_keyword: () => prec.right(choice(...DIRECTIVE_KEYWORDS.map((keyword) => keywordRule(keyword)))),

    directive_statement: ($) =>
      prec.right(
        seq(
        field("keyword", $.directive_keyword),
        optional(field("arguments", $.argument_list)),
        ),
      ),

    instruction_statement: ($) =>
      prec.right(-1,
        choice(
          seq(
            field("name", $.symbol_name),
            field("arguments", $.comma_prefixed_argument_list),
          ),
          seq(
            field("name", $.symbol_name),
            optional(field("arguments", $.instruction_argument_list)),
          ),
        ),
      ),

    comma_prefixed_argument_list: ($) => seq(",", $.argument_list),

    end_clause: () => choice(...END_KEYWORDS.map((keyword) => keywordRule(keyword))),

    macro_definition: ($) =>
      seq(
        keywordToken("macro"),
        optional("!"),
        field("name", $.symbol_name),
        repeat(field("decorator", choice(":", "!"))),
        optional(field("parameters", $.parameter_list)),
        repeat(field("decorator", choice(":", "!"))),
        /\n/,
        optional(field("body", alias($.permissive_block_body, $.block_body))),
        field("end", ciPhrase("end macro")),
      ),

    struc_definition: ($) =>
      seq(
        keywordToken("struc"),
        optional("!"),
        choice(
          seq(
            field("target", $.calm_target),
            field("name", $.symbol_name),
          ),
          field("name", $.symbol_name),
        ),
        repeat(field("decorator", choice(":", "!"))),
        optional(field("parameters", $.parameter_list)),
        repeat(field("decorator", choice(":", "!"))),
        /\n/,
        optional(field("body", alias($.permissive_block_body, $.block_body))),
        field("end", ciPhrase("end struc")),
      ),

    calminstruction_definition: ($) =>
      seq(
        keywordToken("calminstruction"),
        optional("!"),
        choice(
          seq(
            field("target", $.calm_target),
            field("name", $.symbol_name),
          ),
          field("name", $.symbol_name),
        ),
        repeat(field("decorator", choice(":", "!"))),
        optional(field("parameters", $.parameter_list)),
        repeat(field("decorator", choice(":", "!"))),
        /\n/,
        optional(field("body", $.calm_block_body)),
        field("end", ciPhrase("end calminstruction")),
      ),

    calm_target: ($) => seq("(", optional("&"), $.identifier, ")"),

    calm_block_body: ($) =>
      prec.right(
        repeat1(
          choice(
            $.calm_statement,
            $._blank_line,
          ),
        ),
      ),

    calm_statement: ($) =>
      seq(
        choice(
          $.labeled_calm_statement,
          $.calm_simple_statement,
        ),
        /\n/,
      ),

    labeled_calm_statement: ($) =>
      prec.right(
        seq(
          $.label_definition,
          optional($.calm_simple_statement),
        ),
      ),

    calm_simple_statement: ($) =>
      choice(
        $.asm_statement,
        $.match_statement,
        $.restore_statement,
        $.purge_statement,
        $.assignment_statement,
        $.directive_statement,
        $.instruction_statement,
      ),

    if_block: ($) =>
      seq(
        keywordToken("if"),
        field("condition", $.argument_list),
        /\n/,
        field("body", $.block_body),
        repeat(field("else_if_clauses", $.else_if_clause)),
        optional(field("else_clause", $.else_clause)),
        field("end", ciPhrase("end if")),
      ),

    else_if_clause: ($) =>
      seq(
        keywordToken("else"),
        keywordToken("if"),
        field("condition", $.argument_list),
        /\n/,
        field("body", $.block_body),
      ),

    else_clause: ($) =>
      seq(
        keywordToken("else"),
        /\n/,
        field("body", $.block_body),
      ),

    while_block: ($) =>
      seq(
        keywordToken("while"),
        optional(field("condition", $.argument_list)),
        /\n/,
        field("body", $.block_body),
        field("end", ciPhrase("end while")),
      ),

    repeat_block: ($) =>
      seq(
        choice(keywordToken("repeat"), keywordToken("rept")),
        optional(field("arguments", $.argument_list)),
        /\n/,
        field("body", $.block_body),
        field("end", ciPhrase("end repeat")),
      ),

    iterate_block: ($) =>
      seq(
        keywordToken("iterate"),
        optional(field("arguments", $.argument_list)),
        /\n/,
        field("body", $.block_body),
        field("end", ciPhrase("end iterate")),
      ),

    irp_block: ($) =>
      seq(
        choice(keywordToken("irp"), keywordToken("irpv")),
        optional(field("arguments", $.argument_list)),
        /\n/,
        field("body", $.block_body),
        field("end", choice(ciPhrase("end irp"), ciPhrase("end irpv"))),
      ),

    namespace_block: ($) =>
      seq(
        keywordToken("namespace"),
        optional(field("arguments", $.argument_list)),
        /\n/,
        field("body", $.block_body),
        field("end", ciPhrase("end namespace")),
      ),

    virtual_block: ($) =>
      seq(
        keywordToken("virtual"),
        optional(field("arguments", $.argument_list)),
        /\n/,
        field("body", $.block_body),
        field("end", ciPhrase("end virtual")),
      ),

    postpone_block: ($) =>
      seq(
        keywordToken("postpone"),
        optional(field("arguments", $.argument_list)),
        /\n/,
        field("body", $.block_body),
        field("end", ciPhrase("end postpone")),
      ),

    match_block: ($) =>
      seq(
        choice(keywordToken("match"), keywordToken("rawmatch"), keywordToken("rmatch")),
        optional(field("pattern", $.match_pattern)),
        /\n/,
        field("body", $.block_body),
        repeat(field("else_match_clauses", $.else_match_clause)),
        optional(field("else_clause", $.else_clause)),
        field("end", ciPhrase("end match")),
      ),

    else_match_clause: ($) =>
      seq(
        keywordToken("else"),
        keywordToken("match"),
        field("pattern", $.match_pattern),
        /\n/,
        field("body", $.block_body),
      ),
  },
});
