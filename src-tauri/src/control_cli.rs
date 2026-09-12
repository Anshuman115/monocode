//! The desktop executable also provides a small, JSON-only control client.
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::time::Duration;

use serde_json::{json, Value};

pub const HELP: &str = r#"MonoCode local control

Usage: monocode control ACTION [--json JSON | --input FILE|-] [--request-id ID]

Actions:
  list       List the run, workers and available harness/model choices.
  delegate   {"title":"Fix UI","harness":"codex","prompt":"...","files":["src/ui"],"dependsOn":[]}
  get        {"taskId":"..."}
  message    {"taskId":"...","text":"..."} Send a follow-up worker turn.
  cancel     {"taskId":"..."} Cancel a worker, including queued work.
  wait       {"timeoutSeconds":20} Wait for worker state changes (maximum 25s).
  review     {"taskId":"..."} Accept a completed worker result.
  finish     Complete the run after all remaining results are accepted.

All responses are JSON. --input - reads JSON from stdin. Use --request-id to
retry a mutation without duplicating it. A worker task belongs to the running
MonoCode app, not this CLI process. Closing the CLI does not cancel the task.

Choose Orchestrator from MonoCode's composer + menu and confirm its proposal.
MonoCode then supplies
MONOCODE_CONTROL_ENDPOINT and MONOCODE_CONTROL_TOKEN to that harness only.
"#;

pub fn run(args: Vec<String>) -> i32 {
    if args.is_empty() || matches!(args[0].as_str(), "help" | "--help" | "-h") {
        println!("{HELP}");
        return 0;
    }
    match execute(args) {
        Ok(value) => {
            println!("{value}");
            if value.get("ok").and_then(Value::as_bool) == Some(true) {
                0
            } else {
                1
            }
        }
        Err(error) => {
            println!("{}", json!({"ok":false,"error":error}));
            1
        }
    }
}

fn execute(args: Vec<String>) -> Result<Value, String> {
    let (action, input, request_id) = parse_args(&args)?;
    let endpoint = std::env::var("MONOCODE_CONTROL_ENDPOINT").map_err(|_| {
        "No MonoCode connection. Confirm the Orchestrator proposal in MonoCode first."
    })?;
    let token = std::env::var("MONOCODE_CONTROL_TOKEN")
        .map_err(|_| "No MonoCode session credential. Start the lead from MonoCode.")?;
    let address: SocketAddr = endpoint.parse().map_err(|_| "Invalid MonoCode endpoint")?;
    if !address.ip().is_loopback() {
        return Err("MonoCode control only connects to localhost".into());
    }
    let mut stream = TcpStream::connect_timeout(&address, Duration::from_secs(3))
        .map_err(|_| "MonoCode is not running or this connection has expired.")?;
    stream
        .set_read_timeout(Some(Duration::from_secs(40)))
        .map_err(|e| e.to_string())?;
    stream
        .set_write_timeout(Some(Duration::from_secs(5)))
        .map_err(|e| e.to_string())?;
    writeln!(
        stream,
        "{}",
        json!({"token":token,"action":action,"input":input,"requestId":request_id})
    )
    .map_err(|e| e.to_string())?;
    let mut line = String::new();
    BufReader::new(stream)
        .take(2_000_001)
        .read_line(&mut line)
        .map_err(|e| e.to_string())?;
    if line.len() > 2_000_000 {
        return Err("MonoCode response is too large".into());
    }
    serde_json::from_str(&line).map_err(|_| "MonoCode returned an invalid response".into())
}

fn parse_args(args: &[String]) -> Result<(String, Value, String), String> {
    let action = args.first().ok_or("Missing action")?.clone();
    if ![
        "list", "delegate", "get", "message", "cancel", "wait", "review", "finish",
    ]
    .contains(&action.as_str())
    {
        return Err(format!("Unknown action: {action}. Run control --help."));
    }
    let mut input = None;
    let mut request_id = uuid::Uuid::new_v4().to_string();
    let mut index = 1;
    while index < args.len() {
        let flag = &args[index];
        let value = args
            .get(index + 1)
            .ok_or_else(|| format!("Missing value for {flag}"))?;
        match flag.as_str() {
            "--request-id" => request_id = value.clone(),
            "--json" | "--input" => {
                if input.is_some() {
                    return Err("Supply only one input".into());
                }
                let raw = if flag == "--json" {
                    value.clone()
                } else if value == "-" {
                    let mut raw = String::new();
                    std::io::stdin()
                        .take(262_145)
                        .read_to_string(&mut raw)
                        .map_err(|e| e.to_string())?;
                    raw
                } else {
                    let file = std::fs::File::open(value).map_err(|e| e.to_string())?;
                    let mut raw = String::new();
                    file.take(262_145)
                        .read_to_string(&mut raw)
                        .map_err(|e| e.to_string())?;
                    raw
                };
                if raw.len() > 262_144 {
                    return Err("Input exceeds 256 KiB".into());
                }
                let parsed: Value =
                    serde_json::from_str(&raw).map_err(|e| format!("Invalid JSON: {e}"))?;
                if !parsed.is_object() {
                    return Err("Input must be a JSON object".into());
                }
                input = Some(parsed);
            }
            _ => return Err(format!("Unknown option: {flag}")),
        }
        index += 2;
    }
    if request_id.is_empty() || request_id.len() > 128 {
        return Err("Invalid request ID".into());
    }
    Ok((action, input.unwrap_or_else(|| json!({})), request_id))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn args(values: &[&str]) -> Vec<String> {
        values.iter().map(|s| s.to_string()).collect()
    }
    #[test]
    fn validates_inputs_without_invoking_a_shell() {
        let (_, input, id) = parse_args(&args(&[
            "delegate",
            "--json",
            r#"{"prompt":"$(touch nope) `hello`\nnext"}"#,
            "--request-id",
            "retry-1",
        ]))
        .unwrap();
        assert_eq!(id, "retry-1");
        assert_eq!(input["prompt"], "$(touch nope) `hello`\nnext");
        assert!(parse_args(&args(&["delegate", "--json", "[]"])).is_err());
        assert!(parse_args(&args(&["delegate", "--json", "{}", "--json", "{}"])).is_err());
        assert!(parse_args(&args(&["unknown"])).is_err());
    }
}
