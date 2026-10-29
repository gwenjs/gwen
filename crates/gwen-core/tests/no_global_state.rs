//! `crates/gwen-core/src` keeps no instance-global state outside `cfg(test)`.
//! Fixtures run first, in this test, so a scanner that ignores its input cannot pass.

use std::fs;
use std::path::Path;

const NEEDLES: [&str; 6] = [
    "static mut ",
    "thread_local!",
    "lazy_static",
    "OnceLock",
    "LazyLock",
    "OnceCell",
];

#[test]
fn src_holds_no_static_mut_thread_local_or_lazy_static_outside_cfg_test() -> Result<(), String> {
    let bare = scan("fixture.rs", "static mut X: u8 = 0;\n");
    assert_eq!(bare, vec!["fixture.rs:1: static mut ".to_string()]);

    let hidden = "#[cfg(test)]\nmod t {\n    static mut X: u8 = 0;\n}\n";
    assert_eq!(scan("hidden.rs", hidden), Vec::<String>::new());

    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
    let mut hits = Vec::new();
    walk(&root, &root, &mut hits)?;
    hits.sort();
    assert_eq!(
        hits,
        Vec::<String>::new(),
        "src holds global state outside cfg(test): {hits:?}"
    );
    Ok(())
}

fn walk(root: &Path, dir: &Path, hits: &mut Vec<String>) -> Result<(), String> {
    for entry in fs::read_dir(dir).map_err(|err| format!("{}: {err}", dir.display()))? {
        let path = entry.map_err(|err| err.to_string())?.path();
        if path.is_dir() {
            walk(root, &path, hits)?;
            continue;
        }
        if path.extension().and_then(|ext| ext.to_str()) != Some("rs") {
            continue;
        }
        let text = fs::read_to_string(&path).map_err(|err| format!("{}: {err}", path.display()))?;
        let rel = path.strip_prefix(root).unwrap_or(path.as_path());
        let label = rel.display().to_string();
        hits.extend(scan(&label, &text));
    }
    Ok(())
}

fn scan(label: &str, source: &str) -> Vec<String> {
    let lines: Vec<&str> = source.lines().collect();
    let mut hits = Vec::new();
    let mut index = 0;
    while index < lines.len() {
        let trimmed = lines[index].trim();
        if trimmed.starts_with("#[cfg(test)]") || trimmed.starts_with("#[cfg(all(test") {
            index = skip_item(&lines, index + 1);
            continue;
        }
        if !trimmed.starts_with("//") {
            if let Some(needle) = NEEDLES.into_iter().find(|needle| trimmed.contains(needle)) {
                hits.push(format!("{label}:{}: {needle}", index + 1));
            }
        }
        index += 1;
    }
    hits
}

fn skip_item(lines: &[&str], start: usize) -> usize {
    let mut depth = 0_i32;
    let mut opened = false;
    for (index, line) in lines.iter().enumerate().skip(start) {
        for byte in line.bytes() {
            opened |= byte == b'{';
            depth += i32::from(byte == b'{') - i32::from(byte == b'}');
            if (opened && depth == 0) || (byte == b';' && !opened) {
                return index + 1;
            }
        }
    }
    lines.len()
}
