use std::{collections::HashMap, sync::Arc};

use serde::{Deserialize, Serialize};

/// Incremental response events pushed to the frontend while a request
/// is still in flight. Only emitted for streaming response bodies
/// (`Content-Type: text/event-stream`) — regular responses complete in
/// one shot and never touch this channel.
///
/// `Deserialize` is required by `tauri::ipc::Channel<T>` even though
/// the plugin only ever serializes these values out.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum RelayStreamEvent {
    /// Response headers (and status) of the current — possibly
    /// redirected — response group, delivered once per header group
    /// completion, before the first body chunk.
    #[serde(rename_all = "camelCase")]
    Headers {
        request_id: i64,
        status: u16,
        status_text: String,
        headers: HashMap<String, String>,
    },
    /// An incremental slice of the response body, base64-encoded.
    #[serde(rename_all = "camelCase")]
    Chunk { request_id: i64, data: String },
}

/// Thread-safe sink the transfer handler pushes [`RelayStreamEvent`]s
/// through. Implemented by the Tauri plugin layer as a `Channel::send`
/// bridge; `None` when the caller did not subscribe.
pub type StreamEventCallback = Arc<dyn Fn(RelayStreamEvent) + Send + Sync>;
