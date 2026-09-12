use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use base64::Engine as _;
use bytes::{Bytes, BytesMut};
use curl::easy::Easy;
use tokio_util::sync::CancellationToken;

use crate::error::{RelayError, Result};
use crate::stream::{RelayStreamEvent, StreamEventCallback};

const EVENT_STREAM_CONTENT_TYPE: &str = "text/event-stream";

fn is_event_stream(headers: &HashMap<String, String>) -> bool {
    headers.iter().any(|(key, value)| {
        key.eq_ignore_ascii_case("content-type")
            && value.to_ascii_lowercase().contains(EVENT_STREAM_CONTENT_TYPE)
    })
}

pub(crate) struct TransferHandler {
    body: BytesMut,
    headers: HashMap<String, String>,
    request_id: i64,
    on_event: Option<StreamEventCallback>,
    status_code: Option<u16>,
    status_text: Option<String>,
}

impl TransferHandler {
    pub(crate) fn new(request_id: i64, on_event: Option<StreamEventCallback>) -> Self {
        Self {
            body: BytesMut::new(),
            headers: HashMap::new(),
            request_id,
            on_event,
            status_code: None,
            status_text: None,
        }
    }

    #[tracing::instrument(skip(self, handle), level = "debug")]
    pub(crate) fn handle_transfer(
        &mut self,
        handle: &mut Easy,
        cancel_token: &CancellationToken,
    ) -> Result<()> {
        tracing::debug!("Setting up transfer handlers");
        let mut transfer = handle.transfer();

        let body = &mut self.body;
        let headers = &mut self.headers;
        let status_code = &mut self.status_code;
        let status_text = &mut self.status_text;

        let request_id = self.request_id;
        let on_event = self.on_event.clone();

        // Shared between the write and header callbacks; the header
        // callback arms streaming mode once an SSE content-type is seen
        let streaming_active = Arc::new(AtomicBool::new(false));

        let write_streaming = Arc::clone(&streaming_active);
        let write_on_event = on_event.clone();

        transfer
            .write_function(move |data| {
                body.extend_from_slice(data);
                tracing::trace!(bytes = data.len(), "Received response data chunk");

                // Only event-stream bodies stream incrementally; every
                // other response aggregates silently as before
                if write_streaming.load(Ordering::SeqCst) {
                    if let Some(callback) = &write_on_event {
                        let payload = base64::engine::general_purpose::STANDARD.encode(data);
                        callback(RelayStreamEvent::Chunk {
                            request_id,
                            data: payload,
                        });
                    }
                }

                Ok(data.len())
            })
            .map_err(|e| {
                tracing::error!(error = %e, "Failed to set write callback");
                RelayError::Network {
                    message: "Failed to set write callback".into(),
                    cause: Some(e.to_string()),
                }
            })?;

        let header_streaming = Arc::clone(&streaming_active);
        let on_event_headers = self.on_event.clone();

        transfer
            .header_function(move |header| {
                let Ok(header_str) = std::str::from_utf8(header) else {
                    return true;
                };

                let line = header_str.trim_end_matches(['\r', '\n']);

                // Status line of each (possibly redirected) response
                // starts a fresh header group
                if line.starts_with("HTTP/") {
                    headers.clear();
                    header_streaming.store(false, Ordering::SeqCst);
                    let mut parts = line.splitn(3, ' ');
                    let _http_version = parts.next();
                    if let Some(code) = parts.next().and_then(|c| c.parse::<u16>().ok()) {
                        *status_code = Some(code);
                        *status_text = Some(parts.next().unwrap_or("").to_string());
                    }
                    return true;
                }

                // Blank line closes the header group: decide streaming
                // mode and deliver the headers to streaming subscribers
                if line.is_empty() {
                    let is_stream = is_event_stream(headers);
                    header_streaming.store(is_stream, Ordering::SeqCst);

                    if is_stream {
                        if let Some(callback) = &on_event_headers {
                            callback(RelayStreamEvent::Headers {
                                request_id,
                                status: status_code.unwrap_or(0),
                                status_text: status_text.clone().unwrap_or_default(),
                                headers: headers.clone(),
                            });
                        }
                    }
                    return true;
                }

                if let Some(idx) = line.find(':') {
                    let (key, value) = line.split_at(idx);
                    let key = key.trim().to_string();
                    let value = value[1..].trim().to_string();

                    if key.to_lowercase() == "set-cookie" {
                        // NOTE: Special handling workaround.
                        // Concatenate multiple `Set-Cookie` headers.
                        match headers.entry(key) {
                            std::collections::hash_map::Entry::Occupied(mut e) => {
                                let existing = e.get_mut();
                                existing.push_str("\n");
                                existing.push_str(&value);
                            }
                            std::collections::hash_map::Entry::Vacant(e) => {
                                e.insert(value);
                            }
                        }
                    } else {
                        headers.entry(key).or_insert(value);
                    }
                }

                true
            })
            .map_err(|e| {
                tracing::error!(error = %e, "Failed to set header callback");
                RelayError::Network {
                    message: "Failed to set header callback".into(),
                    cause: Some(e.to_string()),
                }
            })?;

        transfer
            .progress_function(|_, _, _, _| {
                let cancelled = cancel_token.is_cancelled();
                if cancelled {
                    tracing::warn!("Request cancelled by user");
                }
                !cancelled
            })
            .map_err(|e| {
                tracing::error!(error = %e, "Failed to set progress callback");
                RelayError::Network {
                    message: "Failed to set progress callback".into(),
                    cause: Some(e.to_string()),
                }
            })?;

        tracing::debug!("Starting transfer");
        transfer.perform().map_err(|e| {
            tracing::error!(error = %e, "Failed to perform request");
            RelayError::Network {
                message: "Failed to perform request".into(),
                cause: Some(e.to_string()),
            }
        })?;

        tracing::debug!("Transfer completed successfully");
        Ok(())
    }

    pub(crate) fn into_parts(self) -> (Bytes, HashMap<String, String>) {
        (self.body.into(), self.headers)
    }
}
