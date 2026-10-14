use tokio::io::{AsyncWrite, AsyncWriteExt};
use zeroize::Zeroizing;

use crate::error::Error;

/// Written once as the first stdin line, before the protocol starts. It has no
/// Debug or Display impl, so it cannot reach a log, an error or a panic message.
pub struct BootstrapSecret(Zeroizing<String>);

impl BootstrapSecret {
    pub fn new(value: String) -> Result<Self, Error> {
        let value = Zeroizing::new(value);
        if value.is_empty() || value.contains(['\n', '\r']) {
            return Err(Error::InvalidSecret);
        }
        Ok(Self(value))
    }

    pub(crate) async fn write_line<W: AsyncWrite + Unpin>(&self, writer: &mut W) -> std::io::Result<()> {
        let mut line = Zeroizing::new(Vec::with_capacity(self.0.len() + 1));
        line.extend_from_slice(self.0.as_bytes());
        line.push(b'\n');
        writer.write_all(&line).await?;
        writer.flush().await
    }
}
