// Screens, and the sessions and terminals in them.
//
// `osd screen ls` is how an agent finds what else is running here: every
// Screen's panes with what each one is, where it works and the id the other
// commands take. The token sees the desktop window's Screens; an account sees
// its own.
use serde_json::{json, Value};

use crate::args::Args;
use crate::client::Client;

/// One pane, as `osd screen ls` reports it.
#[derive(Debug, PartialEq)]
pub enum Pane {
    Session { pane: String, id: String, title: Option<String>, directory: Option<String> },
    /// `shell` is the id `osd term` takes, when it is knowable from here: a
    /// desktop pane's shell is named after the pane, a browser's is not.
    Terminal { pane: String, shell: Option<String>, name: Option<String>, cwd: Option<String>, agent: Option<String> },
    Other { pane: String, kind: String },
}

pub struct Screen {
    pub id: String,
    pub name: String,
    pub panes: Vec<Pane>,
}

fn leaves<'a>(node: &'a Value, out: &mut Vec<&'a Value>) {
    match node["kind"].as_str() {
        Some("leaf") => out.push(node),
        Some("split") => {
            for child in node["children"].as_array().into_iter().flatten() {
                leaves(child, out);
            }
        }
        _ => {}
    }
}

fn agent_name(kind: &str) -> String {
    match kind {
        "claude" => "Claude Code".into(),
        "codex" => "Codex".into(),
        other => other.into(),
    }
}

/// The Screens of a saved layout, with sessions named from `sessions` (the
/// `/v1/sessions` list). `desktop`: the layout is the desktop window's, whose
/// shells carry their pane's id.
pub fn screens_of(layout: &Value, sessions: &Value, desktop: bool) -> Vec<Screen> {
    let session = |id: &str| sessions.as_array().into_iter().flatten().find(|s| s["id"].as_str() == Some(id));
    let text = |v: &Value| v.as_str().filter(|s| !s.trim().is_empty()).map(str::to_string);
    let mut out = Vec::new();
    for (i, g) in layout["groups"].as_array().into_iter().flatten().enumerate() {
        let mut ls = Vec::new();
        leaves(&g["tree"], &mut ls);
        let panes: Vec<Pane> = ls
            .into_iter()
            .map(|l| {
                let pane = l["id"].as_str().unwrap_or("?").to_string();
                let c = &l["content"];
                match c["kind"].as_str() {
                    Some("terminal") => Pane::Terminal {
                        shell: desktop.then(|| pane.clone()),
                        pane,
                        name: text(&c["name"]),
                        cwd: text(&c["cwd"]),
                        agent: c["agent"]["kind"].as_str().map(agent_name),
                    },
                    Some(kind) => Pane::Other { pane, kind: kind.to_string() },
                    None if l["artifact"].is_object() => Pane::Other { pane, kind: "artifact".into() },
                    None => match l["sessionId"].as_str() {
                        Some(id) => {
                            let s = session(id);
                            Pane::Session {
                                pane,
                                id: id.to_string(),
                                title: s.and_then(|s| text(&s["title"])),
                                directory: s.and_then(|s| text(&s["directory"])),
                            }
                        }
                        None => Pane::Other { pane, kind: "draft".into() },
                    },
                }
            })
            .collect();
        // Unnamed, a Screen is called what its first pane holds — as in the app.
        let first = panes.iter().find_map(|p| match p {
            Pane::Session { title, .. } => title.clone(),
            Pane::Terminal { name, agent, .. } => name.clone().or_else(|| agent.clone()).or_else(|| Some("Terminal".into())),
            Pane::Other { kind, .. } if kind != "draft" && kind != "artifact" => Some(kind.clone()),
            Pane::Other { .. } => None,
        });
        let name = text(&g["name"]).or(first).unwrap_or_else(|| format!("Screen {}", i + 1));
        out.push(Screen { id: g["id"].as_str().unwrap_or("?").to_string(), name, panes });
    }
    out
}

