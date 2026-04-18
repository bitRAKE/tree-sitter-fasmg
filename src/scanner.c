#include "tree_sitter/parser.h"

#include <stdbool.h>
#include <stddef.h>

enum TokenType {
    MATCH_PATTERN_TEXT,
    FREE_END_CLAUSE,
};

static inline int32_t ascii_lower(int32_t c) {
    return (c >= 'A' && c <= 'Z') ? c + 32 : c;
}

// Is this character part of a fasmg name? Mirrors `$.identifier` in
// grammar.js (every char except whitespace/EOL and the syntactical set).
static inline bool is_name_char(int32_t c) {
    if (c <= ' ') return false;
    switch (c) {
        case '+': case '-': case '/': case '*': case '=':
        case '<': case '>': case '(': case ')': case '[':
        case ']': case '{': case '}': case ':': case '!':
        case ',': case '|': case '&': case '~': case '`':
        case ';': case '\\': case '#':
            return false;
        default:
            return true;
    }
}

void *tree_sitter_fasmg_external_scanner_create(void) { return NULL; }
void tree_sitter_fasmg_external_scanner_destroy(void *payload) { (void)payload; }
unsigned tree_sitter_fasmg_external_scanner_serialize(void *payload, char *buf) {
    (void)payload; (void)buf; return 0;
}
void tree_sitter_fasmg_external_scanner_deserialize(void *payload, const char *buf, unsigned length) {
    (void)payload; (void)buf; (void)length;
}

// Peek through a fasmg `match` pattern on the current line and decide whether
// it contains characters the structured argument path cannot handle. If so,
// consume the rest of the line as a single `match_pattern_text` token.
//
// The structured path (choice($.argument_list, ...)) handles the common case
// — `match =FileName, file`, `match name, input`, etc. — and we want it to
// win. But fasmg actually tokenizes `match` patterns loosely: they can
// include stray `]` (amx.inc `match dtail]=, stail, src`) or a `;` under a
// `retaincomments` regime. Those forms blow up structured parsing, so we
// fall back to text here.
//
// Strategy: pre-scan the rest of the line tracking paren/bracket/brace
// depth. If we see a closing delimiter at depth 0, or a `;`, the pattern
// is "loose" — emit text. Otherwise return false and let the structured
// choice take over.
static bool scan_match_pattern_text(TSLexer *lexer) {
    // Skip leading horizontal whitespace. Whitespace doesn't start a token;
    // a pattern must have real content.
    while (lexer->lookahead == ' ' || lexer->lookahead == '\t') {
        lexer->advance(lexer, false);
    }

    if (lexer->lookahead == '\n' || lexer->lookahead == '\r' || lexer->eof(lexer)) {
        return false;
    }

    // If the first real character can't start an argument, the structured
    // path is a dead-end and we must emit text. `match , args` (empty
    // leading arg) is the dominant form — fasmg accepts it because its
    // tokenizer is non-positional, but our `argument_list` rule requires
    // at least one real argument before the first comma.
    bool starts_loose =
        lexer->lookahead == ',' ||
        lexer->lookahead == ')' ||
        lexer->lookahead == ']' ||
        lexer->lookahead == '}' ||
        lexer->lookahead == ';';

    // First pass: peek-scan the line to decide whether structured parsing
    // can handle it. We can't actually lookahead-without-advance, so we
    // advance but call mark_end only after we've decided the pattern is
    // loose (so the token boundary lands in the right place).
    int paren = 0, bracket = 0, brace = 0;
    bool is_loose = starts_loose;
    int last_nonspace_was_backslash = 0;

    while (true) {
        int32_t c = lexer->lookahead;
        if (c == 0 || c == '\n') {
            break;
        }
        if (c == '\r') {
            lexer->advance(lexer, false);
            continue;
        }
        // Handle `\<newline>` line continuation: skip past it and keep
        // going on the next line.
        if (c == '\\') {
            lexer->advance(lexer, false);
            // Eat `[ \t]*\r?\n` if present.
            while (lexer->lookahead == ' ' || lexer->lookahead == '\t') {
                lexer->advance(lexer, false);
            }
            if (lexer->lookahead == '\r') {
                lexer->advance(lexer, false);
            }
            if (lexer->lookahead == '\n') {
                lexer->advance(lexer, false);
                continue;
            }
            last_nonspace_was_backslash = 1;
            continue;
        }
        last_nonspace_was_backslash = 0;

        if (c == '(') paren++;
        else if (c == '[') bracket++;
        else if (c == '{') brace++;
        else if (c == ')') {
            if (paren == 0) { is_loose = true; break; }
            paren--;
        }
        else if (c == ']') {
            if (bracket == 0) { is_loose = true; break; }
            bracket--;
        }
        else if (c == '}') {
            if (brace == 0) { is_loose = true; break; }
            brace--;
        }
        else if (c == ';') {
            // A `;` starts a comment normally, but under `retaincomments`
            // it's a pattern token. Either way, structured argument parsing
            // can't accept it — let text win and move on.
            is_loose = true;
            break;
        }
        // String literals: swallow them whole so quoted delimiters don't
        // confuse the depth counter.
        else if (c == '"' || c == '\'') {
            int32_t quote = c;
            lexer->advance(lexer, false);
            while (lexer->lookahead != 0 && lexer->lookahead != '\n' && lexer->lookahead != '\r') {
                if (lexer->lookahead == quote) {
                    lexer->advance(lexer, false);
                    if (lexer->lookahead == quote) {
                        // Escaped quote (`''` or `""`) — consume and continue.
                        lexer->advance(lexer, false);
                        continue;
                    }
                    break;
                }
                lexer->advance(lexer, false);
            }
            continue;
        }

        lexer->advance(lexer, false);
    }

    (void)last_nonspace_was_backslash;

    // An unclosed opener at end-of-line also makes the pattern loose —
    // fasmg's tokenizer happily reads `match (x, buffer` as a pattern
    // beginning with a literal `(`, but our structured argument_list
    // rule can't close the paren. Fall back to text.
    if (paren > 0 || bracket > 0 || brace > 0) {
        is_loose = true;
    }

    if (!is_loose) {
        // Structured parsing can handle this — don't emit the text token.
        return false;
    }

    // We've committed to text-fallback. Finish consuming the rest of the
    // line, tracking the last non-whitespace position so the token excludes
    // trailing spaces.
    while (true) {
        int32_t c = lexer->lookahead;
        if (c == 0 || c == '\n') break;
        if (c == '\\') {
            lexer->advance(lexer, false);
            while (lexer->lookahead == ' ' || lexer->lookahead == '\t') {
                lexer->advance(lexer, false);
            }
            if (lexer->lookahead == '\r') lexer->advance(lexer, false);
            if (lexer->lookahead == '\n') {
                lexer->advance(lexer, false);
                continue;
            }
            lexer->mark_end(lexer);
            continue;
        }
        if (c == ' ' || c == '\t' || c == '\r') {
            lexer->advance(lexer, false);
            continue;
        }
        lexer->advance(lexer, false);
        lexer->mark_end(lexer);
    }

    lexer->result_symbol = MATCH_PATTERN_TEXT;
    return true;
}

