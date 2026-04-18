use std::cell::RefCell;
use std::collections::BTreeSet;
use std::fmt::{self, Display, Formatter};
use std::string::FromUtf8Error;

use tree_sitter::{Parser, Point, QueryError, Tree, TreeCursor};
use tree_sitter_highlight::{Highlight, HighlightConfiguration, Highlighter, HtmlRenderer};

pub const STANDARD_HIGHLIGHT_NAMES: &[&str] = &[
    "attribute",
    "boolean",
    "carriage-return",
    "comment",
    "comment.documentation",
    "constant",
    "constant.builtin",
    "constructor",
    "constructor.builtin",
    "embedded",
    "error",
    "escape",
    "function",
    "function.builtin",
    "keyword",
    "markup",
    "markup.bold",
    "markup.heading",
    "markup.italic",
    "markup.link",
    "markup.link.url",
    "markup.list",
    "markup.list.checked",
    "markup.list.numbered",
    "markup.list.unchecked",
    "markup.list.unnumbered",
    "markup.quote",
    "markup.raw",
    "markup.raw.block",
    "markup.raw.inline",
    "markup.strikethrough",
    "module",
    "number",
    "operator",
    "property",
    "property.builtin",
    "punctuation",
    "punctuation.bracket",
    "punctuation.delimiter",
    "punctuation.special",
    "string",
    "string.escape",
    "string.regexp",
    "string.special",
    "string.special.symbol",
    "tag",
    "type",
    "type.builtin",
    "variable",
    "variable.builtin",
    "variable.member",
    "variable.parameter",
];

pub const DEFAULT_HTML_CSS: &str = r#"
:root {
  color-scheme: light dark;
}

