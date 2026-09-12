use std::sync::Arc;

use crate::{models::*, Result};
use relay::StreamEventCallback;
use serde::de::DeserializeOwned;
use tauri::{ipc::Channel, plugin::PluginApi, AppHandle, Runtime};

pub fn init<R: Runtime, C: DeserializeOwned>(
    app: &AppHandle<R>,
    _api: PluginApi<R, C>,
) -> Result<Relay<R>> {
    tracing::debug!("Initializing Relay for desktop platform");
    Ok(Relay(app.clone()))
}

pub struct Relay<R: Runtime>(AppHandle<R>);

impl<R: Runtime> Relay<R> {
    pub async fn execute(
        &self,
        request: RunRequest,
        on_event: Channel<StreamEvent>,
    ) -> Result<ExecuteResponse> {
        tracing::debug!(?request, "Executing request");

        // Bridge the Tauri IPC channel into the relay's streaming
        // callback; the curl transfer thread invokes it per chunk.
        // Event delivery is best-effort — a closed webview must not
        // abort the underlying transfer.
        let callback: StreamEventCallback = Arc::new(move |event: StreamEvent| {
            if let Err(e) = on_event.send(event) {
                tracing::warn!(error = %e, "Failed to push stream event to webview");
            }
        });

        match relay::execute(request, Some(callback)).await {
            Ok(response) => {
                tracing::debug!("Request executed successfully");
                Ok(ExecuteResponse::Success { response })
            }
            Err(error) => {
                tracing::error!(?error, "Request execution failed");
                Ok(ExecuteResponse::Error { error })
            }
        }
    }

    pub async fn cancel(&self, request_id: CancelRequest) -> Result<CancelResponse> {
        tracing::debug!(?request_id, "Cancelling request");

        if let Err(e) = relay::cancel(request_id).await {
            tracing::error!(?e, "Request cancellation failed");
            return Err(e.into());
        }

        tracing::debug!("Request cancelled successfully");
        Ok(())
    }
}
