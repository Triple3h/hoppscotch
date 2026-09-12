use relay::{
    error::RelayError, Request as RelayRequest, Response as RelayResponse, RelayStreamEvent,
};
use serde::{Deserialize, Serialize};

pub type RunRequest = RelayRequest;

pub type StreamEvent = RelayStreamEvent;

#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "kind")]
pub enum ExecuteResponse {
    #[serde(rename = "success")]
    Success { response: RelayResponse },
    #[serde(rename = "error")]
    Error { error: RelayError },
}

pub type CancelRequest = i64;

pub type CancelResponse = ();
