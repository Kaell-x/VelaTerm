//! Read-only access to Kimi Code's native session recordings.
//!
//! Current Kimi Code stores each root-agent run as `agents/main/wire.jsonl` beneath
//! `~/.kimi-code/sessions/<workspace>/<session-id>/`. Older kimi-cli releases keep
//! `context.jsonl` under `~/.kimi/sessions/<workspace>/<session-id>/`. Both formats are
//! converted to the shared transcript shape; internal injections, thinking and tool rows
//! stay out of the prose used for titles, exports and reference summaries.

use std::collections::HashSet;
use std::path::{Path, PathBuf};

use serde_json::Value;

use super::transcript::Piece;

fn roots() -> Vec<PathBuf> {
    let mut roots = Vec::new();
    for key in ["KIMI_CODE_HOME", "KIMI_SHARE_DIR"] {
        if let Some(path) = std::env::var_os(key).filter(|value| !value.is_empty()) {
            roots.push(PathBuf::from(path));
        }
    }
    if let Some(home) = crate::host::home_dir() {
        roots.push(home.join(".kimi-code"));
        roots.push(home.join(".kimi"));
    }
    let mut seen = HashSet::new();
    roots.retain(|root| seen.insert(root.clone()));
    roots
}

fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 200
        && id.bytes().all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
}

fn candidates(root: &Path, id: &str) -> Vec<PathBuf> {
    let mut out = Vec::new();
    let sessions = root.join("sessions");
    let mut push_session_files = |session: PathBuf| {
        out.push(session.join("agents/main/wire.jsonl"));
        out.push(session.join("context.jsonl"));
        out.push(session.join("wire.jsonl"));
    };
    push_session_files(sessions.join(id));
    if let Ok(entries) = std::fs::read_dir(&sessions) {
        for entry in entries.flatten() {
            push_session_files(entry.path().join(id));
        }
    }
    out.push(root.join("imported_sessions").join(id).join("context.jsonl"));
    out
}

fn source_path_from(roots: &[PathBuf], id: &str) -> Option<PathBuf> {
    if !valid_id(id) { return None; }
    roots.iter()
        .flat_map(|root| candidates(root, id))
        .find(|path| path.is_file())
}

pub(crate) fn source_path(id: &str) -> Option<PathBuf> {
    source_path_from(&roots(), id)
}

fn text_content(content: &Value) -> String {
    match content {
        Value::String(text) => text.clone(),
        Value::Array(parts) => parts.iter()
            .filter_map(|part| match part {
                Value::Object(_) if part.get("type").and_then(Value::as_str) == Some("text") => {
                    part.get("text").and_then(Value::as_str)
                }
                _ => None,
            })
            .collect::<Vec<_>>()
            .join("\n"),
        _ => String::new(),
    }
}

fn push_text(pieces: &mut Vec<Piece>, role: &'static str, content: &Value) {
    let text = text_content(content);
    if !text.trim().is_empty() {
        pieces.push(Piece { role, text, timestamp: None, tools: Vec::new() });
    }
}

fn parse_wire_line(line: &str, pieces: &mut Vec<Piece>) {
    let Ok(value) = serde_json::from_str::<Value>(line) else { return };
    match value.get("type").and_then(Value::as_str) {
        Some("context.append_message") => {
            let message = &value["message"];
            let role = message.get("role").and_then(Value::as_str);
            let origin = message.pointer("/origin/kind").and_then(Value::as_str);
            if role == Some("user") && origin == Some("user") {
                push_text(pieces, "user", &message["content"]);
            } else if role == Some("assistant") {
                push_text(pieces, "assistant", &message["content"]);
            }
        }
        Some("agent.message.appended") => {
            let wrapper = &value["message"];
            let message = &wrapper["message"];
            let source = wrapper.pointer("/meta/source").and_then(Value::as_str);
            if message.get("role").and_then(Value::as_str) == Some("assistant") && source == Some("llm") {
                push_text(pieces, "assistant", &message["content"]);
            }
        }
        _ => {
            // The legacy context file is also valid JSONL with role-bearing rows.
            if value.get("role").is_some() && value.get("type").is_none() {
                parse_context_value(&value, pieces);
            }
        }
    }
}