// Scan a "free" `end X` clause inside a macro/struc body. Fasmg `!` macros
// can emit `end namespace`, `end frame`, etc. that close a block in the
// caller's scope; our body parser treats them as opaque lines.
//
// We must NOT claim the closer `end macro` / `end struc` / `end
// calminstruction` — those terminate the enclosing definition and the
// structured grammar needs to see them as keywords. We also skip anything
// that isn't `end` followed by a name character.
//
// On success, we consume the entire rest of the line as a single
// `free_end_clause` token (similar to match_pattern_text).
static bool scan_free_end_clause(TSLexer *lexer) {
    // Skip horizontal whitespace at start of line (body statements are
    // indented). We don't cross newlines — a blank line is handled by the
    // structured grammar.
    while (lexer->lookahead == ' ' || lexer->lookahead == '\t') {
        lexer->advance(lexer, false);
    }

    // Require `end` case-insensitive, followed by a word boundary. If the
    // line doesn't start with `end<space>`, let the structured grammar
    // handle it.
    const char end_word[] = "end";
    for (int i = 0; i < 3; ++i) {
        if (ascii_lower(lexer->lookahead) != end_word[i]) return false;
        lexer->advance(lexer, false);
    }
    // `end` must be terminated by whitespace, not glued to more name chars.
    if (is_name_char(lexer->lookahead)) return false;

    // Consume the whitespace between `end` and the next word.
    while (lexer->lookahead == ' ' || lexer->lookahead == '\t') {
        lexer->advance(lexer, false);
    }

    // Read the next identifier into a small buffer (lowercased) so we can
    // compare against the closer list. We only decline for the three
    // *definition* closers — those terminate macro/struc/calminstruction
    // and MUST reach the structured grammar. Control-flow closers
    // (`end if`, `end namespace`, `end match`, …) are ambiguous: they may
    // close a block opened in the body, OR be emitted as a free clause
    // for the caller's scope. We take the permissive path — emit
    // free_end_clause — and let the parser use GLR conflicts to choose.
    static const char *closers[] = {
        "macro", "struc", "calminstruction",
        NULL
    };
    char word_buf[32];
    int word_len = 0;
    while (word_len < (int)sizeof(word_buf) - 1 && is_name_char(lexer->lookahead)) {
        word_buf[word_len++] = (char)ascii_lower(lexer->lookahead);
        lexer->advance(lexer, false);
    }
    word_buf[word_len] = '\0';

    if (word_len > 0 && !is_name_char(lexer->lookahead)) {
        for (int k = 0; closers[k] != NULL; ++k) {
            const char *w = closers[k];
            int i = 0;
            while (w[i] && i < word_len && w[i] == word_buf[i]) i++;
            if (!w[i] && i == word_len) {
                // Exact closer match — don't emit free_end_clause.
                return false;
            }
        }
    }

    // Commit: consume the rest of the line as text. Track last
    // non-whitespace position for the token end.
    lexer->mark_end(lexer);
    while (true) {
        int32_t c = lexer->lookahead;
        if (c == 0 || c == '\n') break;
        if (c == '\\') {
            lexer->advance(lexer, false);
            while (lexer->lookahead == ' ' || lexer->lookahead == '\t') {
                lexer->advance(lexer, false);
            }
            if (lexer->lookahead == '\r') lexer->advance(lexer, false);
            if (lexer->lookahead == '\n') {
                lexer->advance(lexer, false);
                continue;
            }
            lexer->mark_end(lexer);
            continue;
        }
        if (c == ' ' || c == '\t' || c == '\r') {
            lexer->advance(lexer, false);
            continue;
        }
        lexer->advance(lexer, false);
        lexer->mark_end(lexer);
    }

    lexer->result_symbol = FREE_END_CLAUSE;
    return true;
}

bool tree_sitter_fasmg_external_scanner_scan(void *payload, TSLexer *lexer,
                                             const bool *valid_symbols) {
    (void)payload;
    if (valid_symbols[FREE_END_CLAUSE]) {
        if (scan_free_end_clause(lexer)) return true;
    }
    if (valid_symbols[MATCH_PATTERN_TEXT]) {
        return scan_match_pattern_text(lexer);
    }
    return false;
}
