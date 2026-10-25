use std::collections::BTreeMap;

use crate::error::Error;
use crate::record::ServerRecord;
use crate::server_id::ServerId;

/// The servers the host may start. Adding a server means adding a record here;
/// the host code does not change.
pub struct Registry {
    records: BTreeMap<ServerId, ServerRecord>,
}

impl Registry {
    pub fn new(records: Vec<ServerRecord>) -> Result<Self, Error> {
        let mut map = BTreeMap::new();
        for record in records {
            let id = record.id().clone();
            if map.contains_key(&id) {
                return Err(Error::DuplicateServer(id));
            }
            map.insert(id, record);
        }
        Ok(Self { records: map })
    }

    pub(crate) fn replace(&mut self, record: ServerRecord) -> Result<(), Error> {
        let slot = self.records.get_mut(record.id()).ok_or(Error::UnknownServer)?;
        *slot = record;
        Ok(())
    }

    pub(crate) fn get(&self, id: &ServerId) -> Option<&ServerRecord> {
        self.records.get(id)
    }

    pub(crate) fn get_mut(&mut self, id: &ServerId) -> Option<&mut ServerRecord> {
        self.records.get_mut(id)
    }
}