fn parse_context_value(value: &Value, pieces: &mut Vec<Piece>) {
    if value.get("type").and_then(Value::as_str).is_some_and(|kind| kind.starts_with('_')) { return; }
    match value.get("role").and_then(Value::as_str) {
        Some("user") => push_text(pieces, "user", &value["content"]),
        Some("assistant") => push_text(pieces, "assistant", &value["content"]),
        _ => {}
    }
}

pub(crate) fn pieces_at(path: &Path) -> Result<Vec<Piece>, String> {
    let content = super::history_store::compat::read_path(path)?;
    let mut pieces = Vec::new();
    if path.file_name().and_then(|name| name.to_str()) == Some("context.jsonl") {
        for line in content.lines() {
            let Ok(value) = serde_json::from_str::<Value>(line) else { continue };
            parse_context_value(&value, &mut pieces);
        }
    } else {
        for line in content.lines() { parse_wire_line(line, &mut pieces); }
    }
    if pieces.is_empty() {
        return Err("Kimi session has no readable conversation text".into());
    }
    Ok(pieces)
}

pub(crate) fn pieces(id: &str) -> Result<Vec<Piece>, String> {
    let path = source_path(id).ok_or("Kimi session recording was not found")?;
    pieces_at(&path)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write(root: &Path, relative: &str, content: &str) {
        let path = root.join(relative);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, content).unwrap();
    }

    #[test]
    fn native_wire_reader_keeps_user_and_final_assistant_text() {
        let root = std::env::temp_dir().join(format!("vlx-kimi-store-wire-{}", uuid::Uuid::new_v4()));
        let wire = r#"{"type":"context.append_message","message":{"role":"user","content":[{"type":"text","text":"injected"}],"origin":{"kind":"injection"}}}
{"type":"context.append_message","message":{"role":"user","content":[{"type":"text","text":"帮我修复退票规则"}],"origin":{"kind":"user"}}}
{"type":"agent.message.appended","message":{"message":{"role":"user","content":[{"type":"text","text":"帮我修复退票规则"}]},"meta":{"source":"input"}}}
{"type":"agent.message.appended","message":{"message":{"role":"assistant","content":[{"type":"think","think":"private"},{"type":"text","text":"已完成规则修复"}]},"meta":{"source":"llm"}}}
{"type":"agent.message.appended","message":{"message":{"role":"tool","content":[{"type":"text","text":"tool output"}]},"meta":{"source":"tool"}}}
"#;
        write(&root, ".kimi-code/sessions/wd_demo/session_demo/agents/main/wire.jsonl", wire);
        let root = root.join(".kimi-code");
        let path = source_path_from(&[root], "session_demo").unwrap();
        let pieces = pieces_at(&path).unwrap();
        let text: Vec<_> = pieces.iter().map(|piece| (piece.role, piece.text.as_str())).collect();
        assert_eq!(text, [("user", "帮我修复退票规则"), ("assistant", "已完成规则修复")]);
    }

    #[test]
    fn legacy_context_reader_accepts_plain_role_rows() {
        let root = std::env::temp_dir().join(format!("vlx-kimi-store-context-{}", uuid::Uuid::new_v4()));
        let context = r#"{"type":"_system_prompt","content":"private"}
{"role":"user","content":"检查 SCM 编译"}
{"role":"assistant","content":[{"type":"text","text":"编译通过"}]}
"#;
        write(&root, ".kimi/sessions/workspace/session_legacy/context.jsonl", context);
        let root = root.join(".kimi");
        let path = source_path_from(&[root], "session_legacy").unwrap();
        let pieces = pieces_at(&path).unwrap();
        let text: Vec<_> = pieces.iter().map(|piece| (piece.role, piece.text.as_str())).collect();
        assert_eq!(text, [("user", "检查 SCM 编译"), ("assistant", "编译通过")]);
    }
}
