use std::fs;
use std::io::{self, Read};
use std::path::Path;
use std::process::ExitCode;

fn main() -> ExitCode {
    match run() {
        Ok(()) => ExitCode::SUCCESS,
        Err(message) => {
            eprintln!("{message}");
            ExitCode::FAILURE
        }
    }
}

fn run() -> Result<(), String> {
    let mut args = std::env::args().skip(1);
    let mut fragment_only = false;
    let mut path = None;

    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--fragment" => fragment_only = true,
            "-h" | "--help" => {
                print_help();
                return Ok(());
            }
            "--" => {
                path = args.next();
                break;
            }
            _ if arg.starts_with('-') => {
                return Err(format!("unrecognized option: {arg}\n\n{}", usage()));
            }
            _ => {
                path = Some(arg);
                break;
            }
        }
    }

    let (source, title) = match path.as_deref() {
        Some("-") | None => (read_stdin().map_err(|e| format!("failed to read stdin: {e}"))?, "fasmg source".to_owned()),
        Some(path) => (
            fs::read_to_string(path).map_err(|e| format!("failed to read {path}: {e}"))?,
            Path::new(path)
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or("fasmg source")
                .to_owned(),
        ),
    };

    if fragment_only {
        let highlighted = tree_sitter_fasmg::highlight_html(&source)
            .map_err(|e| format!("failed to highlight source: {e}"))?;
        print!("{}", highlighted.html);
        report_diagnostics(&highlighted.diagnostics);
    } else {
        let document = tree_sitter_fasmg::highlight_html_document(&source, &title)
            .map_err(|e| format!("failed to highlight source: {e}"))?;
        print!("{document}");
        report_diagnostics(&tree_sitter_fasmg::syntax_diagnostics(&source));
    }

    Ok(())
}

fn read_stdin() -> io::Result<String> {
    let mut source = String::new();
    io::stdin().read_to_string(&mut source)?;
    Ok(source)
}

fn report_diagnostics(diagnostics: &[tree_sitter_fasmg::SyntaxDiagnostic]) {
    if diagnostics.is_empty() {
        return;
    }

    eprintln!("syntax diagnostics:");
    for diagnostic in diagnostics {
        eprintln!(
            "  {:?} {}:{}-{}:{} {}",
            diagnostic.kind,
            diagnostic.start_position.row + 1,
            diagnostic.start_position.column + 1,
            diagnostic.end_position.row + 1,
            diagnostic.end_position.column + 1,
            diagnostic.message
        );
    }
}

fn print_help() {
    print!("{}", usage());
}

fn usage() -> &'static str {
    "Usage: fasmg-html-highlight [--fragment] [PATH|-]\n\
     \n\
     Outputs Tree-sitter-based HTML highlighting for fasmg source.\n\
     Reads stdin when PATH is omitted or '-'. Syntax diagnostics are written\n\
     to stderr when parse errors or missing nodes are present.\n"
}