fn pane_json(p: &Pane) -> Value {
    match p {
        Pane::Session { pane, id, title, directory } => {
            json!({ "pane": pane, "kind": "session", "session": id, "title": title, "directory": directory })
        }
        Pane::Terminal { pane, shell, name, cwd, agent } => {
            json!({ "pane": pane, "kind": "terminal", "shell": shell, "name": name, "cwd": cwd, "agent": agent })
        }
        Pane::Other { pane, kind } => json!({ "pane": pane, "kind": kind }),
    }
}

/// The layout this caller works in: an account's own, else the desktop window's.
fn layout_for(client: &Client) -> Result<(Value, bool), String> {
    let me = client.get("/v1/whoami")?;
    if me["user"].is_string() {
        return Ok((client.get("/v1/me/layout")?, false));
    }
    Ok((client.get("/v1/layout/desktop")?["layout"].clone(), true))
}

pub fn screen_ls(args: &Args) -> Result<(), String> {
    let client = Client::connect(args)?;
    let (layout, desktop) = layout_for(&client)?;
    let sessions = client.get("/v1/sessions")?;
    let screens = screens_of(&layout, &sessions, desktop);
    if args.has("json") {
        let v: Vec<Value> = screens
            .iter()
            .map(|s| json!({ "id": s.id, "name": s.name, "panes": s.panes.iter().map(pane_json).collect::<Vec<_>>() }))
            .collect();
        println!("{}", serde_json::to_string_pretty(&v).map_err(|e| e.to_string())?);
        return Ok(());
    }
    if screens.is_empty() {
        println!("No Screens.");
        return Ok(());
    }
    for s in &screens {
        println!("{}", s.name);
        if s.panes.is_empty() {
            println!("    (empty)");
        }
        for p in &s.panes {
            match p {
                Pane::Session { id, title, directory, .. } => {
                    println!("    session   {id}  {}", title.as_deref().unwrap_or("(untitled)"));
                    if let Some(d) = directory {
                        println!("              {d}");
                    }
                }
                Pane::Terminal { shell, name, cwd, agent, .. } => {
                    let what = agent.clone().or_else(|| name.clone()).unwrap_or_else(|| "shell".into());
                    let id = shell.as_deref().unwrap_or("(a browser's own shell)");
                    println!("    terminal  {id}  {what}");
                    if let Some(c) = cwd {
                        println!("              {c}");
                    }
                }
                Pane::Other { kind, .. } => println!("    {kind}"),
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn panes_are_listed_in_order_with_what_each_one_is() {
        let layout = json!({ "groups": [
            { "id": "g1", "name": "", "tree": { "kind": "split", "dir": "row", "sizes": [0.5, 0.5], "children": [
                { "kind": "leaf", "id": "p1", "sessionId": "ses_a" },
                { "kind": "leaf", "id": "p2", "sessionId": null,
                  "content": { "kind": "terminal", "cwd": "/repo", "agent": { "kind": "claude", "sessionId": "x", "running": true } } }
            ]}},
            { "id": "g2", "name": "Files", "tree": { "kind": "leaf", "id": "p3", "sessionId": null, "content": { "kind": "files" } } },
            { "id": "g3", "name": "Home", "tree": null }
        ]});
        let sessions = json!([{ "id": "ses_a", "title": "Fit", "directory": "/w/s1" }]);
        let s = screens_of(&layout, &sessions, true);
        assert_eq!(s.len(), 3);
        assert_eq!(s[0].name, "Fit", "named after its first pane");
        assert_eq!(s[1].name, "Files");
        assert_eq!(
            s[0].panes,
            vec![
                Pane::Session { pane: "p1".into(), id: "ses_a".into(), title: Some("Fit".into()), directory: Some("/w/s1".into()) },
                Pane::Terminal { pane: "p2".into(), shell: Some("p2".into()), name: None, cwd: Some("/repo".into()), agent: Some("Claude Code".into()) },
            ]
        );
        assert_eq!(s[1].panes, vec![Pane::Other { pane: "p3".into(), kind: "files".into() }]);
        assert!(s[2].panes.is_empty());

        // An account's layout: its shells are named by its browser, not here.
        let mine = screens_of(&layout, &sessions, false);
        assert!(matches!(&mine[0].panes[1], Pane::Terminal { shell: None, .. }));
    }
}
