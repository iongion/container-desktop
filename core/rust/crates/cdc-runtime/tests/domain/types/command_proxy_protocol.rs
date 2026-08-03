//! Forwarded HTTP: the stream chunk's kind.

use cdc_runtime::domain::types::command_proxy_protocol::StreamEventType;

#[test]
fn a_stream_event_kind_agrees_with_itself_on_the_wire() {
    super::agrees_on_the_wire(StreamEventType::VOCABULARY);
}
