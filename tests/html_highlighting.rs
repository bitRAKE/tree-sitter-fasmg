use std::fs;
use std::path::Path;

use tree_sitter_fasmg::{
    highlight_html, highlight_html_document, syntax_diagnostics, SyntaxDiagnosticKind,
};

fn read_fixture(path: &str) -> String {
    fs::read_to_string(Path::new(path)).expect("fixture should be readable")
}

#[test]
fn highlight_html_covers_representative_constructs() {
    let source = read_fixture("test/fixtures/pass/real_script_forms.l4gs.g");
    let highlighted = highlight_html(&source).expect("fixture should highlight");

    assert!(highlighted.diagnostics.is_empty());
    assert!(highlighted.html.contains("class=\"function builtin\">MyInst</span>"));
    assert!(highlighted.html.contains("class=\"variable parameter\">arg</span>"));
    assert!(highlighted.html.contains("class=\"keyword\">dd</span>"));
    assert!(highlighted.classes_used.iter().any(|name| name == "function.builtin"));
    assert!(highlighted.classes_used.iter().any(|name| name == "variable.parameter"));
}

#[test]
fn highlight_html_document_wraps_fragment_with_styles() {
    let document = highlight_html_document("{use32} db 1\n", "fasmg sample")
        .expect("sample should render as HTML");

    assert!(document.contains("<pre class=\"ts-highlight\">"));
    assert!(document.contains(".ts-highlight"));
    assert!(document.contains("class=\"attribute\">{use32}</span>"));
}

#[test]
fn syntax_diagnostics_surface_parse_recovery_nodes() {
    let source = read_fixture("test/fixtures/fail/unterminated_macro.l4gs.g");
    let diagnostics = syntax_diagnostics(&source);

    assert!(!diagnostics.is_empty());
    assert!(diagnostics.iter().any(|diagnostic| {
        matches!(
            diagnostic.kind,
            SyntaxDiagnosticKind::Error | SyntaxDiagnosticKind::Missing
        )
    }));
}
