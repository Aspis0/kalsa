//! Enrollment and names: how a pairing device becomes a member, how a
//! member is retired, and the one path each kind of name has.

use crate::events::MemberEvent;
use crate::roster::{self, NameError, AI_NAME, ROSTER_NAME};
use crate::room::Room;
use crate::{MemberId, RoomError};

impl Room {
    /// The member a pairing device is in this room, minting a member id at
    /// first sight. Idempotent: a device that already has its member keeps
    /// it, on every call and across restarts. This is R2's first call
    /// after the door authenticates a credential.
    pub fn enroll(&self, device: u32) -> Result<MemberId, RoomError> {
        let _writer = self.lock_write();
        if let Some(member) = {
            let state = self.lock_state();
            state.roster.member_of(device)
        } {
            return Ok(member);
        }
        let (updated, member) = {
            let state = self.lock_state();
            state
                .roster
                .with_device(device)
                .ok_or(RoomError::RosterFull)?
        };
        roster::publish(&self.dir.join(ROSTER_NAME), &updated).map_err(RoomError::Io)?;
        {
            let mut state = self.lock_state();
            state.roster = updated;
        }
        Ok(member)
    }

    /// The member a device has, if any — a look, never a mint.
    pub fn member_of(&self, device: u32) -> Option<MemberId> {
        self.lock_state().roster.member_of(device)
    }

    /// Retires a device's member: the mapping goes, the member id never
    /// returns, and the member's name stays in the file for the history it
    /// explains. R2 calls this when the pairing store forgets a device; a
    /// device id that pairs again is a fresh member with a fresh id. An
    /// unknown device is success — the postcondition already holds.
    pub fn forget_device(&self, device: u32) -> Result<(), RoomError> {
        let _writer = self.lock_write();
        let updated = {
            let state = self.lock_state();
            state.roster.without_device(device)
        };
        let Some((updated, member)) = updated else {
            return Ok(());
        };
        roster::publish(&self.dir.join(ROSTER_NAME), &updated).map_err(RoomError::Io)?;
        {
            let mut state = self.lock_state();
            state.roster = updated;
        }
        self.publish_member(MemberEvent::Left { member });
        Ok(())
    }

    /// Sets a member's own display name. Phones reach this through the
    /// door; the host and the AI do not pass through it — the host has
    /// [`Room::set_host_name`], the AI's name is fixed.
    pub fn set_name(&self, member: MemberId, name: &str) -> Result<String, NameError> {
        let name = roster::valid(name)?;
        let folded = roster::fold(&name);
        if folded == roster::fold(AI_NAME) {
            return Err(NameError::Reserved);
        }
        let _writer = self.lock_write();
        let updated = {
            let state = self.lock_state();
            if !matches!(member, MemberId::Member(_)) || !state.roster.is_live(member) {
                return Err(NameError::NotAMember);
            }
            if state.roster.name_of(member).as_deref() == Some(name.as_str()) {
                return Ok(name);
            }
            if !state.roster.name_is_free(&folded, member) {
                return Err(NameError::Taken);
            }
            state.roster.with_name(member, name.clone())
        };
        roster::publish(&self.dir.join(ROSTER_NAME), &updated).map_err(NameError::Io)?;
        {
            let mut state = self.lock_state();
            state.roster = updated;
        }
        self.publish_member(MemberEvent::Renamed {
            member,
            name: name.clone(),
        });
        Ok(name)
    }

    /// Sets the host's display name — the computer's own path. The door
    /// does not expose this to phones: the room is the host's house.
    pub fn set_host_name(&self, name: &str) -> Result<String, NameError> {
        let name = roster::valid(name)?;
        let folded = roster::fold(&name);
        if folded == roster::fold(AI_NAME) {
            return Err(NameError::Reserved);
        }
        let _writer = self.lock_write();
        let updated = {
            let state = self.lock_state();
            if state.roster.name_of(MemberId::Host).as_deref() == Some(name.as_str()) {
                return Ok(name);
            }
            if !state.roster.name_is_free(&folded, MemberId::Host) {
                return Err(NameError::Taken);
            }
            state.roster.with_host_name(name.clone())
        };
        roster::publish(&self.dir.join(ROSTER_NAME), &updated).map_err(NameError::Io)?;
        {
            let mut state = self.lock_state();
            state.roster = updated;
        }
        self.publish_member(MemberEvent::Renamed {
            member: MemberId::Host,
            name: name.clone(),
        });
        Ok(name)
    }

    /// The display name a member set — kept for retired members too,
    /// because their history still shows it. The AI answers with its fixed
    /// name; a member who never set one has none here (the device label
    /// lives in the pairing store).
    pub fn name_of(&self, member: MemberId) -> Option<String> {
        self.lock_state().roster.name_of(member)
    }
}
