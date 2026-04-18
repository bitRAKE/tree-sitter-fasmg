//! Rust binding for the generated `tree-sitter-fasmg` parser.
//!
//! Loads the C parser at link time and exposes it as a
//! [`tree_sitter_language::LanguageFn`], plus the bundled query strings so
//! consumers don't need filesystem access to drive highlighting, locals, or
//! folds.

use tree_sitter_language::LanguageFn;

unsafe extern "C" {
    fn tree_sitter_fasmg() -> *const ();
}

/// The tree-sitter [`LanguageFn`][LanguageFn] for this grammar.
pub const LANGUAGE: LanguageFn = unsafe { LanguageFn::from_raw(tree_sitter_fasmg) };

/// The content of the generated `node-types.json`.
pub const NODE_TYPES: &str = include_str!("../../src/node-types.json");

/// The syntax highlighting query for this grammar.
pub const HIGHLIGHT_QUERY: &str = include_str!("../../queries/highlights.scm");

/// The locals query for this grammar.
pub const LOCALS_QUERY: &str = include_str!("../../queries/locals.scm");

/// The folds query for this grammar.
pub const FOLDS_QUERY: &str = include_str!("../../queries/folds.scm");

#[cfg(test)]
mod tests {
    #[test]
    fn can_load_the_generated_language() {
        let mut parser = tree_sitter::Parser::new();
        parser
            .set_language(&super::LANGUAGE.into())
            .expect("Error loading fasmg parser");
    }
}