body {
  margin: 0;
  padding: 1.5rem;
  background:
    radial-gradient(circle at top left, rgba(185, 112, 53, 0.12), transparent 40%),
    linear-gradient(180deg, #faf6ef 0%, #f2ecdf 100%);
  color: #201812;
  font-family: "IBM Plex Sans", "Segoe UI", sans-serif;
}

.ts-highlight {
  margin: 0;
  padding: 1.25rem 1.5rem;
  border: 1px solid rgba(68, 51, 39, 0.18);
  border-radius: 18px;
  background: rgba(255, 252, 246, 0.96);
  box-shadow: 0 20px 45px rgba(40, 28, 20, 0.08);
  overflow-x: auto;
  font: 15px/1.6 "IBM Plex Mono", Consolas, monospace;
}

.attribute { color: #8b3d2e; font-style: italic; }
.comment, .comment.documentation { color: #6c6a67; font-style: italic; }
.constant, .number, .boolean { color: #7a4f00; font-weight: 600; }
.constant.builtin, .property.builtin, .type.builtin, .variable.builtin, .constructor.builtin { color: #8e3d13; font-weight: 700; }
.constructor, .module, .type, .tag { color: #215a57; }
.embedded { background: rgba(28, 87, 132, 0.08); }
.error { color: #b42318; text-decoration: underline wavy currentColor; }
.escape, .string.escape, .string.regexp, .string.special, .string.special.symbol { color: #0c6f6b; }
.function, .function.builtin { color: #1d4f91; }
.keyword, .operator { color: #6f2dbd; font-weight: 600; }
.markup, .markup.raw, .markup.raw.block, .markup.raw.inline { color: #7d4e00; }
.markup.bold { font-weight: 700; }
.markup.heading { color: #7a3419; font-weight: 700; }
.markup.italic, .markup.quote { font-style: italic; }
.markup.link, .markup.link.url { color: #0d5c63; text-decoration: underline; }
.markup.list, .markup.list.checked, .markup.list.numbered, .markup.list.unchecked, .markup.list.unnumbered, .markup.strikethrough { color: #6c6a67; }
.property, .variable, .variable.member { color: #8b3d2e; }
.punctuation, .punctuation.bracket, .punctuation.delimiter, .punctuation.special { color: #6d4c41; }
.string { color: #0c6f6b; }
.variable.parameter { color: #3a5a40; text-decoration: underline; }

@media (prefers-color-scheme: dark) {
  body {
    background:
      radial-gradient(circle at top left, rgba(229, 140, 76, 0.16), transparent 36%),
      linear-gradient(180deg, #17120f 0%, #211915 100%);
    color: #f1e9dc;
  }

  .ts-highlight {
    background: rgba(30, 24, 20, 0.94);
    border-color: rgba(245, 222, 179, 0.12);
    box-shadow: 0 20px 48px rgba(0, 0, 0, 0.35);
  }

  .attribute { color: #f7b267; }
  .comment, .comment.documentation { color: #b3a79a; }
  .constant, .number, .boolean { color: #ffd166; }
  .constant.builtin, .property.builtin, .type.builtin, .variable.builtin, .constructor.builtin { color: #ffb77d; }
  .constructor, .module, .type, .tag { color: #7bdff2; }
  .embedded { background: rgba(93, 173, 226, 0.12); }
  .error { color: #ff8a80; }
  .escape, .string.escape, .string.regexp, .string.special, .string.special.symbol { color: #72efdd; }
  .function, .function.builtin { color: #9cc2ff; }
  .keyword, .operator { color: #d4a5ff; }
  .markup, .markup.raw, .markup.raw.block, .markup.raw.inline { color: #ffd6a5; }
  .markup.heading { color: #ffb4a2; }
  .markup.link, .markup.link.url { color: #80ffdb; }
  .property, .variable, .variable.member { color: #ffb4a2; }
  .punctuation, .punctuation.bracket, .punctuation.delimiter, .punctuation.special { color: #d7ccc8; }
  .string { color: #72efdd; }
  .variable.parameter { color: #b7efc5; }
}
"#;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SourcePosition {
    pub row: usize,
    pub column: usize,
}

impl From<Point> for SourcePosition {
    fn from(point: Point) -> Self {
        Self {
            row: point.row,
            column: point.column,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum SyntaxDiagnosticKind {
    Error,
    Missing,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SyntaxDiagnostic {
    pub kind: SyntaxDiagnosticKind,
    pub node_kind: String,
    pub start_byte: usize,
    pub end_byte: usize,
    pub start_position: SourcePosition,
    pub end_position: SourcePosition,
    pub message: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct HtmlHighlightOutput {
    pub html: String,
    pub classes_used: Vec<String>,
    pub diagnostics: Vec<SyntaxDiagnostic>,
}

#[derive(Debug)]
pub enum HighlightHtmlError {
    InvalidQuery(QueryError),
    InvalidLanguage(tree_sitter::LanguageError),
    Highlight(tree_sitter_highlight::Error),
    InvalidUtf8(FromUtf8Error),
}

impl Display for HighlightHtmlError {
    fn fmt(&self, f: &mut Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidQuery(error) => write!(f, "invalid highlight query: {error}"),
            Self::InvalidLanguage(error) => write!(f, "failed to load fasmg language: {error}"),
            Self::Highlight(error) => write!(f, "failed to render highlighted HTML: {error}"),
            Self::InvalidUtf8(error) => write!(f, "highlight output was not valid UTF-8: {error}"),
        }
    }
}

impl std::error::Error for HighlightHtmlError {}

pub fn syntax_diagnostics(source: &str) -> Vec<SyntaxDiagnostic> {
    let mut parser = Parser::new();
    parser
        .set_language(&crate::LANGUAGE.into())
        .expect("fasmg language should always load");

    let tree = parser
        .parse(source, None)
        .expect("tree-sitter should always produce a tree");

    collect_syntax_diagnostics(&tree)
}

pub fn highlight_html(source: &str) -> Result<HtmlHighlightOutput, HighlightHtmlError> {
    highlight_html_with_query(source, crate::HIGHLIGHT_QUERY)
}

pub fn highlight_html_with_query(
    source: &str,
    highlight_query: &str,
) -> Result<HtmlHighlightOutput, HighlightHtmlError> {
    let diagnostics = syntax_diagnostics(source);
    let config = highlight_configuration(highlight_query)?;
    let mut highlighter = Highlighter::new();
    let mut renderer = HtmlRenderer::new();
    let class_names = RefCell::new(BTreeSet::new());

    let events = highlighter
        .highlight(&config, source.as_bytes(), None, |_| None)
        .map_err(HighlightHtmlError::Highlight)?;

    renderer
        .render(events, source.as_bytes(), &|highlight: Highlight, html| {
            let name = STANDARD_HIGHLIGHT_NAMES[highlight.0];
            class_names.borrow_mut().insert(name.to_owned());
            html.extend_from_slice(b"class=\"");
            let mut first = true;
            for segment in name.split('.') {
                if !first {
                    html.push(b' ');
                }
                first = false;
                html.extend_from_slice(segment.as_bytes());
            }
            html.push(b'"');
        })
        .map_err(HighlightHtmlError::Highlight)?;

    Ok(HtmlHighlightOutput {
        html: String::from_utf8(renderer.html).map_err(HighlightHtmlError::InvalidUtf8)?,
        classes_used: class_names.into_inner().into_iter().collect(),
        diagnostics,
    })
}

pub fn highlight_html_document(source: &str, title: &str) -> Result<String, HighlightHtmlError> {
    let highlighted = highlight_html(source)?;
    let escaped_title = escape_html(title);

    Ok(format!(
        "<!doctype html>\n\
         <html lang=\"en\">\n\
         <head>\n\
         <meta charset=\"utf-8\">\n\
         <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n\
         <title>{escaped_title}</title>\n\
         <style>{DEFAULT_HTML_CSS}</style>\n\
         </head>\n\
         <body>\n\
         <pre class=\"ts-highlight\">{}</pre>\n\
         </body>\n\
         </html>\n",
        highlighted.html
    ))
}

fn highlight_configuration(
    highlight_query: &str,
) -> Result<HighlightConfiguration, HighlightHtmlError> {
    let mut config = HighlightConfiguration::new(
        crate::LANGUAGE.into(),
        "fasmg",
        highlight_query,
        "",
        crate::LOCALS_QUERY,
    )
    .map_err(HighlightHtmlError::InvalidQuery)?;

    config.configure(STANDARD_HIGHLIGHT_NAMES);
    Ok(config)
}

fn collect_syntax_diagnostics(tree: &Tree) -> Vec<SyntaxDiagnostic> {
    let mut diagnostics = Vec::new();
    let mut cursor = tree.walk();
    collect_diagnostics_from_cursor(&mut cursor, &mut diagnostics);
    diagnostics
}

fn collect_diagnostics_from_cursor(
    cursor: &mut TreeCursor<'_>,
    diagnostics: &mut Vec<SyntaxDiagnostic>,
) {
    loop {
        let node = cursor.node();
        if node.is_error() || node.is_missing() {
            let kind = if node.is_missing() {
                SyntaxDiagnosticKind::Missing
            } else {
                SyntaxDiagnosticKind::Error
            };

            let message = match kind {
                SyntaxDiagnosticKind::Error => "Tree-sitter emitted an ERROR node".to_owned(),
                SyntaxDiagnosticKind::Missing => {
                    format!("Tree-sitter inserted missing syntax for `{}`", node.kind())
                }
            };

            diagnostics.push(SyntaxDiagnostic {
                kind,
                node_kind: node.kind().to_owned(),
                start_byte: node.start_byte(),
                end_byte: node.end_byte(),
                start_position: node.start_position().into(),
                end_position: node.end_position().into(),
                message,
            });
        }

        if cursor.goto_first_child() {
            collect_diagnostics_from_cursor(cursor, diagnostics);
            cursor.goto_parent();
        }

        if !cursor.goto_next_sibling() {
            break;
        }
    }
}

fn escape_html(text: &str) -> String {
    let mut escaped = String::with_capacity(text.len());
    for ch in text.chars() {
        match ch {
            '&' => escaped.push_str("&amp;"),
            '<' => escaped.push_str("&lt;"),
            '>' => escaped.push_str("&gt;"),
            '"' => escaped.push_str("&quot;"),
            '\'' => escaped.push_str("&#39;"),
            _ => escaped.push(ch),
        }
    }
    escaped
}
